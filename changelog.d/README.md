# Changelog fragments

A pull request records its user-facing change here, in a new file, instead of
editing `CHANGELOG.md`. Two PRs then never edit the same lines, so merging
`main` into a branch does not conflict on the changelog (lesson L47 in
`docs/loops/lessons.md`).

One file per change, named `<issue-or-pr>-<slug>.md` in lowercase, for
example `376-mcp-body-cap.md`:

```markdown
---
section: Fixed
---
`/mcp` refuses a request body over 8 MiB with `413`, counted on the bytes
read (#376).
```

- `section` is one of `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
  `Security` (Keep a Changelog).
- The text is one entry, written as it will read in `CHANGELOG.md` but without
  its `- ` bullet and without blank lines. Wrap it as you like; the assembler
  indents the continuation lines.
- No em or en dashes; use a hyphen.

Check the fragments:

```bash
npx tsx automation/changelog/assemble.ts --check
```

The green gate (`scripts/verify.sh`) runs the same check. At release time, or
in a write-up PR, a maintainer folds every fragment into `## [Unreleased]`
(newest number first, at the top of its section) and deletes the files:

```bash
npx tsx automation/changelog/assemble.ts
```
