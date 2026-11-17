---
section: Added
---
Heart rate per set from an attached watch file: when a FIT, TCX or GPX
recording is attached to a session, its heart rate is split over the logged
sets (from the previous set's log time, or the session start, to the set's own
log time) and each set shows its average and peak in the session page of
History ("HR avg/peak", 11 locales). The coach receives the two values per set
and the JSON backup carries them (version 13). They live in two new columns,
so the heart rate logged on a cardio set and the conditioning numbers are
untouched, and removing the file clears exactly what it wrote. Also fixed: the
session peak is read from every sample of the file, not from the downsampled
stored curve, which could miss it on a long recording (#576).
