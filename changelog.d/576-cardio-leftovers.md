---
section: Fixed
---
Cardio leftovers from #558: on the print sheet a cardio exercise now has a
duration box and a distance box, with its target pre-printed when set, instead
of weight, reps and RIR boxes. The target text ("20 min", "20 min · 5 km") is
written in the reader's language in all 11 locales (unit names and decimal
mark), in the program editor, the workout card and the print sheet; the coach
payload keeps plain numbers. The distance of a cardio target follows the unit
the set logger uses through one shared rule (kilometers for every user today;
storage stays in meters) (#576).
