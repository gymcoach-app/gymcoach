---
section: Added
---
Strava archive import: Settings, Import training history accepts the zip of
Strava's "Download your data". The archive is unzipped in the browser as a
stream (photos and videos are never read) and its activity files (`.fit`,
`.gpx`, `.tcx`, also `.gz`) go through the existing FIT, GPX and TCX imports
in a rate-limit aware queue, with one combined preview before anything is
written, a cancel button, duplicates left out and manual entries without a
file counted as skipped (#582).
