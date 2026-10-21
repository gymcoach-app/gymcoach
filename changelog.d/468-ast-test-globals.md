---
section: Fixed
---
The eval harness's `test-globals` tamper rule no longer misses test hooks
reached through the global object: a syntax-tree screen
(`evals/maintainer/test-globals.ts`) parses each changed application file and
fails the run on `globalThis.beforeEach`, a non-literal key such as
`globalThis['after' + 'Each']`, an alias or destructuring of `globalThis`,
`global`, `self` or `window`, the global object handed to a call, a spread or
an export, and a test global taken as a value; only what the base does not
already contain is blamed. This closes part (b) of the known canary bypasses;
part (a) stays open and the paid agent stays disabled (#468).
