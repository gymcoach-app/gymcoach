---
section: Security
---
Shared devices: offline sets are tagged with the account that logged them, so
the offline badge and the sync only see the signed-in account's queue; another
account's unsynced sets stay on the device, hidden, and sync when it signs in
again. Sets queued before this change wait until their session page is opened
again by its owner (#490).
