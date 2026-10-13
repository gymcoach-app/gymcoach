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
| `tamper`    | `broken`, plus three grader cheats (see below)                         | `fail`   |
| `claude`    | **Disabled** (issue #453); would run `claude -p` in a container         | n/a      |

**`--agent claude` is disabled.** The runner refuses it unconditionally, whatever
`--budget-usd` and `EVAL_BUDGET_APPROVED` say, until issue #453 is closed: its
container can reach the unauthenticated Docker Desktop engine API and other host
services, its code would be graded on the host, and the operator's model
credential is readable inside it. It stays disabled until
`npx tsx evals/maintainer/probe-isolation.ts` exits 0. The budget gate stays in
place in front of that refusal: a paid run will also need `--budget-usd` **and**
`EVAL_BUDGET_APPROVED=1` set by the operator, so a loop cannot start one by
passing a flag.

The four self-check agents (`dry`, `reference`, `broken`, `tamper`) only apply
this repository's own historical patches (the real fix, the broken variant and
the cheats below), never model-written code. Grading them on the host, as the
operator, is acceptable for that reason only; it is not acceptable for an
agent's code, which is why #453 also moves grading into a container.

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
with the preserved tests green each time. `tamper` is the broken fix plus three
cheats: a `vi.mock` of the fixed module in the test setup files, every preserved
test replaced by one that always passes, and, in the module under test itself,
`chai.Assertion.prototype.assert` turned into a no-op (application code, so the
grade-input restore does not undo it). The restore rejects the first two; the
static tamper check rejects the third. Re-run on 2026-10-13 after adding it (12
runs, Docker up): the chai cheat made every hidden test pass on two tasks
(cardio 34/0, duplicate POST 4/0), and only the static check (one violation)
turned them into `fail`. With that check disabled, `tamper` passed both.

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
   result lists what was put back in `gradeInputsRestored`). Before that, a
   static tamper check reads the agent's changes (tracked and untracked files
   against the snapshot commit, plus the git-ignored generated Prisma client):
   application code that imports `vitest`, `chai` or `@vitest/*`, or any edit
   under `prisma/generated/`, is a violation listed in `tamperViolations`, and
   any violation makes the outcome `fail`. Then the hidden
   tests are fetched from the fix commit. A run passes only when vitest also
   exits 0. Grading runs on the host as the operator. Unit tests run inside
   `unshare -rn` (no network, but full access to the operator's files: the
   result field `networkBlockedForGrader` means the network only). Integration
   tests get a throwaway database `gymcoach_eval_<random>` on the shared test
   Postgres (started by `scripts/test-db.sh` under the test-infra lock),
   migrated to the base schema and dropped afterwards.
4. **Claude agent, in a container (disabled, see #453).** `claude -p` would run in a `node:22-bookworm`
   container that sees only: the snapshot at `/work` (read-write), the installed
   `node_modules` and the `claude` binary (read-only), and a fresh `HOME` holding a
   copy of the model credential (`~/.claude/.credentials.json`) and the eval
   settings. No other host path is mounted: not the repository, `~/.config/gh`,
   `~/.git-credentials`, `~/.ssh` or `~/.gitconfig`. No host environment variable
   is passed (no `GH_TOKEN`, `GITHUB_TOKEN`, `DATABASE_URL`). The root filesystem
   is read-only, capabilities are dropped, `no-new-privileges` is set, the image
   has no `gh`. Only the eval settings load (`--setting-sources user` with that
   fresh `HOME`, plus `--settings`), with no MCP server (`--strict-mcp-config`).
   Those settings carry an allow list (edit tools, `npx vitest`, `npm run test`,
   `git diff`, `git status`) and a deny list (`git push`, `git remote`, `gh`,
   `curl`, `wget`, web tools), but they are **not a security control**: write
   access plus `npx vitest` already runs arbitrary code. The container is the only
   boundary. On a timeout the container is removed, which stops every process the
   agent started.

   Proof without a model call: `npx tsx evals/maintainer/probe-isolation.ts`
   builds the same container and runs a shell probe instead of `claude`; it exits
   0 only when every check holds. On 2026-10-13 it ran 17 checks and **exited 1**.
   14 held: reading the gh token, `~/.git-credentials`, `~/.ssh`, `~/.gitconfig`
   or the live checkout by absolute path, finding a gh config, a git remote,
   `git push`, `gh api`, a token in the environment, writing to `node_modules`,
   the binary or the root filesystem, and `sudo` all failed (the same commands
   succeed on the host, so the probe is not vacuous). **3 failed**: the container
   reached the Docker Desktop engine API at `host.docker.internal:2375` (no TLS,
   no authentication: it can start a container that mounts any host path, so a
   credential the container does not hold is still within reach), the shared
   test Postgres at `host.docker.internal:5434`, and the public internet. `HOME`
   held only `.claude/.credentials.json` and `.claude/settings.json`.

**Not enforced on this machine** (disclosed, not hidden; all tracked in #453):

- The container keeps open network egress: no egress filter (proxy or
  firewall) limits it to the model API. Through it the agent reaches the
  unauthenticated Docker Desktop engine API on the host (port 2375), which lets
  it start a container mounting any host path, read the gh token and publish.
  It also reaches the shared test Postgres and other host services.
- The operator's model credential (a copy of the Claude Code OAuth login) is
  readable inside the container, and the open egress lets the agent send it
  anywhere. A token refresh inside the container may also log the host out. The
  copy is deleted after the run, but not if the runner is killed (SIGKILL).
  The operator must accept this risk explicitly before any paid run.
- Grading runs the agent's application code on the host as the operator (unit
  tier with no network but full file access, integration tier with the host
  network, `prisma migrate deploy` with the agent-editable `prisma.config.ts`).
- The snapshot's `CLAUDE.md` is kept: it is part of the repository the agent
  maintains. Its publishing instructions have no effect without a remote, `gh` or
  a token.
- The authentication of `claude` inside the container has not been exercised:
  that needs a model call, and no evaluation budget is approved yet. The first
  approved run verifies it; a failure there is an infra-error, never a result.
- The static tamper check is a pattern match on imports, not a proof: dynamic
  tricks (for example building the module name at run time) are not caught.
  Grading in a container (#453) is the structural fix.
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
