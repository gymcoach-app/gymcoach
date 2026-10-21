---
section: Fixed
---
The eval harness's `test-globals` tamper rule now screens test hooks reached
through the global object, not only bare names. A fail-closed syntax-tree
screen (`evals/maintainer/test-globals.ts`) parses each changed application
file and fails the run on any use of a test global by its cooked name, a
test hook name (`afterEach`, ...) as a member, key or string on any receiver,
an assertion API name (`expect`, `vi`, `chai`, `assert`) read off a value
derived from a non-literal computed read or the global object, any mention of
`Reflect` or `getOwnPropertyDescriptor(s)`, a computed-key read of a global
object, `document`, an `.ownerDocument` or an alias of one, a non-literal
computed member called or read again on a changed line, an alias or
destructuring (renamed included) of `globalThis`, `global`, `self`, `window`,
`top`, `parent`, `frames` (by name, whatever the scope) or any `.defaultView`,
the global object handed to a call, a spread or an export, a test global taken
as a value, and any declaration of a test global name. A new
`identifier-escape` rule fails an identifier spelled with a unicode escape and
a module specifier with a backslash, and the specifier rules also read each
specifier's cooked text (`'vit\x65st'`). Part (b) of the known canary bypasses
is screened, not closed: a global object obtained in a form the screen does
not name or imported from a module it does not read, and a non-literal read of
an object the screen does not track, stored in a variable and then used, stay
open (only part (a)'s runtime probes and the diff review of paid runs backstop
them); part (a) is open and the paid agent stays disabled (#468).
