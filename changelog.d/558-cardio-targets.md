---
section: Added
---
Programs: a cardio exercise in a workout is prescribed by a duration and an
optional distance instead of sets, reps, RIR and rest. The editor asks for
"Duration (min)" and "Distance (km, optional)" and hides the strength fields;
the workout card, the print sheet and the live session read "20 min" or
"20 min · 5 km", and a cardio exercise without a target shows a neutral label
instead of "1 set x 1 rep". In a session the duration and distance inputs start
from the target. Stored in two new nullable columns
(`ProgramExercise.targetDurationSec`, `targetDistanceM`), carried by the backup
(format version 12, older files still import) and named to the coach as
`targetDurationMin` / `targetDistanceKm` (#558).
