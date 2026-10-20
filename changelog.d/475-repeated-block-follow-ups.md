---
section: Fixed
---
A lift a workout programs twice (5/3/1 BBB) now reads each block on its own
everywhere: the return-to-training load anchors on that block's past sets, the
history CSV export gains a trailing `block` column that the GymCoach CSV
import reads back (older files without it still import), backup restore
normalizes the block against the restored workout, a set stored on a since
removed row counts as the first block in the last-session lookup, the history
detail counts the lift once in its Exercises total, and the coach prompt
explains the `block` field (#475).
