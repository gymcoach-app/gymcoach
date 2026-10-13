# Maintainer evaluation: replayable tasks

Roadmap milestone 3 ([`docs/loops/11-autonomous-development-roadmap.md`](../../docs/loops/11-autonomous-development-roadmap.md)):
measure the maintainer on repeatable tasks instead of judging it by merged PRs.
This directory holds the task format, a small smoke suite and the replay
runner. It is not part of the app: the app never imports it, the Docker image
excludes it, and nothing here holds credentials.

## Run a task

```bash
npx tsx evals/maintainer/run.ts --task <id> --agent dry|reference|broken|tamper|claude \
  [--budget-usd N] [--out <dir outside the repo>] [--keep]
```

| Agent       | What it does                                                           | Expected |
| ----------- | ---------------------------------------------------------------------- | -------- |
| `dry`       | Changes nothing (red-before check)                                     | `fail`   |
| `reference` | Applies the real fix: the base..fix diff of the task's paths           | `pass`   |
| `broken`    | Applies `tasks/<id>/broken.patch`, an intentionally incomplete fix     | `fail`   |
| `tamper`    | `broken`, plus a `vi.mock` cheat in setup and weakened preserved tests | `fail`   |
| `claude`    | Runs `claude -p` with the task statement, in a container               | measured |

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

Validated on 2026-10-13 (12 runs, Docker up so the integration task ran):
`dry` fails, `reference` passes, `broken` fails and `tamper` fails on all three,
with the preserved tests green each time. `tamper` is the broken fix plus two
cheats (a `vi.mock` of the fixed module in the test setup files and every
preserved test replaced by one that always passes). With the grade-input restore
disabled, `tamper` passed all three: the restore is what rejects it.

## How a replay is isolated

1. **Snapshot.** `git archive <baseSha>` extracted into a fresh temp dir, then a
   new one-commit git history with no remote. No later commit, lesson, review
   digest or PR text exists in it, and `git push` has nowhere to go. `evals/` is
   removed from the snapshot so a future base cannot reveal graders, and so is
   `.claude/` (project settings that would widen permissions, hooks, and skills
   that tell an agent to open PRs and merge).
2. **Dependencies.** The installed `node_modules` is reused only when the base's
   lockfile pins the same packages (the root version bump of a release is
   ignored); otherwise the run is an infra-error rather than a result about the
   wrong dependencies.
3. **Grading.** First every grade input is put back to the base commit: every
   test file, everything under `tests/` (helpers, the integration setup), the
   vitest configs and `vitest.setup.ts`, `package.json`, the lockfile and
   `tsconfig.json`; grade inputs the agent added are removed. The agent may only
   change application code, so weakening a preserved test or adding a `vi.mock` of
   the module under test to a setup file cannot turn a fail into a pass (the
   result lists what was put back in `gradeInputsRestored`). Then the hidden
   tests are fetched from the fix commit. A run passes only when vitest also
   exits 0. Unit tests run inside `unshare -rn` (no network at all). Integration
   tests get a throwaway database `gymcoach_eval_<random>` on the shared test
   Postgres (started by `scripts/test-db.sh` under the test-infra lock),
   migrated to the base schema and dropped afterwards.
4. **Claude agent, in a container.** `claude -p` runs in a `node:22-bookworm`
   container that sees only: the snapshot at `/work` (read-write), the installed
   `node_modules` and the `claude` binary (read-only), and a fresh `HOME` holding a
   copy of the model credential (`~/.claude/.credentials.json`) and the eval
   settings. No other host path is mounted: not the repository, `~/.config/gh`,
   `~/.git-credentials`, `~/.ssh` or `~/.gitconfig`. No host environment variable
   is passed (no `GH_TOKEN`, `GITHUB_TOKEN`, `DATABASE_URL`). The root filesystem
   is read-only, capabilities are dropped, `no-new-privileges` is set, the image
   has no `gh`. Only the eval settings load (`--setting-sources user` with that
   fresh `HOME`, plus `--settings`): an allow list for the edit tools,
   `npx vitest`, `npm run test`, `git diff` and `git status`, and a deny list for
   `git push`, `git remote`, `gh`, `curl`, `wget` and web tools; no MCP server
   (`--strict-mcp-config`). On a timeout the container is removed, which stops
   every process the agent started.

   Proof without a model call: `npx tsx evals/maintainer/probe-isolation.ts`
   builds the same container and runs a shell probe instead of `claude`. On
   2026-10-13 all 14 checks held: reading the gh token, `~/.git-credentials`,
   `~/.ssh`, `~/.gitconfig` or the live checkout by absolute path, finding a gh
   config, a git remote, `git push`, `gh api`, a token in the environment,
   writing to `node_modules`, the binary or the root filesystem, and `sudo` all
   failed. The same commands succeed on the host, so the probe is not vacuous.
   `HOME` held only `.claude/.credentials.json` and `.claude/settings.json`.

**Not enforced on this machine** (disclosed, not hidden):

- The container keeps network egress: the model API needs it, and no egress
  filter (proxy or firewall) is in place. With no credential for anything but
  the model API and a deny list for `curl`, `wget`, `gh` and web tools, a
  publish needs a credential the container does not have, but a determined
  agent could still reach other hosts (for example with `node -e`).
- The model credential itself is inside the container (a copy, deleted after
  the run); the agent can read it. It is a Claude login, not a GitHub token.
- The snapshot's `CLAUDE.md` is kept: it is part of the repository the agent
  maintains. Its publishing instructions have no effect without a remote, `gh` or
  a token.
- The authentication of `claude` inside the container has not been exercised:
  that needs a model call, and no evaluation budget is approved yet. The first
  approved run verifies it; a failure there is an infra-error, never a result.
- The integration tier runs on the host network, because the test Postgres
  listens on localhost. Grading runs on the host, after the agent's container is
  gone.
- A turn cap is recorded in the task but not passed to the CLI (it has no such
  flag); the budget and the wall-time timeout bound the run.

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
