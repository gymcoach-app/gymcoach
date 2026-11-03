---
section: Fixed
---
Switching language during an active workout no longer duplicates logged sets. The hydration step now removes existing synced rows before inserting server-side copies, preventing duplicates when a set exists with both a generated localId and a srv_ prefixed one. Pending edits and equipment-dropped notices are preserved during this process.
