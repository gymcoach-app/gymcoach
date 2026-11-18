---
section: Changed
---
Loop tooling: the merge gate carries a review record over to a newer head by
itself when the commits added since the reviewed head are only merges of
`main` and the PR's diff is identical (`git patch-id --stable`, same file
list, same blobs), and prints which rule carried it; records are no longer
re-posted by hand after an `update-branch` (#582).
