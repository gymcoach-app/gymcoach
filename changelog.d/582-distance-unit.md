---
section: Added
---
Distance unit setting: Settings > Profile has a "Distance unit" choice
(Automatic, Kilometers, Miles). The cardio set logger, cardio targets in the
program editor and the workout card, the session summary, the history, the
print sheet, the share card, the copied workout text, the import previews and
the conditioning card type and show distance, pace and speed in that unit.
Automatic, the default for every account, follows the weight unit: miles
with pounds, kilometers with kilograms. Behavior change for accounts on
pounds: cardio distance, which was typed and shown in kilometers next to a
pace per mile, is now typed and shown in miles; pick Kilometers to keep the
old input. Distances stay stored in meters and are converted once, when
typed: re-saving a target or logging a prefilled distance keeps the stored
value. The coach payload, the CSV and TCX exports and the MCP tools stay
metric. Backups carry the preference (format version 14; older backups keep
the account's setting) (#582).
