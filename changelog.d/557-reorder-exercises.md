---
section: Added
---
Program editor: "Move up" and "Move down" in an exercise's three-dot menu
change the order of a workout's exercises. The order is saved and the next
session follows it. A superset moves as one block, so A1/A2 stay together,
and a standalone exercise jumps over a whole superset. Saved through the new
`PUT /api/workouts/[id]/order`, which only accepts the complete list of the
workout's exercises (#557).
