"""Compatibility fixes for huckleberry-api models (fork).

The app saves ``prefs.lastMedication`` without ``isNight`` but huckleberry-api (0.4.9-0.4.11)
requires it, so the health document fails validation (medicine saves and the health listener
error). Make the field optional. No-op once the library does this itself.
"""
from __future__ import annotations

import logging

_LOGGER = logging.getLogger(__name__)


def apply() -> None:
    try:
        from huckleberry_api import firebase_types as ft

        field = ft.FirebaseLastMedicationData.model_fields.get("isNight")
        if field is None or not field.is_required():
            _LOGGER.debug("Huckleberry isNight fix: not needed")
            return
        field.default = None
        field.annotation = bool | None
        for name in ("FirebaseLastMedicationData", "FirebaseHealthPrefs", "FirebaseHealthDocumentData"):
            model = getattr(ft, name, None)
            if model is not None:
                model.model_rebuild(force=True)
        _LOGGER.info("Huckleberry isNight fix: applied")
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Huckleberry isNight fix failed: %s", err)


apply()
