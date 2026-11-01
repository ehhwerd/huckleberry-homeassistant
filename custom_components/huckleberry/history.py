"""Revision-safe history editing for Huckleberry (fork of Woyken/huckleberry-homeassistant).

Logic follows py-huckleberry-api PR #54 ("revision-safe history mutations"), vendored here and
extended to every tracker: sleep, feed (breast / bottle / solids), diaper / potty, health
(medication / temperature / growth), pump and activities. Works on raw Firestore dicts so fields
the library does not model survive an edit untouched.

Every write:
  * is conditional on the history document revision the caller listed (``update_time``) and on the
    tracker root document revision, in one Firestore batch;
  * repairs the denormalised ``prefs.last*`` cache when the edited entry is, or becomes, the newest;
  * is preceded by a JSON backup of the document and the root prefs (``/config/huckleberry_backups``)
    so it can be undone with ``restore_entry``.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import time
from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any

from google.api_core.exceptions import FailedPrecondition
from google.cloud import firestore
from google.cloud.firestore import DELETE_FIELD

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

_LOGGER = logging.getLogger(__name__)

TRACKERS: dict[str, str] = {
    "sleep": "intervals",
    "feed": "intervals",
    "diaper": "intervals",
    "health": "data",
    "pump": "intervals",
    "activities": "intervals",
}
MS_THRESHOLD = 1e11  # starts above this are legacy milliseconds (upstream #51)
BACKUP_DIR = "huckleberry_backups"
ACTIVITY_LAST_FIELD = {
    "bath": "lastBath",
    "brushTeeth": "lastBrushTeeth",
    "indoorPlay": "lastIndoorPlay",
    "outdoorPlay": "lastOutdoorPlay",
    "screenTime": "lastScreenTime",
    "skinToSkin": "lastSkinToSkin",
    "storyTime": "lastStoryTime",
    "tummyTime": "lastTummyTime",
}
QTY = {"little": 0.0, "medium": 50.0, "big": 100.0}
QTY_NAME = {0.0: "little", 50.0: "medium", 100.0: "big"}
START_CONDITIONS = ("happy", "upset", "under_10_minutes", "10-20_minutes", "longTimeToFallAsleep")
END_CONDITIONS = ("happy", "upset", "wokeUpChild")
LOCATIONS = (
    "onOwnInBed", "nursing", "wornOrHeld", "nextToCarer", "coSleep",
    "stroller", "car", "swing", "bottle",
)


class Conflict(HomeAssistantError):
    """The entry changed after it was listed."""


# ---------------------------------------------------------------- helpers
def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(float(value)) else None


def _start_s(entry: dict) -> float | None:
    start = _num(entry.get("start"))
    if start is None:
        return None
    return start / 1000 if start > MS_THRESHOLD else start


def _offset_at(hass: HomeAssistant, ts: float) -> float:
    """Huckleberry offset convention: minus the UTC offset in minutes."""
    off = datetime.fromtimestamp(ts, dt_util.get_time_zone(hass.config.time_zone)).utcoffset()
    return 0.0 if off is None else -off.total_seconds() / 60


def kind_of(tracker: str, entry: dict) -> str | None:
    """Map an entry to the prefs bucket it controls."""
    mode = entry.get("mode")
    if tracker == "sleep":
        return "sleep"
    if tracker == "feed":
        return {"breast": "breast", "bottle": "bottle", "solids": "solids"}.get(mode)
    if tracker == "diaper":
        return "potty" if entry.get("isPotty") is True else "diaper"
    if tracker == "health":
        return mode if mode in ("medication", "temperature", "growth") else None
    if tracker == "pump":
        return "pump"
    if tracker == "activities":
        return f"activity:{mode}" if mode in ACTIVITY_LAST_FIELD else None
    return None


def _duration(kind: str, entry: dict) -> float | None:
    if kind == "breast":
        return (_num(entry.get("leftDuration")) or 0.0) + (_num(entry.get("rightDuration")) or 0.0)
    return _num(entry.get("duration"))


def _summary(kind: str, e: dict) -> dict[str, Any]:
    """Friendly fields for the dashboard (raw data stays available too)."""
    out: dict[str, Any] = {}
    if e.get("notes"):
        out["notes"] = e["notes"]
    if kind == "sleep":
        det = e.get("details") or {}
        if det.get("notes"):
            out["notes"] = det["notes"]
        out["start_condition"] = [k for k in START_CONDITIONS if (det.get("startSleepCondition") or {}).get(k)]
        out["end_condition"] = [k for k in END_CONDITIONS if (det.get("endSleepCondition") or {}).get(k)]
        out["locations"] = [k for k in LOCATIONS if (det.get("sleepLocations") or {}).get(k)]
    elif kind == "breast":
        out["left"] = _num(e.get("leftDuration")) or 0
        out["right"] = _num(e.get("rightDuration")) or 0
        out["last_side"] = e.get("lastSide")
    elif kind == "bottle":
        out.update(amount=e.get("amount"), units=e.get("units"), bottle_type=e.get("bottleType"))
    elif kind == "solids":
        foods = e.get("foods") or {}
        names = []
        if isinstance(foods, dict):
            for food in foods.values():
                if isinstance(food, dict) and food.get("name"):
                    names.append(food["name"])
        out["foods"] = names
    elif kind in ("diaper", "potty"):
        q = e.get("quantity") or {}
        out.update(
            mode=e.get("mode"),
            pee=QTY_NAME.get(_num(q.get("pee")) if isinstance(q, dict) else None),
            poo=QTY_NAME.get(_num(q.get("poo")) if isinstance(q, dict) else None),
            color=e.get("color"),
            consistency=e.get("consistency"),
            rash=bool(e.get("diaperRash")),
        )
        if kind == "potty":
            out["how"] = e.get("howItHappened")
    elif kind == "medication":
        out.update(medicine=e.get("medication_name"), amount=e.get("amount"), units=e.get("units"))
    elif kind == "temperature":
        out.update(amount=e.get("amount"), units=e.get("units"))
    elif kind == "growth":
        for k in ("weight", "height", "head", "units"):
            if e.get(k) is not None:
                out[k] = e.get(k)
    elif kind == "pump":
        out.update(left=e.get("leftAmount"), right=e.get("rightAmount"), units=e.get("units"), entry_mode=e.get("entryMode"))
    elif kind.startswith("activity:"):
        out["mode"] = e.get("mode")
    return out


def _record(hass, tracker: str, doc, key: str | None, entry: dict) -> dict[str, Any] | None:
    kind = kind_of(tracker, entry)
    start = _start_s(entry)
    if kind is None or start is None:
        return None
    dur = _duration(kind, entry)
    tz = dt_util.get_time_zone(hass.config.time_zone)
    rec: dict[str, Any] = {
        "id": f"{doc.id}/{key}" if key else doc.id,
        "tracker": tracker,
        "kind": kind,
        "revision": doc.update_time.isoformat() if doc.update_time else "",
        "start": datetime.fromtimestamp(start, tz).isoformat(),
        "ts": start,
        "duration": dur,
        "end": datetime.fromtimestamp(start + dur, tz).isoformat() if dur else None,
        "multi": key is not None,
    }
    rec.update(_summary(kind, entry))
    return rec


def _split_id(entry_id: str) -> tuple[str, str | None]:
    if "/" in entry_id:
        doc_id, key = entry_id.split("/", 1)
        return doc_id, key
    return entry_id, None


async def _client(api):
    return await api._get_firestore_client()  # noqa: SLF001 (library has no public accessor)


# ---------------------------------------------------------------- listing
async def _raw_in_range(api, child_uid: str, tracker: str, lo: float, hi: float):
    """Yield (doc, key, entry) for entries starting in [lo, hi) (seconds)."""
    client = await _client(api)
    sub = client.collection(tracker).document(child_uid).collection(TRACKERS[tracker])
    for a, b in ((lo, hi), (lo * 1000, hi * 1000)):
        query = (
            sub.where(filter=firestore.FieldFilter("start", ">=", a))
            .where(filter=firestore.FieldFilter("start", "<", b))
            .order_by("start")
        )
        async for doc in query.stream():
            data = doc.to_dict() or {}
            if data.get("multi") is True:
                continue
            yield doc, None, data
    async for doc in sub.where(filter=firestore.FieldFilter("multi", "==", True)).stream():
        entries = (doc.to_dict() or {}).get("data")
        if not isinstance(entries, dict):
            continue
        for key, entry in entries.items():
            if isinstance(entry, dict):
                start = _start_s(entry)
                if start is not None and lo <= start < hi:
                    yield doc, key, entry


async def async_list_entries(
    hass: HomeAssistant, api, child_uid: str, start: datetime, end: datetime, trackers: list[str] | None
) -> list[dict[str, Any]]:
    lo, hi = start.timestamp(), end.timestamp()
    wanted = [t for t in (trackers or list(TRACKERS)) if t in TRACKERS]

    async def one(tracker: str) -> list[dict[str, Any]]:
        out = []
        try:
            async for doc, key, entry in _raw_in_range(api, child_uid, tracker, lo, hi):
                rec = _record(hass, tracker, doc, key, entry)
                if rec is not None:
                    out.append(rec)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Huckleberry history: listing %s failed: %s", tracker, err)
        return out

    results = await asyncio.gather(*(one(t) for t in wanted))
    records = [r for chunk in results for r in chunk]
    records.sort(key=lambda r: r["ts"])
    return records


async def async_list_raw(api, child_uid: str, tracker: str, start: datetime, end: datetime):
    """Raw (doc_id, key, entry) tuples for the calendar (uid = doc id)."""
    out = []
    async for doc, key, entry in _raw_in_range(api, child_uid, tracker, start.timestamp(), end.timestamp()):
        out.append((f"{doc.id}/{key}" if key else doc.id, entry))
    return out


# ---------------------------------------------------------------- prefs repair
async def _latest(api, child_uid: str, tracker: str, kind: str, skip: tuple[str, str | None], replacement):
    """Newest entry of ``kind`` after logically applying one pending change."""
    client = await _client(api)
    sub = client.collection(tracker).document(child_uid).collection(TRACKERS[tracker])
    best: tuple[dict, str, str | None] | None = None

    def consider(entry: dict, doc_id: str, key: str | None) -> None:
        nonlocal best
        if kind_of(tracker, entry) != kind:
            return
        s = _start_s(entry)
        if s is None:
            return
        if best is None or s > (_start_s(best[0]) or 0):
            best = (deepcopy(entry), doc_id, key)

    if replacement is not None:
        consider(replacement, skip[0], skip[1])
    for flt in (("<", MS_THRESHOLD), (">=", MS_THRESHOLD)):
        query = (
            sub.where(filter=firestore.FieldFilter("start", flt[0], flt[1]))
            .order_by("start", direction=firestore.Query.DESCENDING)
            .limit(300)
        )
        async for doc in query.stream():
            if doc.id == skip[0] and skip[1] is None:
                continue
            data = doc.to_dict() or {}
            if data.get("multi") is True or kind_of(tracker, data) != kind:
                continue
            consider(data, doc.id, None)
            break
    async for doc in sub.where(filter=firestore.FieldFilter("multi", "==", True)).stream():
        entries = (doc.to_dict() or {}).get("data")
        if isinstance(entries, dict):
            for key, entry in entries.items():
                if doc.id == skip[0] and key == skip[1]:
                    continue
                if isinstance(entry, dict):
                    consider(entry, doc.id, key)
    return best


def _pref_field(kind: str) -> str:
    return {
        "sleep": "lastSleep",
        "breast": "lastNursing",
        "bottle": "lastBottle",
        "solids": "lastSolid",
        "diaper": "lastDiaper",
        "potty": "lastPotty",
        "medication": "lastMedication",
        "temperature": "lastTemperature",
        "growth": "lastGrowthEntry",
        "pump": "lastPump",
    }.get(kind) or ACTIVITY_LAST_FIELD[kind.split(":", 1)[1]]


def _pref_payload(kind: str, latest, now: float) -> dict[str, Any]:
    """Root-document prefs update mirroring the library's create paths."""
    field = _pref_field(kind)
    upd: dict[str, Any] = {"prefs.timestamp": {"seconds": now}, "prefs.local_timestamp": now}
    if latest is None:
        upd[f"prefs.{field}"] = DELETE_FIELD
        if kind == "breast":
            upd["prefs.lastSide"] = DELETE_FIELD
        return upd
    e, doc_id, key = latest
    e = {**e, "start": _start_s(e)}  # prefs always in seconds (legacy rows may be ms)
    g = e.get
    if kind == "sleep":
        val = {"start": g("start"), "duration": g("duration"), "offset": g("offset")}
    elif kind == "breast":
        left, right = _num(g("leftDuration")) or 0.0, _num(g("rightDuration")) or 0.0
        val = {"mode": "breast", "start": g("start"), "duration": left + right,
               "leftDuration": left, "rightDuration": right, "offset": g("offset")}
        upd["prefs.lastSide"] = {"start": g("start"), "lastSide": g("lastSide")}
    elif kind == "bottle":
        val = {"mode": "bottle", "start": g("start"), "bottleType": g("bottleType"),
               "bottleAmount": g("amount"), "bottleUnits": g("units"), "offset": g("offset")}
    elif kind == "solids":
        val = {"mode": "solids", "start": g("start"), "foods": g("foods"),
               "reactions": g("reactions"), "notes": g("notes"), "offset": g("offset")}
    elif kind in ("diaper", "potty"):
        val = {"start": g("start"), "mode": g("mode"), "offset": g("offset")}
    elif kind in ("medication", "temperature"):
        val = deepcopy(e)
        val.update({"_id": key or doc_id, "type": "health", "multientry_key": doc_id if key else None,
                    "lastUpdated": g("lastUpdated") or now})
        if kind == "medication":
            val["isNight"] = False
    elif kind == "growth":
        val = deepcopy(e)
        val["_id"] = g("_id") or key or doc_id
    elif kind == "pump":
        val = {k: g(k) for k in ("start", "duration", "entryMode", "leftAmount", "rightAmount", "units", "offset")}
    else:
        val = {"start": g("start"), "offset": g("offset"), "duration": g("duration"), "end_offset": g("end_offset")}
    upd[f"prefs.{field}"] = {k: v for k, v in val.items() if v is not None or k == "multientry_key"}
    return upd


# ---------------------------------------------------------------- backups
def _backup_dir(hass: HomeAssistant) -> str:
    return hass.config.path(BACKUP_DIR)


async def _write_backup(hass: HomeAssistant, payload: dict) -> str:
    name = f"{int(time.time() * 1000)}_{payload['tracker']}_{payload['doc_id']}.json"

    def _write() -> None:
        os.makedirs(_backup_dir(hass), exist_ok=True)
        with open(os.path.join(_backup_dir(hass), name), "w", encoding="utf-8") as fh:
            json.dump(payload, fh, default=str, indent=1)

    await hass.async_add_executor_job(_write)
    return name


async def _read_backup(hass: HomeAssistant, name: str) -> dict:
    if "/" in name or "\\" in name or not name.endswith(".json"):
        raise ServiceValidationError("Bad backup name")

    def _read() -> dict:
        with open(os.path.join(_backup_dir(hass), name), encoding="utf-8") as fh:
            return json.load(fh)

    try:
        return await hass.async_add_executor_job(_read)
    except FileNotFoundError as err:
        raise ServiceValidationError(f"No backup {name}") from err


# ---------------------------------------------------------------- core mutation
async def _mutate(
    hass: HomeAssistant, api, child_uid: str, tracker: str, entry_id: str, revision: str | None, mutator, action: str
) -> dict[str, Any]:
    if tracker not in TRACKERS:
        raise ServiceValidationError(f"Unknown tracker {tracker}")
    doc_id, key = _split_id(entry_id)
    client = await _client(api)
    root_ref = client.collection(tracker).document(child_uid)
    target_ref = root_ref.collection(TRACKERS[tracker]).document(doc_id)
    target_doc, root_doc = await asyncio.gather(target_ref.get(), root_ref.get())
    if not target_doc.exists:
        raise ServiceValidationError("That entry no longer exists")
    if revision and target_doc.update_time and target_doc.update_time.isoformat() != revision:
        raise Conflict("That entry changed in the app; refresh and try again")
    document = target_doc.to_dict() or {}
    if key is None:
        if document.get("multi") is True:
            raise ServiceValidationError("Id points to a batch document; include the entry key")
        original = deepcopy(document)
    else:
        entries = document.get("data")
        if not isinstance(entries, dict) or not isinstance(entries.get(key), dict):
            raise ServiceValidationError("That entry no longer exists")
        original = deepcopy(entries[key])
    kind = kind_of(tracker, original)
    if kind is None:
        raise ServiceValidationError("This kind of entry can't be edited here")
    now = time.time()
    replacement = mutator(deepcopy(original), now, kind)
    if replacement is not None and kind_of(tracker, replacement) != kind:
        raise ServiceValidationError("An edit can't change the kind of entry")

    root = root_doc.to_dict() or {}
    prefs = root.get("prefs") or {}
    backup = await _write_backup(hass, {
        "action": action, "tracker": tracker, "child_uid": child_uid, "doc_id": doc_id, "key": key,
        "kind": kind, "entry": original, "document": document, "prefs": prefs,
        "saved_at": dt_util.now().isoformat(), "revision": target_doc.update_time.isoformat() if target_doc.update_time else None,
    })

    # Repair prefs.last* only when this entry is, was, or becomes the newest of its kind.
    pref_val = prefs.get(_pref_field(kind)) if isinstance(prefs, dict) else None
    pref_start = _start_s(pref_val) if isinstance(pref_val, dict) else None
    o_start = _start_s(original) or 0
    r_start = _start_s(replacement) if replacement is not None else None
    touch_prefs = (
        pref_start is None
        or abs(o_start - pref_start) < 1.5
        or (r_start is not None and r_start >= pref_start - 1)
    )
    latest = None
    if touch_prefs:
        latest = await _latest(api, child_uid, tracker, kind, (doc_id, key), replacement)

    batch = client.batch()
    t_opt = client.write_option(last_update_time=target_doc.update_time)
    if key is None:
        if replacement is None:
            batch.delete(target_ref, option=t_opt)
        else:
            fields = {f: DELETE_FIELD for f in original.keys() - replacement.keys()}
            fields.update(replacement)
            batch.update(target_ref, fields, option=t_opt)
    else:
        entries = deepcopy(document.get("data") or {})
        if replacement is None:
            entries.pop(key, None)
        else:
            entries[key] = replacement
        if entries:
            batch.update(target_ref, {"data": entries, "lastUpdated": now}, option=t_opt)
        else:
            batch.delete(target_ref, option=t_opt)
    if touch_prefs and root_doc.exists and root_doc.update_time is not None:
        batch.update(
            root_ref, _pref_payload(kind, latest, now),
            option=client.write_option(last_update_time=root_doc.update_time),
        )
    try:
        await batch.commit()
    except FailedPrecondition as err:
        raise Conflict("Huckleberry changed while saving; refresh and try again") from err

    if kind == "medication":
        await _repair_last_take(api, child_uid, original, replacement)
    _LOGGER.info("Huckleberry history: %s %s/%s (backup %s)", action, tracker, entry_id, backup)
    return {"id": entry_id, "tracker": tracker, "kind": kind, "backup": backup, "prefs_repaired": touch_prefs}


async def _repair_last_take(api, child_uid: str, original: dict, replacement: dict | None) -> None:
    """Keep health/types/{id}.lastTake equal to the newest dose of that medicine."""
    ids = {original.get("medication_id")}
    if replacement is not None:
        ids.add(replacement.get("medication_id"))
    client = await _client(api)
    health = client.collection("health").document(child_uid)
    for med_id in [i for i in ids if i]:
        best = None
        async for doc in (
            health.collection("data").where(filter=firestore.FieldFilter("medication_id", "==", med_id)).stream()
        ):
            d = doc.to_dict() or {}
            if best is None or (_start_s(d) or 0) > (_start_s(best) or 0):
                best = d
        if best is None:
            continue
        amount = _num(best.get("amount"))
        take = {"amount": amount if amount else None, "reminderType": "at", "units": best.get("units")}
        await health.collection("types").document(med_id).set({"lastTake": take}, merge=True)


# ---------------------------------------------------------------- public operations
def _apply_changes(hass: HomeAssistant, entry: dict, kind: str, ch: dict[str, Any], now: float) -> dict:
    """Apply friendly field changes to a raw entry."""
    start_raw = _num(entry.get("start")) or 0.0
    is_ms = start_raw > MS_THRESHOLD
    start = _start_s(entry) or 0.0
    old_dur = _duration(kind, entry) or 0.0
    new_start = start
    if ch.get("start_time") is not None:
        new_start = dt_util.as_utc(ch["start_time"]).timestamp()
        entry["start"] = new_start * 1000 if is_ms else (int(new_start) if kind == "sleep" else new_start)
        entry["offset"] = _offset_at(hass, new_start)
    new_end = None
    if ch.get("end_time") is not None:
        new_end = dt_util.as_utc(ch["end_time"]).timestamp()
    elif ch.get("duration") is not None:
        new_end = new_start + float(ch["duration"])
    elif ch.get("start_time") is not None and old_dur and (kind in ("sleep", "pump") or kind.startswith("activity:")):
        new_end = start + old_dur  # moving only the start keeps the end where it was
    if new_end is not None and new_end < new_start:
        raise ServiceValidationError("End must be after start")
    if new_end is not None:
        entry["end_offset"] = _offset_at(hass, new_end)

    if kind == "sleep":
        if new_end is not None:
            entry["duration"] = int(new_end - new_start)
        det = deepcopy(entry.get("details") or {})
        if "start_condition" in ch:
            det["startSleepCondition"] = {k: True for k in ch["start_condition"] if k in START_CONDITIONS}
        if "end_condition" in ch:
            det["endSleepCondition"] = {k: True for k in ch["end_condition"] if k in END_CONDITIONS}
        if "locations" in ch:
            det["sleepLocations"] = {k: True for k in ch["locations"] if k in LOCATIONS}
        if "notes" in ch:
            det["notes"] = ch["notes"] or ""
        det = {k: v for k, v in det.items() if v not in ({}, None)}
        if det:
            entry["details"] = det
        else:
            entry.pop("details", None)
    elif kind == "breast":
        left, right = _num(entry.get("leftDuration")) or 0.0, _num(entry.get("rightDuration")) or 0.0
        if ch.get("left") is not None or ch.get("right") is not None:
            left = float(ch.get("left", left))
            right = float(ch.get("right", right))
        elif new_end is not None:
            total = new_end - new_start
            if left and right:
                f = total / (left + right)
                left, right = round(left * f), total - round(left * f)
            elif right and not left:
                right = total
            else:
                left = total
        entry["leftDuration"], entry["rightDuration"] = float(left), float(right)
        if ch.get("last_side"):
            entry["lastSide"] = ch["last_side"]
    elif kind == "bottle":
        if ch.get("amount") is not None:
            entry["amount"] = float(ch["amount"])
        if ch.get("units"):
            entry["units"] = ch["units"]
        if ch.get("bottle_type"):
            entry["bottleType"] = ch["bottle_type"]
    elif kind in ("diaper", "potty"):
        if ch.get("mode"):
            entry["mode"] = ch["mode"]
        q = deepcopy(entry.get("quantity") or {})
        for side in ("pee", "poo"):
            if side in ch:
                if ch[side] in QTY:
                    q[side] = QTY[ch[side]]
                else:
                    q.pop(side, None)
        mode = entry.get("mode")
        if mode in ("pee", "dry"):
            q.pop("poo", None)
            entry.pop("color", None)
            entry.pop("consistency", None)
        if mode in ("poo", "dry"):
            q.pop("pee", None)
        if q:
            entry["quantity"] = q
        else:
            entry.pop("quantity", None)
        for src, dst in (("color", "color"), ("consistency", "consistency")):
            if src in ch and mode in ("poo", "both"):
                if ch[src]:
                    entry[dst] = ch[src]
                else:
                    entry.pop(dst, None)
        if "rash" in ch:
            if ch["rash"]:
                entry["diaperRash"] = True
            else:
                entry.pop("diaperRash", None)
    elif kind in ("medication", "temperature"):
        if ch.get("amount") is not None:
            entry["amount"] = float(ch["amount"])
        if ch.get("units"):
            entry["units"] = ch["units"]
        if ch.get("medication_id"):
            entry["medication_id"] = ch["medication_id"]
            entry["medication_name"] = ch["medication_name"]
    elif kind == "pump":
        if new_end is not None:
            entry["duration"] = float(new_end - new_start)
        if ch.get("left") is not None:
            entry["leftAmount"] = float(ch["left"])
        if ch.get("right") is not None:
            entry["rightAmount"] = float(ch["right"])
        if ch.get("units"):
            entry["units"] = ch["units"]
    elif kind.startswith("activity:"):
        if new_end is not None:
            entry["duration"] = float(new_end - new_start)
    if "notes" in ch and kind != "sleep":
        entry["notes"] = ch["notes"] or ""
    entry["lastUpdated"] = now
    return entry


async def async_update_entry(hass, api, child_uid, tracker, entry_id, revision, changes) -> dict:
    if changes.get("medicine"):
        wanted = str(changes["medicine"]).strip().casefold()
        types = await api.list_medicine_types(child_uid)
        match = next((t for t in types if t.name.strip().casefold() == wanted), None)
        if match is None:
            raise ServiceValidationError(f"Unknown medicine {changes['medicine']}")
        changes = {**changes, "medication_id": match.id_, "medication_name": match.name}
    return await _mutate(
        hass, api, child_uid, tracker, entry_id, revision,
        lambda e, now, kind: _apply_changes(hass, e, kind, changes, now), "update",
    )


async def async_delete_entry(hass, api, child_uid, tracker, entry_id, revision) -> dict:
    return await _mutate(hass, api, child_uid, tracker, entry_id, revision, lambda e, now, kind: None, "delete")


async def async_merge_sleeps(hass, api, child_uid, first_id, first_rev, second_id, second_rev) -> dict:
    """Join two sleeps into the first one (SNOO safety stops split one sleep in two)."""
    entries = {}
    client = await _client(api)
    sub = client.collection("sleep").document(child_uid).collection("intervals")
    for eid in (first_id, second_id):
        doc_id, key = _split_id(eid)
        doc = await sub.document(doc_id).get()
        data = doc.to_dict() or {}
        entries[eid] = (data.get("data") or {}).get(key) if key else data
        if not entries[eid]:
            raise ServiceValidationError("One of the sleeps no longer exists")
    a, b = entries[first_id], entries[second_id]
    start = min(_start_s(a), _start_s(b))
    end = max(_start_s(a) + (_num(a.get("duration")) or 0), _start_s(b) + (_num(b.get("duration")) or 0))
    tz = dt_util.get_time_zone(hass.config.time_zone)
    deleted = await async_delete_entry(hass, api, child_uid, "sleep", second_id, second_rev)
    updated = await async_update_entry(
        hass, api, child_uid, "sleep", first_id, first_rev,
        {"start_time": datetime.fromtimestamp(start, tz), "end_time": datetime.fromtimestamp(end, tz)},
    )
    return {"updated": updated, "deleted": deleted, "backups": [updated["backup"], deleted["backup"]]}


async def async_restore_entry(hass, api, child_uid: str, backup_name: str) -> dict:
    """Undo: put the backed-up entry back under its original id, then repair prefs."""
    saved = await _read_backup(hass, backup_name)
    if saved.get("child_uid") != child_uid:
        raise ServiceValidationError("Backup belongs to another child")
    tracker, doc_id, key, entry = saved["tracker"], saved["doc_id"], saved.get("key"), saved["entry"]
    client = await _client(api)
    ref = client.collection(tracker).document(child_uid).collection(TRACKERS[tracker]).document(doc_id)
    if key is None:
        await ref.set(entry)
    else:
        current = (await ref.get()).to_dict() or {}
        data = current.get("data") if current.get("multi") is True else None
        if not isinstance(data, dict):
            data = {}
            current = {k: v for k, v in (saved.get("document") or {}).items() if k != "data"}
            current["multi"] = True
        data[key] = entry
        current["data"] = data
        current["lastUpdated"] = time.time()
        await ref.set(current)
    # Recompute prefs from scratch for this kind.
    kind = saved["kind"]
    latest = await _latest(api, child_uid, tracker, kind, ("", "__none__"), None)
    await client.collection(tracker).document(child_uid).update(_pref_payload(kind, latest, time.time()))
    if kind == "medication":
        await _repair_last_take(api, child_uid, entry, None)
    _LOGGER.info("Huckleberry history: restored %s/%s from %s", tracker, doc_id, backup_name)
    return {"id": f"{doc_id}/{key}" if key else doc_id, "tracker": tracker, "restored": True}


async def async_repair_prefs(hass, api, child_uid: str) -> list[str]:
    """Heal stale prefs.last* (HA issue #47): only when they point at an entry that no longer exists."""
    fixed = []
    client = await _client(api)
    checks = [
        ("sleep", "sleep"), ("feed", "breast"), ("feed", "bottle"), ("diaper", "diaper"),
        ("health", "medication"), ("pump", "pump"),
    ] + [("activities", f"activity:{m}") for m in ACTIVITY_LAST_FIELD]
    roots: dict[str, dict] = {}
    for tracker, kind in checks:
        try:
            if tracker not in roots:
                roots[tracker] = ((await client.collection(tracker).document(child_uid).get()).to_dict() or {}).get("prefs") or {}
            pref = roots[tracker].get(_pref_field(kind))
            latest = await _latest(api, child_uid, tracker, kind, ("", "__none__"), None)
            l_start = _start_s(latest[0]) if latest else None
            p_start = _start_s(pref) if isinstance(pref, dict) else None
            if (l_start or 0) == 0 and p_start is None:
                continue
            if p_start is not None and l_start is not None and abs(p_start - l_start) < 1.5:
                continue
            if p_start is None or l_start is None or l_start > p_start or p_start - l_start > 1.5:
                await client.collection(tracker).document(child_uid).update(_pref_payload(kind, latest, time.time()))
                fixed.append(kind)
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("Huckleberry prefs repair %s/%s skipped: %s", tracker, kind, err)
    if fixed:
        _LOGGER.info("Huckleberry history: repaired stale prefs %s", fixed)
    return fixed
