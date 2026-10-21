---
section: Fixed
---
The eval harness's `test-globals` tamper rule now screens test hooks reached
through the global object, not only bare names: a syntax-tree screen
(`evals/maintainer/test-globals.ts`) parses each changed application file and
fails the run on any use of a test global by its cooked name (an escaped
spelling included), `globalThis.beforeEach`, a non-literal key such as
`globalThis['after' + 'Each']`, an alias or destructuring (renamed included)
of `globalThis`, `global`, `self`, `window`, the jsdom names `top`, `parent`
and `frames` or any `.defaultView`, the global object handed to a call, a
spread or an export, and a test global taken as a value. A new
`identifier-escape` rule fails any identifier spelled with a unicode escape,
which the lexical rules (eval, the Function constructor) cannot read. A hit on
an added or changed line is always blamed. Part (b) of the known canary
bypasses is screened, not closed: a global object obtained in a form the
screen does not name, or imported from a module it does not read, stays open,
as does part (a), and the paid agent stays disabled (#468).
