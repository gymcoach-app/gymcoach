---
section: Fixed
---
The Strong import reads the warm-up (`W`), failure (`F`) and drop set (`D`)
markers of the Set Order column instead of rejecting those lines: a warm-up
or drop set keeps its flag, and the sets of that exercise are numbered in
file order. Rest Timer and Note rows are skipped with a count in the preview
instead of being reported as unreadable or imported as a cardio set (#571).
