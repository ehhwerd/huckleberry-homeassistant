"""Fork services: medicine, history list / edit / delete / undo / merge, prefs repair."""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

import voluptuous as vol
from homeassistant.const import CONF_DEVICE_ID
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util import dt as dt_util

from . import history
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

_DEV = {vol.Required(CONF_DEVICE_ID): cv.string}
LOG_MEDICINE_SCHEMA = vol.Schema({
    **_DEV,
    vol.Required("medicine"): cv.string,
    vol.Optional("amount"): vol.Coerce(float),
    vol.Optional("units", default="drops"): vol.In(["ml", "oz", "tsp", "drops"]),
    vol.Optional("start_time"): cv.datetime,
    vol.Optional("notes"): cv.string,
})
LIST_SCHEMA = vol.Schema({
    **_DEV,
    vol.Required("start"): cv.datetime,
    vol.Required("end"): cv.datetime,
    vol.Optional("trackers"): vol.All(cv.ensure_list, [vol.In(list(history.TRACKERS))]),
})
_ENTRY = {**_DEV, vol.Required("tracker"): vol.In(list(history.TRACKERS)), vol.Required("id"): cv.string,
          vol.Optional("revision"): cv.string}
_LEVEL = vol.Any(None, "", "none", "little", "medium", "big")
UPDATE_SCHEMA = vol.Schema({
    **_ENTRY,
    vol.Optional("start_time"): cv.datetime,
    vol.Optional("end_time"): cv.datetime,
    vol.Optional("duration"): vol.Coerce(float),
    vol.Optional("notes"): vol.Any(None, cv.string),
    vol.Optional("start_condition"): vol.All(cv.ensure_list, [cv.string]),
    vol.Optional("end_condition"): vol.All(cv.ensure_list, [cv.string]),
    vol.Optional("locations"): vol.All(cv.ensure_list, [cv.string]),
    vol.Optional("left"): vol.Coerce(float),
    vol.Optional("right"): vol.Coerce(float),
    vol.Optional("last_side"): vol.In(["left", "right"]),
    vol.Optional("amount"): vol.Coerce(float),
    vol.Optional("units"): cv.string,
    vol.Optional("bottle_type"): cv.string,
    vol.Optional("mode"): vol.In(["pee", "poo", "both", "dry"]),
    vol.Optional("pee"): _LEVEL,
    vol.Optional("poo"): _LEVEL,
    vol.Optional("color"): vol.Any(None, cv.string),
    vol.Optional("consistency"): vol.Any(None, cv.string),
    vol.Optional("rash"): cv.boolean,
    vol.Optional("medicine"): cv.string,
})
DELETE_SCHEMA = vol.Schema(_ENTRY)
RESTORE_SCHEMA = vol.Schema({**_DEV, vol.Required("backup"): cv.string})
MERGE_SCHEMA = vol.Schema({
    **_DEV,
    vol.Required("first_id"): cv.string, vol.Optional("first_revision"): cv.string,
    vol.Required("second_id"): cv.string, vol.Optional("second_revision"): cv.string,
})
BOTTLE_TYPES = {
    "formula": "Formula", "breast_milk": "Breast Milk", "tube_feeding": "Tube Feeding",
    "cow_milk": "Cow Milk", "goat_milk": "Goat Milk", "soy_milk": "Soy Milk", "other": "Other",
}


def async_register(hass: HomeAssistant, entry, api, coordinator, child_uid_from_call, string_value) -> None:
    """Register the fork's extra services for one config entry."""

    def child(call: ServiceCall) -> str:
        return child_uid_from_call(hass, call)

    async def log_medicine(call: ServiceCall) -> None:
        uid = child(call)
        wanted = str(call.data["medicine"]).strip().casefold()
        types = await api.list_medicine_types(uid)
        match = next((t for t in types if t.name.strip().casefold() == wanted), None)
        if match is None:
            raise ServiceValidationError(
                f"Unknown medicine '{call.data['medicine']}'. Known: " + ", ".join(t.name for t in types)
            )
        start_time = call.data.get("start_time")
        amount = call.data.get("amount")
        await api.log_medicine(
            uid,
            start_time=dt_util.as_local(start_time) if start_time is not None else dt_util.now(),
            medicine_type=match,
            amount=amount,
            units=call.data.get("units") if amount is not None else None,
            notes=string_value(call.data.get("notes")) or "",
        )

    async def list_medicine_types(call: ServiceCall) -> dict[str, Any]:
        types = await api.list_medicine_types(child(call))
        return {"medicines": [t.name for t in types]}

    async def list_entries(call: ServiceCall) -> dict[str, Any]:
        start, end = dt_util.as_local(call.data["start"]), dt_util.as_local(call.data["end"])
        if end - start > timedelta(days=400):
            raise ServiceValidationError("Range is limited to 400 days")
        entries = await history.async_list_entries(hass, api, child(call), start, end, call.data.get("trackers"))
        return {"entries": entries, "count": len(entries)}

    async def update_entry(call: ServiceCall) -> dict[str, Any]:
        changes = {k: v for k, v in call.data.items() if k not in (CONF_DEVICE_ID, "tracker", "id", "revision")}
        if changes.get("bottle_type") in BOTTLE_TYPES:
            changes["bottle_type"] = BOTTLE_TYPES[changes["bottle_type"]]
        for side in ("pee", "poo"):
            if side in changes and changes[side] in (None, "", "none"):
                changes[side] = None
        return await history.async_update_entry(
            hass, api, child(call), call.data["tracker"], call.data["id"], call.data.get("revision"), changes
        )

    async def delete_entry(call: ServiceCall) -> dict[str, Any]:
        return await history.async_delete_entry(
            hass, api, child(call), call.data["tracker"], call.data["id"], call.data.get("revision")
        )

    async def restore_entry(call: ServiceCall) -> dict[str, Any]:
        return await history.async_restore_entry(hass, api, child(call), call.data["backup"])

    async def merge_sleeps(call: ServiceCall) -> dict[str, Any]:
        d = call.data
        return await history.async_merge_sleeps(
            hass, api, child(call), d["first_id"], d.get("first_revision"), d["second_id"], d.get("second_revision")
        )

    async def repair_prefs(call: ServiceCall) -> dict[str, Any]:
        return {"repaired": await history.async_repair_prefs(hass, api, child(call))}

    opt = SupportsResponse.OPTIONAL
    hass.services.async_register(DOMAIN, "log_medicine", log_medicine, schema=LOG_MEDICINE_SCHEMA)
    hass.services.async_register(
        DOMAIN, "list_medicine_types", list_medicine_types,
        schema=vol.Schema(_DEV), supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN, "list_entries", list_entries, schema=LIST_SCHEMA, supports_response=SupportsResponse.ONLY
    )
    hass.services.async_register(DOMAIN, "update_entry", update_entry, schema=UPDATE_SCHEMA, supports_response=opt)
    hass.services.async_register(DOMAIN, "delete_entry", delete_entry, schema=DELETE_SCHEMA, supports_response=opt)
    hass.services.async_register(DOMAIN, "restore_entry", restore_entry, schema=RESTORE_SCHEMA, supports_response=opt)
    hass.services.async_register(DOMAIN, "merge_sleeps", merge_sleeps, schema=MERGE_SCHEMA, supports_response=opt)
    hass.services.async_register(
        DOMAIN, "repair_prefs", repair_prefs, schema=vol.Schema(_DEV), supports_response=opt
    )

    async def _periodic_repair(_now) -> None:
        for kid in coordinator.children:
            try:
                await history.async_repair_prefs(hass, api, kid.uid)
            except Exception as err:  # noqa: BLE001
                _LOGGER.debug("Huckleberry periodic prefs repair failed: %s", err)

    entry.async_on_unload(async_track_time_interval(hass, _periodic_repair, timedelta(minutes=30)))
