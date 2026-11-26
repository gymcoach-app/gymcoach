---
section: Fixed
---
Signing up writes the account and its starter exercise catalog in one
database transaction instead of about fifty: the form answers faster on a busy
server, a failure can no longer leave an account with half a catalog whose
email cannot be registered again, and the same signup sent twice at once
(a double tap) answers `409` for the second one instead of a server error
(#593).
