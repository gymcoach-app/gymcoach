# 05 — The content loop (publish the démarche)

The product is the gym app. The **growth engine** is the meta-story: *this repo maintains
itself with documented loops.* That story only compounds into stars if it stays current
and true. The content loop is the tail of the pipeline: after work ships, it updates the
CHANGELOG and the `docs/loops/` playbook so the démarche keeps pace with reality. The unit
is the `write-up` skill (`.claude/skills/write-up/`).

## The body is one sentence

> gather what merged since the last write-up -> update CHANGELOG + playbook (truthfully)
> -> open a docs PR.

## Running it

```
/loop Run the write-up skill. Look at what merged to main since the last CHANGELOG entry,
move the user-facing changes into the right Unreleased group, and update docs/loops if a
new loop or skill shipped. Verify every claim against the merged code. Open one docs PR.
STOP after one write-up.
```

## Truth is the only feature

A changelog that drifts is worse than none - it makes the whole "self-maintaining"
narrative look fake. So the one rule that overrides everything: **every claim is checked
against merged code or the merged diff before it is written.** No documenting unmerged
work as shipped; no marketing adjectives; skip internal churn unless the infrastructure
*is* the story (here, it often is).

## The three hard stops

1. **Max output** - one docs PR per run.
2. **No-progress detection** - nothing user-facing merged since the last write-up means
   write nothing and say so.
3. **Budget ceiling** - token target on the turn.

## Docs only, and it does not merge itself

The content loop writes only docs and demo media (CHANGELOG, `docs/loops/*`, README
touch-ups, `docs/screenshots/*` and the scripts that produce them) and opens a PR like any
other change. The ship loop (`04`) merges it once CI is green. Same discipline as
everything else: one small, verified change; the gate decides.

Per the 2026-06-10 operator directive: the README features list and roadmap are refreshed
on EVERY batch that ships a user-facing capability; the screenshots/GIFs are refreshed
periodically (re-shoot a screenshot when its page visibly changed; re-record the clips
before they lag more than ~3 batches or misrepresent a flagship flow). The write-up skill
carries the full procedure.

## Changelog fragments (since 2026-10-19)

PRs no longer edit `CHANGELOG.md`. Each adds one file in
[`changelog.d/`](../../changelog.d/README.md) (`<issue-or-pr>-<slug>.md`, a `section`
front matter, one entry), checked by `npx tsx automation/changelog/assemble.ts --check` in
the green gate. The write-up PR runs `npx tsx automation/changelog/assemble.ts`, which
inserts each fragment at the top of its Unreleased section, skips an entry already present
as a whole entry (#492) and deletes the files; the write-up then edits the result like any
other text (dedupe, add the PR and issue numbers). The write-up PR is the only one that
edits `CHANGELOG.md`, so sibling PRs stop conflicting on it (lesson L47, #491). A PR that
records no fragment (maintainer tooling, nothing user-visible) gets a changelog line only
when the infrastructure is itself the story.

## How it chains

It reads the output of `ship-pr` (`04`) - the merged commits - and feeds the public story.
Closing the circle: triage finds work, implement does it, ship merges it, write-up tells
the world, and the telling brings the contributors who file the next issues.
