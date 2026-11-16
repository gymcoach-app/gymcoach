---
section: Added
---
**Attach a watch file to a session.** The page of a session in History has
an "Attach a watch file" action: pick the FIT, TCX or GPX recording of that
workout and its average heart rate, peak heart rate and heart rate curve are
stored on the session itself, instead of importing the file as a separate
cardio session. A preview shows what was read before anything is saved and
warns when the recording starts more than 6 hours from the session; a second
file replaces the first, "Remove" clears it, and a file without heart rate is
refused. The coach receives the two values with the session and reads them
as the overall cardiovascular load of the session, never as the effort of a
set or a health signal. The JSON backup (now version 11) carries the three
new fields both ways (#562).
