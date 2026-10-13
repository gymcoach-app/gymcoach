# 06 — Orchestration (the self-maintaining repo)

The first five files built the **stages**: triage finds work, implement does it, ship
merges it, write-up tells the story. Each is a small loop calling a tested skill. This
file ties them into one **maintainer loop** that runs the whole pipeline end to end - the
thing that lets the repo maintain itself while you sleep.

```
        +-----------------------------------------------------------+
        |                    maintainer loop                        |
        |                                                           |
        v                                                           |
  triage (03) --> implement-issue (02) --> ship-pr (04) --> write-up (05)
   refill if          one issue              merge every        tell the
   backlog low        -> one PR              green PR           story
        ^                                                           |
        +-----------------------------------------------------------+
                 git + GitHub hold the state between ticks
```

## The decision-maker in the body

A cron job runs a fixed script; a loop runs a model that **looks at current state and
decides what to do next**. The maintainer loop's decision each tick:

1. **Are there ready PRs?** (green or fixable CI) -> ship them first. Shipping finishes
   started work and moves `main` forward; always drain this before starting new work.
2. **Is the backlog low** (no actionable, unclaimed issue)? -> run triage to refill it with
   code-health work.
3. **Still no actionable issue after triage?** -> run `ideate` (08) to manufacture bounded
   **product** ideas, so the loop keeps improving the product, not just tidying it. (Hard
   caps: <= 3 issues, no run while >= 3 idea issues are open, never the heavy
   deep-research workflow.)
4. **Is there an actionable issue?** -> implement the next one (-> a PR, which next tick's
   step 1 will ship). If two queued issues touch the **same file(s)**, serialize: implement
   one, wait for its PR to actually **merge**, then implement the next from the updated `main`.
   Do not overlap same-file tasks, or the second branch cuts from a stale base and hits a merge
   conflict (lesson L7). Unrelated tasks may still overlap at the stage level (see `09`).
5. **Did things merge since the last write-up?** -> run the content loop.
6. **Nothing to do on any of the above?** -> stop. A clean idle is success, not failure.

Order matters: finish before you start (ship before implement), and only manufacture work
(triage, then ideate) when genuinely starved, so the tracker and the PR queue never flood.
Ideation sits below triage on purpose: ideas are made only when the loop would otherwise
idle, and implementation drains them before more are made.

## Running it

Phase 1 - watched, locally:

```
/loop You are the maintainer of this repo. Each tick: (1) ship any ready PR with ship-pr;
(2) if the backlog is low, run triage; (3) if there is still no actionable issue, run
ideate to manufacture bounded product ideas; (4) implement the next actionable issue with
implement-issue; (5) if work merged since the last write-up, run write-up. Respect every
skill's own guardrails (including ideate's hard caps: <= 3 issues, no run while >= 3 idea
issues are open, never the heavy deep-research workflow). STOP when there is nothing to
ship, no actionable issue, ideate has nothing new to add, and nothing to document - or
after 3 merges this run. Auto-merge only on green CI; never on main directly.
```

Phase 2 - unattended, on infrastructure:

- Flip `.claude/settings.json` to `bypassPermissions` for the cron run (it cannot pause to
  ask). Keep the **deny-list** - it still blocks the destructive ops.
- `/schedule` the same prompt nightly. State lives in git (one branch per task) and on
  GitHub (issues + PRs), so a crash mid-run loses nothing; the next tick re-reads reality
  and continues.

## The four rules, at the orchestration level

1. **Feedback** - every stage self-verifies (green-gate locally, **CI before merge**).
   Nothing lands on optimism.
2. **Skills, not prompts** - the maintainer loop is thin glue; all discipline lives in the
   four tested skills. Tighten a skill when you see a failure mode; every loop benefits.
3. **It must halt** - each stage caps its output (3 issues, 1 issue->PR, 3 fix attempts, 1
   docs PR) and the maintainer caps merges per run and stops on a clean idle. Three layers
   of stop.
4. **Durability** - the only state that matters is in git and on GitHub. The session is
   disposable; the pipeline is resumable.

## What "autonomous end to end" actually means here

A human still owns *what the project is for* - the vision, the hard product calls, the
occasional "this PR needs a human". Everything mechanical between "there is work" and "it
is shipped and documented" runs without a click. The job moved up an altitude: from
writing the code to **authoring the loops that write it** - and this file is the loop that
runs the loops.

## Relaunch after a crashed tick (lesson L11)

When a background tick dies mid-run (API error, harness kill), do not immediately relaunch
into the same checkout: the dead agent can re-wake and write concurrently. First stop the
dead task explicitly (TaskStop) or confirm it is gone; then `git status` - committed work
survives in branches/PRs (resume from there), but unexpected working-tree changes are a
stop-and-reground signal. The replacement tick's prompt should state what is already
merged so it never redoes or fights prior work.

## Concurrent ticks: one worktree each (lesson L15)

A git checkout is single-writer state: `HEAD`, the index, and the branch pointer are shared
mutable state. If two ticks run in the **same** working tree at once, they race - one tick's
`git switch main` or commit can strand or mis-attribute the other's uncommitted work, and it
can land directly on `main` even when both ticks are otherwise behaving. This actually
happened on 2026-07-15: a ship tick switched to `main` while a dev tick had uncommitted work
in the same tree, and an intermediate commit briefly hit `main` (hard-guardrail-1 breach;
reverted forward, re-shipped as PR #279).

- **Give each concurrently running dev/ship tick its own `git worktree`** (`git worktree
  add ../wt-<task> <branch>`), so branch checkouts and commits in one tick never touch
  another tick's tree. Worktrees do not share `node_modules` (lesson L4: `npm ci` +
  `npm rebuild bcrypt` in a fresh worktree before the gate; `verify.sh --full` now migrates
  the test database itself).
- **Until worktree isolation is in place, serialize same-checkout ticks** - never overlap
  two ticks in one tree. This is stricter than the same-file serialization of step 4: any
  two ticks sharing a tree must not overlap, related or not.
- **Reviewers write git state too (lesson L38).** A review subagent never runs `git
  checkout`/`git switch` in the main checkout or in another tick's worktree; on 2026-10-09
  two did, and one detached another tick's `HEAD` mid-work. It reads via `gh pr diff`,
  `git show <sha>:<path>` and `git diff`, or takes a read-only snapshot with
  `bash automation/review/snapshot.sh <pr>` (a detached worktree at the PR head under the
  scratch dir; `--remove <dir>` deletes it).
- **Enforced by a hook, not only by these rules.** `.claude/settings.json` runs
  `automation/hooks/guard-git.cjs` before every Bash call. A **subagent** (its hook input
  carries `agent_id`) is refused `git checkout <ref>`, `git switch`, `git reset --hard`/
  `<commit>`, `git clean -f`, rebase-like commands and path-wide restores when their target
  (after `cd`, `pushd` or `git -C`) is a primary checkout, such as the main checkout, or a
  worktree other than its own, and it may not remove another worktree or delete a branch.
  The **main session** keeps the main checkout but is refused in another session's worktree.
  Everyone is refused the stash forms that act on the shared stack without a tag. A tick
  starts its branch with `git fetch origin && git worktree add -b <branch> <path> origin/main`
  (or its Agent isolation worktree). The operator can turn the guard off for one session by
  starting Claude Code with `GYMCOACH_GIT_GUARD=off`.
- **Session-start canary.** The guard recognises a subagent by `agent_id` in its hook input
  (Claude Code 2.1.296 or later); if a version stopped sending it, subagents would pass as
  the main session and the guard would fail open for them. At the start of a loop run the
  orchestrator runs `node automation/hooks/guard-git.cjs --self-test` (decision logic), then
  spawns one non-isolated subagent that runs `git -C <main-checkout> reset --soft HEAD` (a
  no-op if it ever runs) and must report `Blocked by the git guard`. If it is not blocked,
  do not run non-isolated subagents in that session: use Agent worktree isolation only,
  and report it.
- **Concurrency is capped, not only advised.** On 2026-10-13 three or four parallel ticks
  plus Docker took the load average to ~20 and crashed local E2E. `verify.sh` now takes
  one of `GYMCOACH_HEAVY_SLOTS` machine-wide slots (default a quarter of the cores) and
  waits, naming the holders, when all are taken; a session may run at most
  `GYMCOACH_MAX_SUBAGENTS` (default 3) subagents at once, and the next Agent call is
  refused until a completion notification arrives (`automation/hooks/dispatch-limit.cjs`).
  Dispatch at most three ticks, and treat a dispatch refusal as "wait", never as a reason
  to retry in a loop. `GYMCOACH_SESSION_TOKEN_BUDGET` bounds a run's subagent spend.
- **If a commit still lands on `main`, revert forward** (a revert commit restoring `main`'s
  content), never `git push --force` shared history (it is denied anyway), then re-ship the
  work through a proper PR.

**Confirmed pattern (2026-09-04): worktree-per-tick is the way to run dev ticks in
parallel.** Three dev ticks ran at once, each in its own `../gymcoach-wt-<issue>` worktree
branched from the same base, on issues chosen to be file-disjoint. Result: three PRs, zero
merge conflicts, three green first-pass CI runs, no `main` breach. The two pieces that make
it work are both already above - a worktree per tick for the git-state race (L15), and the
shared-infra `flock` for the test Postgres and dev port (L16), which serialized the three
`--full` gates without anyone coordinating them. So the recipe is: pick file-disjoint issues
(step 4's same-file serialization still applies - it decides *what* may run in parallel,
worktrees only decide *where*), `git worktree add ../gymcoach-wt-<n>` per tick, `npm ci` +
`npm rebuild bcrypt` in each (L4; the test database is migrated by `verify.sh --full`), let the ticks stop at the PR
(L3), and ship them one at a time. Clean up with `git worktree remove` after the merge -
and merge through the pinned merge gate (`automation/publish/merge.ts`, see the `ship-pr`
skill, step 5), which deletes a same-repo head branch on the remote after the merge. The
old `gh pr merge --delete-branch` exited 1 after a successful merge while the branch was
still checked out in a worktree; the gate's remote deletion does not have that problem.
