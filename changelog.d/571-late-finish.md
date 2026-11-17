---
section: Fixed
---
A session finished late ends at its last set: when Finish is tapped more than
30 minutes after the last logged set (hours later, or the next morning),
`finishedAt` is the time of that set instead of the time of the tap, so the
duration in the history, the stats and the coach payload is the real one. A
prompt finish and a session without sets still end at the tap (#571).
