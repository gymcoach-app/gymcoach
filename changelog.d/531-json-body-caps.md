---
section: Security
---

Every JSON request body is read under a byte cap, so one huge body can no
longer exhaust memory before validation: 1 MiB for routes without their own
cap, 16 KiB for login, signup, the language switch and program activation,
and a 413 past it. Login now answers invalid JSON with 400 instead of 500.
