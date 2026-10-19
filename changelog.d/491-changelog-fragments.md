---
section: Changed
---
Changelog entries are now fragments: a pull request adds
`changelog.d/<issue-or-pr>-<slug>.md` instead of editing `CHANGELOG.md`, and
`automation/changelog/assemble.ts` folds them into the Unreleased section in
the write-up PR (`--check` validates them in the green gate). Sibling PRs no
longer conflict on the changelog after each merge, so a merge of `main` stays a
pure base update whose review records carry over (lesson L47, #491).
