"""Calendar platform for Huckleberry integration."""
from __future__ import annotations

import dataclasses
import logging
from datetime import datetime

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from huckleberry_api import HuckleberryAPI
from huckleberry_api.firebase_types import (
    FirebaseActivityIntervalData,
    FirebaseDiaperData,
    FirebaseFeedIntervalData,
    FirebasePumpIntervalData,
    FirebaseSleepIntervalData,
    HealthDataEntry,
)
from pydantic import TypeAdapter

from . import history

from . import HuckleberryDataUpdateCoordinator, HuckleberryEntryData
from .const import DOMAIN
from .entity import HuckleberryBaseEntity
from .features.calendar_events import (
    build_activity_events,
    build_diaper_events,
    build_feed_events,
    build_health_events,
    build_pump_events,
    build_sleep_events,
)
from .models import HuckleberryChildProfile

_LOGGER = logging.getLogger(__name__)

_FEED = TypeAdapter(FirebaseFeedIntervalData)
_HEALTH = TypeAdapter(HealthDataEntry)


def _feed_builder(models):
    feed_events, bottle_events = build_feed_events(models)
    return [*feed_events, *bottle_events]


# Fork: events carry uid = Firestore doc id ("doc/key" for batched rows).
_UID_TRACKERS = {
    "sleep": (FirebaseSleepIntervalData.model_validate, build_sleep_events),
    "feed": (_FEED.validate_python, _feed_builder),
    "diaper": (FirebaseDiaperData.model_validate, build_diaper_events),
    "health": (_HEALTH.validate_python, build_health_events),
    "pump": (FirebasePumpIntervalData.model_validate, build_pump_events),
    "activities": (FirebaseActivityIntervalData.model_validate, build_activity_events),
}


async def _events_with_uid(api, child_uid, tracker, start_date, end_date) -> list[CalendarEvent]:
    validate, build = _UID_TRACKERS[tracker]
    out: list[CalendarEvent] = []
    for entry_id, raw in await history.async_list_raw(api, child_uid, tracker, start_date, end_date):
        raw = dict(raw)
        start = history._start_s(raw)  # noqa: SLF001
        if start is not None:
            raw["start"] = start
        try:
            model = validate(raw)
        except Exception:  # noqa: BLE001
            continue
        out.extend(dataclasses.replace(ev, uid=entry_id) for ev in build([model]))
    return out


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Huckleberry calendar from a config entry."""
    data: HuckleberryEntryData = hass.data[DOMAIN][entry.entry_id]
    api = data["api"]
    coordinator = data["coordinator"]
    children = data["children"]

    entities = []
    for child in children:
        entities.append(HuckleberryCalendar(coordinator, child, api))

    async_add_entities(entities)


class HuckleberryCalendar(HuckleberryBaseEntity, CalendarEntity):
    """Calendar entity for Huckleberry events."""

    _attr_has_entity_name = True
    _attr_translation_key = "events"

    def __init__(
        self,
        coordinator: HuckleberryDataUpdateCoordinator,
        child: HuckleberryChildProfile,
        api: HuckleberryAPI,
    ) -> None:
        """Initialize the calendar."""
        super().__init__(coordinator, child)
        self._api = api
        self._attr_unique_id = f"{child.uid}_calendar"
        self._events: list[CalendarEvent] = []

    @property
    def event(self) -> CalendarEvent | None:
        """Return the next upcoming event."""
        now = dt_util.now()
        upcoming = [e for e in self._events if e.start > now]
        return min(upcoming, key=lambda e: e.start) if upcoming else None

    async def async_get_events(
        self,
        hass: HomeAssistant,
        start_date: datetime,
        end_date: datetime,
    ) -> list[CalendarEvent]:
        """Get events between start and end date."""
        _LOGGER.debug(
            "Fetching calendar events for %s from %s to %s",
            self.child_name,
            start_date,
            end_date,
        )

        events: list[CalendarEvent] = []

        for tracker in _UID_TRACKERS:
            try:
                events.extend(await _events_with_uid(self._api, self.child_uid, tracker, start_date, end_date))
                continue
            except Exception as err:  # noqa: BLE001
                _LOGGER.debug("Calendar uid path failed for %s, using library list: %s", tracker, err)
            events.extend(await self._legacy_events(tracker, start_date, end_date))

        events.sort(key=lambda e: e.start)
        self._events = events
        _LOGGER.debug("Found %d events for %s", len(events), self.child_name)
        return events

    async def _legacy_events(self, tracker: str, start_date: datetime, end_date: datetime) -> list[CalendarEvent]:
        """Upstream path (no uid), used only if the fork's raw listing fails."""
        uid = self.child_uid
        try:
            if tracker == "sleep":
                return build_sleep_events(await self._api.list_sleep_intervals(uid, start_date, end_date))
            if tracker == "feed":
                return _feed_builder(await self._api.list_feed_intervals(uid, start_date, end_date))
            if tracker == "diaper":
                return build_diaper_events(await self._api.list_diaper_intervals(uid, start_date, end_date))
            if tracker == "health":
                return build_health_events(await self._api.list_health_entries(uid, start_date, end_date))
            if tracker == "pump":
                return build_pump_events(await self._api.list_pump_intervals(uid, start_date, end_date))
            return build_activity_events(await self._api.list_activity_intervals(uid, start_date, end_date))
        except Exception as err:  # noqa: BLE001
            _LOGGER.error("Error fetching %s events: %s", tracker, err)
            return []
