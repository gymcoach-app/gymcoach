---
section: Security
---
Shared devices: offline sets are tagged with the account that logged them, so
the offline badge and the sync only see the signed-in account's queue; another
account's unsynced sets stay on the device, hidden, and sync when it signs in
again. A tab left open for a previous account stops syncing once another tab
signs in or out. Sets queued before this change are sent by the next sync and
tagged with its account only when the server accepts them; one refused as
another account's session waits for its owner (#490).
