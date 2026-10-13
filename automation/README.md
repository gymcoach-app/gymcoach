# Maintainer automation

Tooling for the autonomous maintainer, kept apart from the GymCoach application:
the app never imports this directory and the Docker image does not ship it
(`.dockerignore`). See the
[implementation roadmap](../docs/loops/11-autonomous-development-roadmap.md).

## Run records (milestone 1)

- `records/schema.ts` - versioned Zod schemas (schema version 1) for task, run,
  review and outcome records. A measurement is either known, with a unit, or
  unknown, with a reason. A value the workflow does not record is unknown, never 0.
- `baseline/build.ts` - pure builder: raw GitHub and git data in, records out.
- `baseline/report.ts` - the Markdown report; every rate states its denominator.
- `baseline/collect.ts` - read-only collector (`gh api` GET calls and `git log`).
  Run `git fetch` first: revert detection reads the local `origin/main`.

  ```bash
  git fetch origin
  npx tsx automation/baseline/collect.ts --since 2026-08-14 --window-days 14 \
    --out docs/loops/baseline/2026-10-13
  ```

- `baseline/render.ts` - re-renders `report.md` from a collected `runs.jsonl` and
  `meta.json` without calling GitHub (`npx tsx automation/baseline/render.ts <dir>`).
  Both scripts format the report with the repo's Prettier config, so a re-render
  reproduces the committed `report.md` byte for byte.

Outputs are public metadata only: PR numbers, logins, SHAs, timestamps, check
names and conclusions. PR and issue bodies, comment text and commit messages are
read in memory to find references and trailers, and are never written.

Author classes: `loop` is the maintainer account with a Claude Co-Authored-By
trailer on the PR commits; `maintainer-unattributed` is the maintainer account
without one; `external-vetted` uses the grant date in
`docs/loops/10-external-contributions.md`; everyone else is `external`. The
trailer shows Claude wrote the commits, not that the run was unattended.

Reviews: a reviewer is a `bot` (login ending in `[bot]`), a `maintainer`, or
`other-human`; bot reviews are reported apart from the human review line. A
posted verdict counts only when a maintainer comment names a verdict and the head
it reviewed (`head \`<sha>\``); the short SHA is resolved against the PR's commits.

Follow-ups: a bug-labelled issue or an issue or PR titled `fix`/`bug` that cites
the PR within the window; a fix PR closed unmerged does not count. Revert and
follow-up rates are reported over runs whose window has closed, with observing
runs apart. CI: skipped and neutral checks are not decisive, and a running check
leaves the head's CI outcome unknown.

## Agent usage (milestone 1)

- `usage/build.ts` - pure parser and linker: Claude Code session transcript lines
  in, per-run usage records out (`usage/schema.ts`, usage schema version 1).
- `usage/prices.ts` - dated API list prices per model, used only for an
  API-equivalent cost estimate; a model or speed without a verified price keeps the
  cost unknown.
- `usage/enrich.ts` - writes `usage.jsonl` (one record per run, keyed by `runId`)
  and `usage-meta.json` next to a baseline's `runs.jsonl`, and re-renders
  `report.md`. `render.ts` reads them when present.

  ```bash
  npx tsx automation/usage/enrich.ts --dir docs/loops/baseline/2026-10-13 \
    --transcripts ~/.claude/projects/<project-slug>
  ```

Attribution, never guessed: a subagent session counts toward a run when it worked
on exactly one branch other than `main`, a detached HEAD or a fresh
`worktree-agent-*` branch, and that branch is the PR's head branch; or when its task
prompt names exactly one PR (`pull/<n>/head`, else `PR #<n>`) in the baseline.
Conflicting, ambiguous or missing evidence leaves it unattributed. Orchestrating
(main) sessions span many runs: their usage is totalled apart and only their link
count is recorded per run. Each API response is counted once, at its final usage,
even when logged per streamed block or in two transcripts. Skill version is known
only for a skill invoked through the Skill tool (`<skill>@<commit>` of its
`SKILL.md` at session start).

Privacy: transcripts are read in memory. The outputs hold token counts, estimated
cost, durations, counts, model ids and skill versions, never prompts, tool output,
paths, branch names or session ids.

Limits: only transcripts the operator retained on this machine are visible (from
2026-09-11 here); work outside Claude Code is invisible; summed session time is not
human-attended time; the estimate is not an amount billed.
