---
section: Security
---

The weekly coach debrief (`POST /api/coach`) is rate-limited per user, 3 a
minute and 20 a day, like the chat and the program generator already were:
each call spends the instance's AI budget and stores a row.
