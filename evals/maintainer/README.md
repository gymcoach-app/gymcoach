# Maintainer evaluation: replayable tasks

Roadmap milestone 3 ([`docs/loops/11-autonomous-development-roadmap.md`](../../docs/loops/11-autonomous-development-roadmap.md)):
measure the maintainer on repeatable tasks instead of judging it by merged PRs.
This directory holds the task format, a small smoke suite and the replay
runner. It is not part of the app: the app never imports it, the Docker image
excludes it, and nothing here holds credentials.

## Run a task

```bash
npx tsx evals/maintainer/run.ts --task <id> --agent dry|reference|broken|claude \
  [--budget-usd N] [--out <dir outside the repo>] [--keep]
```

| Agent       | What it does                                                       | Expected |
| ----------- | ------------------------------------------------------------------ | -------- |
| `dry`       | Changes nothing (red-before check)                                 | `fail`   |
| `reference` | Applies the real fix: the base..fix diff of the task's paths       | `pass`   |
| `broken`    | Applies `tasks/<id>/broken.patch`, an intentionally incomplete fix | `fail`   |
| `claude`    | Runs `claude -p` with the task statement in the snapshot           | measured |

`--agent claude` is a paid run. The runner refuses it unless `--budget-usd` is
given **and** the operator set `EVAL_BUDGET_APPROVED=1`, so a loop cannot start
one by passing a flag. The budget is passed to Claude Code as
`--max-budget-usd`; the wall-time cap of the task is enforced with a timeout.

Results go to `${TMPDIR:-/tmp}/gymcoach-evals/<stamp>-<task>-<agent>/result.json`
(or `--out`, which must be outside the repository). Exit codes: 0 pass, 1 fail,
3 infra-error, 2 usage.

## What a task is

`tasks/<id>/task.json` follows `evalTaskSchema` in [`schema.ts`](schema.ts)
(version 1):

- **snapshot**: `baseSha` (the parent of the fix) and `fixSha`. The agent only
  ever sees the base.
- **statement**: the requirement re-derived from the issue, with no issue or PR
  number and no hint of the solution.
- **reference.paths**: the source files whose base..fix diff is the known-good fix.
- **grader.hidden**: test files taken from the fix commit and copied into the
  workspace only after the agent finished. They fail on the base and pass on the fix.
- **grader.preserved**: existing tests that must stay green.
- **budget**: maximum turns and wall time.
- **leakage**: what could reveal the answer and how it is handled.
- **split**: `dev` (iterate freely), `validation`, or `reserved` (never used to
  select a candidate). Split by issue or failure family, not at random.

`tasks/<id>/broken.patch` is a plausible but incomplete fix the grader must reject.

### The smoke suite (dev split)

| Task                             | Family          | From       | Tier        |
| -------------------------------- | --------------- | ---------- | ----------- |
| `dev-cardio-duration-separators` | parsing         | PR 361     | unit        |
| `dev-mcp-prisma-error-classes`   | error-handling  | #433, #434 | unit        |
| `dev-duplicate-exercise-post`    | api-correctness | #379, #425 | integration |

Validated on 2026-10-13 (9 runs): `dry` fails, `reference` passes and `broken`
fails on all three, with the preserved tests green each time.

## How a replay is isolated

1. **Snapshot.** `git archive <baseSha>` extracted into a fresh temp dir, then a
   new one-commit git history with no remote. No later commit, lesson, review
   digest or PR text exists in it, and `git push` has nowhere to go. `evals/` is
   removed from the snapshot so a future base cannot reveal graders.
2. **Dependencies.** The installed `node_modules` is reused only when the base's
   lockfile pins the same packages (the root version bump of a release is
   ignored); otherwise the run is an infra-error rather than a result about the
   wrong dependencies.
3. **Grading.** Hidden tests are fetched from the fix commit after the agent
   finished. Unit tests run inside `unshare -rn` (no network at all). Integration
   tests get a throwaway database `gymcoach_eval_<random>` on the shared test
   Postgres (started by `scripts/test-db.sh` under the test-infra lock),
   migrated to the base schema and dropped afterwards.
4. **Claude agent.** Tokens are removed from the environment, `gh` points at an
   empty config dir (logged out), sessions are not persisted, only project
   settings load, and web tools are disallowed. Claude Code's per-project
   memory is keyed by directory, so the temp snapshot has none.

**Not enforced on this machine** (disclosed, not hidden):

- The `claude` agent keeps network access: the model API needs it. Web tools are
  disallowed, but a shell command could reach the network.
- The user-level `~/.claude` settings that Claude Code always reads (for example
  a global `CLAUDE.md`) are not removed.
- The filesystem is not sandboxed. The snapshot is the agent's working
  directory, but its Read, Glob and Grep tools accept absolute paths, so it could
  read the live checkout (with the later history and these graders). Bash is
  limited to an allowlist (`npx vitest`, `npm run test`, `git diff`, `git status`),
  so it cannot push or call `gh`. A container or a separate user is the next step.
- The integration tier runs on the host network, because the test Postgres
  listens on localhost.
- A turn cap is recorded in the task but not passed to the CLI; the budget and the
  wall-time timeout bound the run.

## Outcomes and the denominator

`pass` needs every hidden and preserved test file to report at least one passing
test and no failure. A run that produced no report, a setup error, a patch that
does not apply or a database that does not start is `infra-error`: recorded in
`result.json` with its reason, counted in every report, never silently dropped.
A hidden file that does not even load (for example a missing export) is a failed
suite, so it is a `fail`, not an infra error.

## Not done yet

This is the first slice. Still to come (roadmap M3): 20-30 tasks across more
families (UI behaviour, migrations, CI diagnosis, interruption recovery,
untrusted instructions, review/merge races), validation and reserved splits,
repeated trials with variability and cost per successful task, and a first
budgeted `claude` baseline once the operator sets an evaluation budget.
