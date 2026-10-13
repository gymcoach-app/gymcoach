---
name: write-up
description: Turn shipped work into the public story. After PRs merge, update the CHANGELOG and the docs/loops playbook so the "this repo maintains itself" narrative stays current and reproducible. Use when asked to "write up the démarche", "update the changelog", or as the unit the content loop calls.
---

# write-up

The tail of the pipeline and the actual growth engine. The product is the gym app; the
**story** - "this repo maintains itself with documented loops" - is what earns stars.
This skill keeps that story current and truthful after work ships. Read `CLAUDE.md`.

It writes **docs and demo media only** (CHANGELOG, `docs/loops/*`, README touch-ups,
`docs/screenshots/*` plus the demo-seed/recording scripts that produce them). It never
touches product code. Output is one focused docs PR via `implement-issue` conventions, or a
commit on an existing docs branch.

## Inputs

- A set of recently merged PRs / closed issues (default: since the last CHANGELOG entry).
  Find them: `gh pr list --state merged --limit 20 --json number,title,mergedAt` and
  `git log --oneline origin/main` since the last documented change.

## What to keep current

1. **CHANGELOG.md** - move shipped, user-facing changes into the right `Unreleased`
   group (Added / Changed / Fixed). One terse line per change, no marketing. Skip
   internal-only churn unless it is itself the story (loop infra often is).
2. **docs/loops/** - when a *new loop or skill* shipped, add or update its numbered
   playbook entry so anyone can reproduce it. The playbook is the content; keep it
   honest (document what actually runs, including failure modes you hit).
3. **README** - the features list and roadmap checkboxes are updated EVERY batch that
   ships a user-facing capability (operator directive 2026-06-10); other README edits only
   when the loop narrative changed enough to matter. Keep edits minimal and truthful.
4. **Demo media** (same directive, refined: periodic, not per-batch). Static screenshots
   (`docs/screenshots/*.png`): re-shoot when a captured page (home / progress / generator /
   catalog) visibly changed. Recorded clips (`docs/screenshots/*.gif`): re-record from time
   to time with a staleness cap - never more than ~3 shipped feature batches of lag, and
   never a flagship feature missing from a clip that claims to show that flow. All tooling
   is in the repo: a throwaway Postgres (e.g. `docker run -d --name gymcoach-demo-db ...
   -p 5435:5432 --tmpfs /var/lib/postgresql/data postgres:16-alpine`), a local gitignored
   `.env` with `LLM_PROVIDER=demo`, `prisma migrate deploy` + `npm run db:seed` +
   `npm run seed:demo` (extend `scripts/seed-demo-history.ts` when a new feature needs demo
   data to be visible), `npm run build` + `npx next start -p 3032`, then
   `node scripts/screenshots.mjs` and `node scripts/record.mjs <scenario>` + an ffmpeg
   palette GIF conversion at 320 px / 12 fps. Tear the server and container down after. The recorder (scripts/record.mjs) self-verifies - it exits non-zero and discards the clip if the page shows an error overlay / 404 / 5xx / uncaught error (lesson L12); a `record.mjs` abort means the app is broken, not the script. Kill any stale next-server / free the port before recording (lesson L11).
5. **docs/loops/lessons.md** - harvest any lesson the run surfaced (a failure mode, a
   surprise, a fix that should not have been needed). A lesson is only "learned" when it
   **graduates**: if it is general, edit the relevant skill or `CLAUDE.md`/charter so the
   behavior changes next time, then record the entry pointing at that change; otherwise mark
   it accepted risk. Do not just append prose - an un-acted lesson is noise. Prune/dedupe so
   the file stays high-signal. See `docs/loops/09-memory-and-learning.md`.
6. **docs/loops/review-digest.md** - append a dated **comprehension digest**: the antidote to
   comprehension debt (the loop ships faster than the human reads). For the batch, list what
   merged, then call out the **few diffs the human should read FIRST**, ranked by risk x
   impact - auth/security, schema/migrations, core behavior (progression/stats), LLM prompts,
   and CI/pipeline rank highest; additive UI, tests, and docs rank lowest (the skeptic + the
   gate cover those). Give each priority item a `gh pr diff <n>` pointer and a one-line "why
   read this". Keep it short - a reading list, not a re-summary; "reviewed by a sub-agent" is
   not "understood by the human".

## Procedure

1. **Start clean in your own worktree:** `git fetch origin && git worktree add -b
   docs/<slug> <scratch-path> origin/main` (or branch from `origin/main` inside your Agent
   isolation worktree); never switch the main checkout (lessons L15/L38).
2. **Gather** the merged work since the last write-up. Map each item to a CHANGELOG
   group and decide if it warrants a playbook/README change. **Verify each claim against
   the code or the merged diff** - never document a feature that is not actually there
   (this skill exists partly because a changelog drifts otherwise).
3. **Write** the smallest accurate edits - and do not skip items 4-6 of "What to keep
   current": harvest/graduate any lesson into `lessons.md` (+ the skill/charter it changes),
   and append the prioritized **comprehension digest** to `review-digest.md`. English only,
   regular hyphens (no em/en-dash), Keep a Changelog format.
4. **Green-gate** (`bash scripts/verify.sh`) - docs-only, but the working agreement is
   the working agreement.
5. **Commit, push, PR** with `Closes #<n>` if a content issue exists, else a plain docs
   PR. The shipping loop (`ship-pr`) will merge it once CI is green.
6. **Report** what was documented and what was intentionally left out.

## Guardrails

- Truth over hype: every changelog/README claim is checked against merged code.
- Docs only - no product code, no merges (let `ship-pr` merge it).
- Do not document unmerged work as shipped (it belongs in the PR, not `main`'s story).

## Demo freshness (after the docs PR merges)

When the batch changed anything user-visible, trigger the demo redeploy
(`gh workflow run deploy-demo.yml`, or let the Monday schedule take it) and probe
https://demo-gymcoach.mesureprivee.com/login afterwards - the public demo is part of the
story and must not lag the README it advertises.

## One metric per batch

Each batch write-up records, in the autonomy-log entry, the cheap acceptance metric:
PRs merged vs PRs abandoned/reverted this batch (the accepted-change rate), and the
approximate token spend of the implementing tick when known. Cost per accepted change -
not tokens spent - is the number that says whether the loop is winning.

## What success looks like

The CHANGELOG and the `docs/loops/` playbook always reflect what actually shipped, so the
public démarche is current, reproducible, and trustworthy - the thing that compounds into
stars while the loops do the typing.
