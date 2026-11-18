---
section: Fixed
---
Apple Health import, hardened: the routes, ECGs and clinical document of an
`export.zip` are dropped as they are read instead of being kept in memory,
only the first export file of an archive is read, an export that unpacks to
more than 2 GB is refused early with a message, a malformed file can no longer
make the scan take minutes, a workout saved twice in the export is counted as
a duplicate in the preview wherever it falls (preview and import now agree),
and "one body weight entry a day" uses the day of the phone's time zone
instead of the UTC day, also across a daylight saving change. An archive of
more than 50 000 files is refused with a message, in the Apple Health and in
the Strava import (#582).
