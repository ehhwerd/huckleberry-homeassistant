# Fork notes (ehhwerd)

Adds to upstream Woyken/huckleberry-homeassistant:

- `huckleberry.log_medicine`, `huckleberry.list_medicine_types`.
- `isNight` compatibility fix for `prefs.lastMedication` (`compat.py`).
- `start_time` on the `log_diaper_*` services (backdated nappies).
- History editing (`history.py`, logic from py-huckleberry-api PR #54, extended to every tracker):
  `list_entries`, `update_entry`, `delete_entry`, `restore_entry` (undo from JSON backup in
  `/config/huckleberry_backups`), `merge_sleeps`, `repair_prefs` (also every 30 min).
- Calendar events carry `uid` = Firestore doc id (`doc/key` for batched rows).
