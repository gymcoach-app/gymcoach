---
section: Fixed
---
The eval harness's `test-globals` tamper rule now screens test hooks reached
through the global object, not only bare names. A fail-closed syntax-tree
screen (`evals/maintainer/test-globals.ts`) parses each changed application
file and fails the run on any use of a test global by its cooked name,
`globalThis.beforeEach`, a computed-key read of a global object, `document` or
an `.ownerDocument`, a `Reflect.*` or `Object.getOwnPropertyDescriptor(s)` call
on one of them, an alias or destructuring (renamed included) of `globalThis`,
`global`, `self`, `window`, `top`, `parent`, `frames` (by name, whatever the
scope) or any `.defaultView`, the global object handed to a call, a spread or
an export, a test global taken as a value, and any declaration of a global
object or test global name. A new `identifier-escape` rule fails an identifier
spelled with a unicode escape and a module specifier with a backslash, and the
specifier rules also read each specifier's cooked text (`'vit\x65st'`). Part
(b) of the known canary bypasses is screened, not closed: a global object
obtained in a form the screen does not name, imported from a module it does
not read or held by another object, stays open, as does part (a), and the paid
agent stays disabled (#468).
