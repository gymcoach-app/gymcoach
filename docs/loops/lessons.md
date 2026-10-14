# Lessons (the staging area for self-learning)

This is **procedural memory in waiting**. A lesson here is not "learned" until it has
**graduated** - edited a skill or `CLAUDE.md`/the charter so the behavior changes
automatically next time - or been explicitly marked **accepted risk**. See
`docs/loops/09-memory-and-learning.md` for why (a deep log no one re-reads changes nothing).

`write-up` (`05`) harvests new lessons here each run and graduates the general ones. Keep
entries **specific and actionable**, prune duplicates, and never let this file become an
un-pruned dump.

Format per entry: trigger/evidence, the lesson (actionable), and **Status** = `graduated
(-> where)` or `accepted risk (why)`.

## Lessons

### L1 - Trust-gate on the login allowlist, never `authorAssociation == OWNER`
- **Trigger:** building the public-repo guardrail (#54/#56). The skeptic suggested gating on
  `OWNER`; the loop's own account `JulienAu` is a `COLLABORATOR`, not `OWNER`, and
  `authorAssociation` is not even a `gh ... --json` field.
- **Lesson:** gate auto-implement/auto-merge on `author.login in {JulienAu, Julien-Au}`
  (GitHub authorship is authenticated, so this is the real control). Requiring `OWNER` would
  lock the loop out of its own work and destroy autonomy.
- **Status:** graduated -> `07-autonomy.md` "Untrusted external input" + `implement-issue`,
  `ship-pr`, `triage` skills (#56).

### L2 - A post-merge red on `main` is usually transient infra, not a regression
- **Trigger:** two `main` CI runs red-failed at the integration job's "Initialize
  containers" step (`Docker pull failed`); the tests never ran. PRs had been green.
- **Lesson:** before assuming a regression, read which *step* failed - a Docker/registry
  pull failure is infra; re-run the job. Also: PRs cut from the same `main` and merged close
  together can be green alone but need a re-check merged ("green separately, red together").
- **Status:** graduated -> CI hardened: Postgres pulled from the rate-limit-free ECR Public
  mirror; the action runtimes bumped `checkout@v5`/`setup-node@v5` (which run on Node 24) and
  CI `node-version` 20 -> 22 to match the nvm toolchain (#67). Re-check-merged behavior: ship
  one PR at a time and let the gate run on the merged result (accepted process, noted in `09`).
  Reconfirmed during the first ideate batch: a "job was not acquired by Runner" failure (GitHub
  Actions infra, not a step in our workflow) was read as infra and re-run, not treated as a
  regression - exactly the L2 discipline.
  Follow-up 2026-10-13 (#381): the "rate-limit-free" mirror was not. Over the last 100 CI runs
  (115 attempts since 2026-09-22), 30 attempts (26%) died at the Postgres pull, and all 37
  failed pull jobs whose logs were read said `toomanyrequests: Data limit exceeded` from
  `public.ecr.aws`. The jobs now start Postgres through `.github/actions/start-postgres`:
  the image is pinned by digest, restored from the Actions cache, and on a cache miss pulled
  by digest from `mirror.gcr.io`, the ECR public mirror or Docker Hub in turn (same index
  digest on all three), then saved to the cache. A choice of mirror is not a fix; removing
  the per-run dependency on any one external registry is. A cache entry whose image ID does
  not match the pin fails closed with no fallback pull; clear it with
  `gh api -X DELETE "repos/gymcoach-app/gymcoach/actions/caches?key=<key>"` (gh 2.4.0 has no
  `gh cache`) and re-run.

### L3 - The orchestrator owns CI-watch and merge; subagents stop at the PR
- **Trigger:** background maintainer-tick agents repeatedly terminated early - they ended
  while "watching CI" before merging, leaving green PRs unmerged.
- **Lesson:** an implementation subagent should implement -> verify -> push -> open the PR
  and **STOP**. The driving thread (orchestrator) owns the deterministic CI-watch + squash
  -merge. This both fixes the early-termination and matches "one linear writer" (Cognition).
- **Status:** graduated -> `implement-issue` and `ship-pr` operational notes.

### L4 - A fresh checkout/worktree needs `npm ci` (+ native rebuild) and a migrated test DB
- **Trigger:** the green-gate failed in a fresh git worktree - `npx prisma` pulled the
  latest Prisma (wrong major), and `bcrypt`'s native binding was missing.
- **Lesson:** in any fresh checkout/worktree, run `npm ci` first (worktrees do not share
  `node_modules`), `npm rebuild bcrypt` if the native binding is missing, and
  `prisma migrate deploy` against the test Postgres on :5434 before integration/E2E.
- **Status:** graduated -> `implement-issue` and `ship-pr` operational notes. Extended by
  **L23**: the migrated-DB half is not about the checkout at all, it is about the container.
  The migrated-DB half is **resolved** by `scripts/test-db.sh` (roadmap Milestone 2):
  `verify.sh --full` now migrates the test database itself; `npm ci` and the native rebuild
  still apply.

### L5 - This environment's `gh` is an older build; some flags do not exist
- **Trigger:** `gh label`, `gh issue close --reason/--comment`, `gh run rerun --failed/--job`,
  and `--json authorAssociation` all failed as unknown.
- **Lesson:** prefer `gh api` (e.g. labels, `author_association`) and two-step flows
  (`gh issue comment` then `gh issue close`); do not assume the newest `gh` surface.
- **Reinforced 2026-09-04, and it is worse than "the flag is missing":** `gh pr checks <n>
  --watch` on this machine's `gh` 2.4.0 prints `unknown flag: --watch` and **exits 0**. A
  missing flag that fails loudly is an inconvenience; one that fails silently with a success
  status is a gate that can be read as green without a single check having been resolved -
  exactly the shape of failure the charter cares about. The general rule: for any `gh` call
  whose answer is a verdict, decide on the *parsed output* (`--json`), never on the exit
  status.
- **Status:** graduated -> `ship-pr` step 2 now says to poll
  `gh pr view <n> --json statusCheckRollup` (or `gh pr checks <n>` in a loop) instead of
  `--watch`, and to decide on the check conclusions rather than on an exit code. The broader
  "this environment's `gh` is old, prefer `gh api` and two-step flows" part stays an accepted
  operational risk, recorded here so future runs do not rediscover it.

### L6 - Prisma's generated `Set` model type shadows the global `Set`
- **Trigger:** the consistency-card lib (#71) needed a `Set<string>` of distinct trained days,
  but `import type { Set } from '@prisma/client'` (the workout-set model) is in scope across
  `lib/`, so a bare `Set<string>` / `new Set()` resolves to the Prisma model and the typecheck
  fails (`lib/stats.ts`).
- **Lesson:** in any `lib` module that touches both the Prisma `Set` model and JS collections,
  reference the runtime `Set` via `globalThis.Set` (type `globalThis.Set<...>`,
  value `new globalThis.Set(...)`) rather than the bare name. See `lib/stats.ts`
  `trainingConsistency`.
- **Status:** accepted risk - a narrow naming collision specific to this schema's `Set` model,
  not a recurring loop behavior; recorded so future `lib` work does not rediscover it under a
  red typecheck.

### L7 - Serialize tasks that touch the same file: wait for the prior PR to MERGE before spawning the next
- **Trigger:** the second ideate batch queued #81 and #82, which both edited `lib/stats.ts` and
  the progress dashboard. The two implement agents overlapped, so the second branch was cut from
  a `main` that did not yet contain the first's additions and hit a merge conflict (resolved by
  merging `main` into the branch and keeping both additions).
- **Lesson:** when two queued issues touch the same file(s), serialize strictly - do not spawn
  the next implement agent until the prior PR has actually **merged**, so the next branch cuts
  from a base that already contains the earlier change. Unrelated tasks may still overlap at the
  stage level; this rule is specifically for **same-file** tasks. This sharpens the existing
  "one writer per task" note (`implement-issue`/`ship-pr`) and `09`'s stage-vs-writer concurrency
  ("green separately, red together"): those cover the principle; this makes the trigger concrete -
  shared file means serialize on merge, not just on branch.
- **Status:** graduated -> orchestration practice (`06-orchestration.md` decision order + the
  "one linear writer per task" rule in `09-memory-and-learning.md` / `implement-issue` /
  `ship-pr`): same-file queued issues are dispatched one at a time, gated on the prior merge.

### L8 - A nested run without the spawning tool cannot satisfy the independent-review protocol by itself
- **Trigger:** the background maintainer tick implementing #90 (PR #95) had no subagent-spawning
  tool in its environment, so it executed the "multi-lens review" itself - the author grading
  its own homework, which the charter forbids. The orchestrator ran an independent post-merge
  review as a backstop; it confirmed ownership/migration/math were sound but found a real
  data-lifecycle defect the author had missed (deleting the achieving set left a goal
  permanently "Achieved"), fixed the same day in #97.
- **Lesson:** a self-executed review pass is not the subagent challenge. When a nested run
  cannot spawn an independent reviewer, it must flag that in its report, and the orchestrator
  must run an independent post-merge review as the very next action (or hold the PR pre-merge
  when feasible). The author reliably misses its own blind spots even when honestly running
  multiple "lenses" - independence, not effort, is what catches the defect.
- **Status:** graduated -> charter (`07-autonomy.md`, "Subagent challenge protocol"): the
  no-reviewer-available case is now an explicit rule with the post-merge backstop.
- **Reinforced (2026-08-20).** Two of the five PRs in that batch shipped a REAL defect that
  the author's own gate (green `verify.sh`, green CI 5/5, the author's own re-read) had
  missed, and the independent pre-merge review found both. #297: adding a second settings
  writer turned the pre-existing spread-own-state write pattern into a live clobber - editing
  the plate inventory and then toggling vibration reverted the plates, because each card wrote
  its own mount-time copy back (fixed by re-reading `localStorage` before every write in BOTH
  writers, with a symmetric regression test). #298: the flock fd 9 leaked into the `npm`
  children, so a zombie next-server surviving an interrupted run could hold the shared-infra
  lock forever while the blocking `flock` had no timeout (fixed with `9>&-` on both npm calls,
  `flock --wait 3600`, and an actionable failure message). Both defects are the same shape -
  a *new* piece of code makes an *existing* pattern unsafe, which is exactly the blind spot an
  author has after writing the new piece. The rate (2 real defects in 5 PRs) is the argument
  for keeping the review pre-merge and independent even when everything is green; treat a
  CLEAN verdict as information, not as the expected outcome.
- **Reinforced again (2026-08-27).** Third consecutive batch where the independent pre-merge
  review found real defects - this time in the external-contributions POLICY PR (#315), not in
  feature code, which is the harder case because the artifact is prose and its bugs read as
  ordinary sentences. Verdict NOT READY with 3 blocking findings: the new hard-block path list
  was written so it applied to the maintainer tier too (it would have silently ended the loop's
  own auto-merge autonomy), the `ship-pr` skill still executed unvetted code at its fix-a-red-gate
  step although step 1 forbade exactly that, and `i18n/**` was missing from the hard-block list
  while `messages/**` was listed. All fixed on the branch, re-review READY. Same shape as the
  code cases - the author wrote the new rule and could not see where it contradicted the rest of
  the system - so documents that change how the loop behaves get reviewed with the same
  independence as code, not skimmed because they compile trivially.

### L9 - Gates rot, permissions creep: schedule the meta-checks
- **Trigger:** an external loop-engineering writeup (2026-06-11) listed two failure modes
  our system had no answer for: a test that approved a fix can silently stop catching the
  regression it was written for ("gates rot" - we had never reverted a fix to confirm its
  test fails), and permission scope creep in an unattended loop's settings.
- **Lesson:** the loop's own controls need periodic verification, not just existence. A
  gate is only as good as the last time someone proved it can fail; a permission list is
  only as tight as its last re-read.
- **Status:** graduated -> `triage` skill (sources 6 and 7: monthly gate spot-check with
  revert-the-fix verification, ~30-day permissions re-audit), and the write-up skill now
  records the accepted-change rate per batch. External validation noted: the rest of the
  writeup's recommendations (maker/checker split, state files, objective gates, hard
  stops, regrounding spec) were already implemented here.

### L10 - Close the gate's cheat path and stop retrying what just failed identically
- **Trigger:** an external "self-improving loop" writeup (2026-06-11) review against our
  system. Two rules we relied on implicitly but had never written: nothing forbade a tick
  from getting a red gate green by weakening a test (deleting/skipping it, loosening an
  assertion, swallowing the error), and nothing said what to do when the same error
  repeats - the 3-attempt cap allowed three identical guesses in one tired context.
- **Lesson:** (a) "fix the code, never the test" must be an explicit rule wherever the
  gate is described - a weakened test is a defect, and reviewers should treat it as one;
  (b) two identical failures in a row mean the fixer is guessing - the next attempt
  belongs to a fresh-context fixer subagent (re-diagnose from scratch), not retry #3.
  Same independence principle as L8, applied to fixing instead of reviewing.
- **Considered and declined from the same writeup:** PostToolUse/Stop hooks running
  tsc/tests on every edit or stop. Our loop verifies at task boundaries (verify.sh is
  mandatory before any PR); per-edit hooks would add ~15s latency to every edit in every
  session for marginal gain in a batch-oriented loop. Accepted decision, not a gap.
- **Status:** graduated -> CLAUDE.md (green-gate section), `ship-pr` step 3,
  `implement-issue` step 5.

### L11 - A tick that died mid-run can come back as a zombie writer: stop it before relaunching
- **Trigger:** a maintainer tick died on a transient API 529, the orchestrator relaunched a
  fresh tick into the same checkout, and the dead tick later re-woke and wrote concurrently
  in the working tree while the new tick was implementing #145 (the new tick caught it,
  verified every line against the spec, and the independent review confirmed nothing
  foreign landed - but only luck made the two writers converge on the same spec).
- **Lesson:** "one writer per checkout" applies to dead agents too. Before relaunching a
  replacement tick into the same working tree, explicitly stop the dead task (TaskStop) or
  confirm it can no longer wake; on relaunch, the new tick should `git status` first and
  treat unexpected tree changes as a stop-and-reground signal, not something to absorb.
- **Status:** graduated -> `06-orchestration.md` (relaunch-after-crash rule) and the
  orchestrator's memory; review prompts after any two-writer episode must include an
  injected-code scan (done for #149, verdict clean).

### L12 - Recorded demo media was never verified for content: a clip of an error page passed every gate
- **Trigger:** the operator reported "Application error" showing in the README demo videos.
  The committed GIFs are produced by scripts/record.mjs, which used a `tryClick` that
  swallowed every failure and never asserted the app was healthy - so a recording made
  against a crashed/stale server (which happened twice this session when a zombie next-server
  held the port) produces a webm of the Next.js error overlay, and nothing downstream
  (verify.sh, CI, docker-smoke, the human skim) ever looks at the *content* of a clip. Green
  everywhere, broken on the page.
- **Lesson:** generated media is an output that needs its own gate. The cheapest correct
  place is at capture: the recorder must fail loudly (non-zero exit, footage discarded) if
  the page ever shows an error overlay / a 404 / a 5xx / an uncaught pageerror. Because the
  only way a committed GIF is produced is through the recorder, a self-verifying recorder
  closes the loop without OCR on the committed file.
- **Update (2026-06-12):** the SAME gap existed in scripts/screenshots.mjs - two of the four committed README screenshots (progress.png, catalog.png) were the "Application error" page, captured during the same stale-server episode. Both scripts now self-verify identically.
- **Status:** graduated -> scripts/record.mjs AND scripts/screenshots.mjs now watch pageerror + >=500 responses and
  asserts on-screen error text after every click and at each scenario's key step, exiting 1
  and discarding the webm on any hit (proven with a negative probe: pointing it at a 404
  route aborts). The write-up skill's media step references this. Also a reminder of L11:
  the stale-server episodes that caused the bad captures were zombie next-server processes -
  kill servers/ports before recording.

### L13 - A major framework upgrade is tractable as ONE careful PR when you lean on the codemod, swap the unmaintained plugin, and use the image smoke test as the net
- **Trigger:** issue #169 (Next 14 -> 15, the stop-for-human major bump) was operator-authorized. Done as one branch: bump next/react/types + eslint-config-next; replace the unmaintained next-pwa with the maintained @ducanh2912/next-pwa (the real blocker - the old plugin has no Next 15 support); run the official `next-async-request-api` codemod for the cookies/params/searchParams async change (23 app files + lib/auth), then fix the integration tests that call handlers with sync `{params}` to pass `Promise.resolve({...})`.
- **Lesson:** the migration surface for a major Next bump is mostly mechanical IF (a) you scope the dependency-compat blockers first (here: only the PWA plugin was incompatible; Radix/recharts/next-themes/testing-library were all React-19 ready), (b) you use the official codemod rather than hand-editing the async-API surface, and (c) you treat the production Docker image as the load-bearing gate - the docker-smoke CI job (built for the bcrypt episode, lesson around #127) is exactly what proves the standalone runtime survived; verify it locally before merge AND let CI re-run it. The npm-audit goal: the 14 RUNTIME Next CVEs cleared; the residual advisories are build-time only (workbox toolchain behind the PWA plugin), an accepted-risk end state, not a failure.
- **Status:** accepted approach for future major framework bumps; rollback baseline tagged before the work (autonomy-baseline-2026-06-13-next15). The remaining workbox build-time advisories would need a Serwist migration (bigger, separate).

### L14 - Branch BEFORE editing: after `git switch main`, the first edit must be on a task branch
- **Trigger:** twice now (#259 GPX-track on 2026-06-23, and the TCX-track work on 2026-06-30) I committed and pushed a feature DIRECTLY to `main`. Both times the cause was identical: a prior step ended with `git switch main` (to sync / merge a previous PR), then the next task's edits started without a `git switch -c` - so the work landed on `main`, bypassing the PR + pre-merge review gate (a CLAUDE.md rule).
- **Lesson:** the dangerous moment is the START of a new unit of work that follows a `main` checkout. Make branching the FIRST action of any task that will edit files - `git switch -c <type>/<slug>` before the first Edit/Write, not after. Recovery when it happens anyway: CI runs on push to `main` (so the change is still gated), but run the independent review POST-HOC and fix any finding forward via a real PR; never force-push to "undo" shared `main`. Both slips ended green + reviewed SHIP, but a gate-skip is exactly what the charter forbids - the fix is the habit, not the recovery.
- **Status:** standing rule. If a turn begins on `main` and will write code, branch first.

### L15 - Concurrent ticks must not share one working tree: isolate with git worktrees, or serialize
- **Trigger:** 2026-07-15 batch. Two ticks ran against the SAME checkout at once: the #278
  ship tick did `git switch main` (to sync the merged PR) while the #270 dev tick still had
  uncommitted work in that same tree. The switch + a stray commit put an intermediate commit
  (`a49e21f`) directly on `main` - a breach of hard guardrail 1 (never commit to `main`).
  This is a DIFFERENT cause than L14: L14 is one writer forgetting to branch; L15 is two
  writers sharing one tree, where even a correctly-branched tick is unsafe because another
  tick can move `HEAD`/`main` and capture its uncommitted work. Remediated without
  force-push: revert `fe25d66` restored `main` to `b2221f5` exactly (CI green), work
  cherry-picked onto a feature branch and shipped as PR #279.
- **Lesson:** a git checkout is single-writer state. Two ticks in one working tree race on
  `HEAD`, the index, and the branch pointer - one tick's `git switch`/commit can strand or
  mis-attribute the other's work onto `main`. The orchestrator must give each concurrently
  running dev/ship tick its OWN git worktree (`git worktree add`), so branch checkouts and
  commits never collide; until worktree isolation is in place, same-checkout ticks must be
  strictly SERIALIZED (never overlap two ticks in one tree). Extends L7/L11 ("one writer per
  checkout") from same-file and zombie-writer cases to the general concurrent-tick case, and
  makes the control structural (separate trees) rather than behavioral (remember to branch).
- **Status:** graduated -> `06-orchestration.md` ("Concurrent ticks: one worktree each"):
  concurrent dev/ship ticks get isolated `git worktree`s; without isolation, serialize
  same-checkout ticks. Recovery when a commit still lands on `main`: revert forward (never
  force-push shared history), then re-ship via a proper PR.
  **Confirmed in production 2026-09-04:** three dev ticks ran concurrently in
  `../gymcoach-wt-<n>` worktrees off the same base, on file-disjoint issues - three PRs, zero
  conflicts, three green first-pass CI runs, no `main` breach, with the L16 `flock`
  serializing the three `--full` gates unprompted. Now written into `06-orchestration.md` as
  the confirmed parallel-dev pattern rather than a contingency.
  **Enforced 2026-10-13:** the main checkout is now off limits for HEAD-moving git commands
  from any subagent (PreToolUse hook `automation/hooks/guard-git.cjs`, see L38; Claude Code
  marks a subagent's hook input with `agent_id`): a subagent that needs a branch works in its
  own worktree; the operator's and orchestrator's main session keeps the main checkout.
  This covers L15 only partly: the hook restricts subagents, so two MAIN sessions sharing the
  primary checkout (two operator or orchestrator sessions at once) are not prevented from
  racing on `HEAD`; that case still relies on the one-orchestrator-per-checkout rule.

### L16 - Isolated worktrees are not enough: the shared test Postgres (:5434) and dev port (:3031) also need a lock
- **Trigger:** 2026-07-22 batch. Two loop sessions ran `bash scripts/verify.sh --full` at the
  same time from SEPARATE git worktrees (so L15 was satisfied - no shared checkout). They still
  collided on shared INFRA: both point at the one test Postgres on host port 5434 and both bind
  the dev/E2E server on 3031. One run's `TRUNCATE ... CASCADE` reset the DB while the other was
  mid-suite, and the port was contended, yielding a spurious E2E failure that was green on an
  isolated re-run.
- **Lesson:** worktree isolation fixes the git-state race (L15) but not the runtime-infra race.
  The integration/E2E tiers assume single-tenant ownership of :5434 and :3031; two concurrent
  `--full` runs violate that assumption and corrupt each other non-deterministically. The fix is
  structural (a lock around those tiers, or a per-run unique DB name + free port), not "remember
  not to overlap."
- **Status:** graduated -> filed **#283** to serialize-or-isolate the shared test infra. INTERIM
  rule until #283 lands: the orchestrator must not run two `verify.sh --full` invocations against
  :5434/:3031 concurrently - serialize them (a green isolated re-run of the failed tier is the
  tell that a red was this contention, not a regression; acknowledge the actual failing step
  before re-planning, per L2).
- **Resolved by #298 on 2026-08-20.** `scripts/verify.sh --full` now takes a machine-wide
  `flock` on `${TMPDIR:-/tmp}/gymcoach-test-infra.lock` around the integration and E2E tiers,
  so a second concurrent run prints a wait notice and blocks instead of truncating the first
  run's database. Verified against a real 300s lock holder rather than asserted. The control
  is structural, so the interim "do not overlap two `--full` runs" rule is retired - but the
  lock is per machine and per lock file: two runs with different `TMPDIR`s, or an integration
  tier invoked outside `verify.sh`, still bypass it.

### L17 - The E2E tier is not repeatable back to back: the app's own register rate limit reds unrelated specs
- **Trigger:** 2026-07-27 batch (#282). One tick ran `verify.sh --full` and then, to confirm a
  flake, re-ran the E2E tier twice more within a couple of minutes. Different specs failed each
  time (`measurements` on `ECONNRESET`, then `auth` + `deload` stuck on `/signup`) while the
  change under test touched only progress-photo storage. CI, running the suite once, was green
  on the first try.
- **Lesson:** the E2E specs sign up through the real API, which enforces `register:<ip>` at 5 per
  60s. A suite run consumes most of that budget, so a second run inside the window starves the
  specs that sign up through the UI (the ones that cannot set a distinct `x-forwarded-for`). This
  is self-inflicted: re-running "to check the flake" is exactly what causes the next red, and the
  moving target of which spec fails is the tell. Distinct from L16 - that is two CONCURRENT runs
  contending on shared infra; this is one session running SEQUENTIALLY too fast.
- **Status:** graduated -> `CLAUDE.md` (green-gate section) now states the tier is not safely
  repeatable inside a minute and how to read an auth/signup red after a recent run. Filed **#292**
  to make the UI-signup specs use a per-spec client IP so the suite stops sharing one bucket.
- **Resolved by #294 on 2026-08-20.** The root cause (one shared bucket) is gone: the five specs
  that sign up through the UI now each set a dedicated `x-forwarded-for` via
  `test.use({ extraHTTPHeaders })`, and three client IPs accidentally reused across API-signup
  specs were deduped. The rate limit itself was left untouched (fix the code, not the test).
  Acceptance was measured, not assumed: a second `npm run test:e2e` started immediately after the
  first, inside the 60s window, was green 17/17 both runs. `CLAUDE.md` now says back-to-back runs
  are expected green. Residual caveat kept: the guarantee is bounded, not unconditional - on CI
  (`retries: 2`) one flaky spec can burn up to three of its bucket's five registers, so a flaky
  run combined with a re-run inside the same minute can still trip the limit. The interim "wait
  out the minute" rule is retired; **#283** (concurrent runs sharing
  :5434/:3031, lesson L16) is a different race and is still open.

### L18 - Running the green-gate on an external PR is remote code execution on the operator's host
- **Trigger:** the 2026-08-27 operator directive to encourage outside contributions. The first
  draft of the process had the loop check an external PR out into a git worktree and run
  `bash scripts/verify.sh` on it before reviewing the diff. The independent challenge of that
  design (run BEFORE adoption, not on the diff) named what the draft had treated as routine: the
  gate executes the contributor's test files, `vitest.config.ts` and any `postinstall` hook as
  the operator's own user, with `.env` and an authenticated `gh` token in reach. A worktree is a
  filesystem convenience, not a security boundary, and "read the diff first" does not fix it -
  reading the diff is what the execution was supposed to help with.
- **Lesson:** for code the loop did not author, "just run the tests to see if it works" IS the
  attack. The executor must be the sandbox that already exists: CI runs on a disposable runner
  with no operator secrets, so CI is the only thing that executes an unvetted PR, and the local
  gate happens after a human merges, never before. Author trust does not relax this (trusting a
  contributor is not a property of their next diff); where local execution of external code is
  genuinely needed it belongs in an ephemeral isolated container. Generalize it: any loop step
  that says "run it to check" on input the loop did not write is an execution decision and must
  be written down as one.
- **Status:** graduated -> `docs/loops/10-external-contributions.md` (trust tiers + the execution
  gate + the hard-block path list), the charter's trust section, `CLAUDE.md`, and the `triage` /
  `implement-issue` / `ship-pr` skills (#315). Residual risk recorded for the operator in the same
  batch: `main` has NO branch protection (the loop account is not an admin and cannot add it), so
  every control here is behavioral until a human enables it - the cheapest, highest-leverage fix
  available and the one thing the loop cannot do for itself.

### L19 - "CI is green" is a claim about a commit: resolve check runs by head SHA, never by PR
- **Trigger:** 2026-08-28, merging SHAREN's #312. The PR's checks summary read 6/6 green, and the
  check runs behind it belonged to the PREVIOUS head - the contributor had pushed a fixup and the
  new head had not been checked yet. Across #312 and #313 the contributor pushed five times during
  review, and each push silently aged both the CI verdict and the loop's own pinned review.
- **Lesson:** a green summary answers "has this PR ever been green", not "is the code I am about to
  merge green". Before merging anything the loop did not author, resolve the check runs against the
  current head SHA through the API and compare that SHA to the one the review was pinned to
  (`--match-head-commit`); if they differ, re-review, do not merge. The failure is silent and looks
  exactly like success, which is why it needs a mechanical step rather than attention. Corollary:
  the review verdict and the CI verdict must be pinned to the SAME SHA, or one of them is about
  code that no longer exists.
- **Status:** standing rule, not yet graduated. It belongs in `10-external-contributions.md` (the
  review-passes section already pins reviews to a SHA but says nothing about check runs) and in the
  `ship-pr` skill's merge preconditions; the next edit to either should encode it.

### L20 - Before calling an index reader-less, check whether the DATABASE is the reader
- **Trigger:** the 2026-08-27 review of #313 called `Set_gymEquipmentId_completedAt_idx`
  reader-less because no application query used it, and the contributor removed it on that basis.
  Wrong: the FK is `ON DELETE SET NULL` with `relationMode` unset, so Postgres has to locate the
  referencing `Set` rows on every equipment deletion (single delete, gym delete cascade, and backup
  restore, which cascades across every equipment row the user owns), and Postgres does not index
  the referencing side of a foreign key. The advisory CodeRabbit lens had the mechanism right where
  the loop's own review had it wrong.
- **Lesson:** "no reader in application code" is the wrong question when a database-level
  referential action is the reader. Before recommending that an index be dropped, read the schema
  for `ON DELETE`/`ON UPDATE` actions and cascade paths on that column, and remember that only the
  referenced side of an FK is indexed automatically. More generally: a review finding that tells a
  contributor to DELETE something needs the same evidence bar as one that asks them to add
  something, because the loop's mistake gets implemented by someone else's hands.
- **Status:** graduated -> **#325** filed to restore the index, with the provenance (which lens was
  right, and why) written into the issue rather than the index quietly re-added. The general rule
  is a standing review-practice rule; it also stands as the first concrete evidence that the
  advisory third-party lens earns the slot the policy gives it.

### L21 - A tick must never end its turn waiting on a background process
- **Trigger:** 2026-09-04, the three-worktree parallel batch. Two of the three dev ticks
  backgrounded a prerequisite (`npm ci`, `next start`) and then ended the turn saying they
  were waiting to be notified when it finished. Nothing notifies them: a subagent tick is not
  re-woken by a background job completing, so both sat done-but-unfinished until the
  orchestrator noticed and resumed them. Both then completed normally - the work was never
  wrong, only stalled, which is exactly why it is easy to miss.
- **Lesson:** "start it in the background and wait" is a pattern borrowed from an interactive
  session, where a human is still at the keyboard to react. Inside a loop tick there is no
  such observer, so a backgrounded prerequisite converts an autonomous tick into one that
  needs a babysitter - it spends orchestrator attention, the scarce resource the loop exists
  to save. Anything a tick NEEDS before it can continue runs synchronously (raise the tool
  timeout rather than backgrounding it); anything that must run detached, such as a dev
  server, is polled until it answers. Not to be confused with L3: L3 says stop at the PR and
  do not block on CI, which is a deliberate hand-off to another tick. This is the opposite
  failure - stopping mid-task with nothing on the other side of the wait.
- **Status:** graduated -> `implement-issue` step 5 (green-gate) now states it outright: run
  bootstrap and the gate synchronously, never end the turn waiting on a background process,
  poll a server until it answers.

### L22 - This host's `gh` 2.4.0 has no `--match-head-commit` and no `jq`: pin merges through the REST endpoint
- **Trigger:** 2026-09-07, merging shaurya703's #341-#343 on the operator's in-session
  authorization. The policy and the `ship-pr` skill say `gh pr merge --match-head-commit <sha>`,
  and this machine's gh (2.4.0, Ubuntu's packaged build) does not know the flag. The box also has
  no `jq` binary, so a `| jq` pipeline written from memory fails before it reaches GitHub. Same
  family as L5 (an old CLI on the operator's host), met one step later in the pipeline: at the
  merge, where a workaround chosen in a hurry is the one most likely to drop the SHA pin.
- **Lesson:** the pin is a property of the API, not of the flag.
  `gh api -X PUT repos/<owner>/<repo>/pulls/<n>/merge -f sha=<head> -f merge_method=<squash|merge>`
  is the same fail-closed merge on any gh version: GitHub refuses it (409) if the head no longer
  matches `sha`. For filtering, `gh api ... --jq '<filter>'` evaluates the filter inside gh with no
  `jq` on PATH. Prefer the endpoint over upgrading the CLI mid-tick: the upgrade is a host change
  nobody reviewed, the endpoint is a documented contract.
- **Status:** graduated -> the REST fallback now sits in one sentence beside the
  `--match-head-commit` instruction in `10-external-contributions.md` (pass 3) and in `ship-pr`
  (steps 1 and 5).

### L23 - `verify.sh --full` never migrates the test database, so a just-started container reds the gate
- **Trigger:** 2026-09-11, the first `--full` run on #346. Docker Desktop is off by default on
  the operator's box and was started mid-run, so the test Postgres on :5434 came up empty; the
  integration tier died with `relation "Message" does not exist`. Nothing was wrong with the
  code, and the error names a table nobody had touched, which is exactly what makes it read as
  a regression for a minute.
- **Lesson:** `scripts/verify.sh` runs the integration and E2E tiers against whatever schema the
  container already holds - it does not run `prisma migrate deploy` itself - and the test
  container keeps its data in tmpfs, so it is empty again after every stop. L4 said this for a
  fresh worktree; the checkout was never the variable. Any fresh **or restarted** container needs
  the migrations applied once before `--full`:
  `DATABASE_URL=postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test npx prisma migrate deploy`.
- **Status:** graduated -> a paragraph in `CLAUDE.md`'s green-gate section and in
  `implement-issue` step 5, both with the command, and L4 now points here. **Resolved** by
  `scripts/test-db.sh` (roadmap Milestone 2): `verify.sh --full` starts the container when
  Docker is available, waits for it, and applies the migrations under its lock, with a guard
  that refuses any database other than the local test one. The manual step is retired from
  `CLAUDE.md` and `implement-issue`.

### L24 - Switching branches leaves stale `.next/types` stubs, and the gate typechecks before it builds
- **Trigger:** 2026-09-11, the first gate run on the #347 branch failed typecheck on route type
  stubs for `app/(print)/...` - a route group that exists only on the #346 branch, whose build
  had generated them into the shared `.next/types`. The gate's own order makes this bite: it
  typechecks, and only then builds, so the step that would have regenerated the stubs never runs.
- **Lesson:** `.next` is build state shared across branches, not source. When typecheck fails on
  `.next/types` for a route that does not exist on the current branch, the failure is stale build
  output: run `npm run build` on the current branch to regenerate the stubs, then re-run the gate
  (`rm -rf` is denied by settings, and is not needed). Read the failing path before reading the
  message - a type error about a file you never wrote is a state problem, not a code problem.
- **Status:** graduated -> a one-line rule in `implement-issue` step 5.

### L25 - "READY with findings" is not "merge as is"
- **Trigger:** 2026-09-11. Three independent Opus reviews across #346 and #347 all returned
  READY, and all three carried non-blocking findings. Taken at face value the verdict says merge;
  taken seriously it says the cheap ones are worth a fixup first. On #346 that meant an empty
  `?workout=` becoming a 404, `maxSets` derived from the cell-kind list rather than a second
  literal `3`, and `SyncBootstrap` mounted in the print layout so the "active on all protected
  routes" invariant stayed true. On #347 it meant rewriting a pool comment that promised a
  guarantee the code does not give, and adding a red-first integration test on the one comeback
  case the reviewer had proven reachable - verified failing against the old read before the fix.
- **Lesson:** the verdict grades the diff as shippable, not as finished. Fix the findings whose
  cost is a few minutes, red-first where a test is involved, re-run the gate, and pin the merge
  to the new SHA. Everything left unfixed becomes an explicit decision: written down as accepted
  (cell height at ~6mm is tight for handwriting; the `@media print` block is app-wide) or filed
  as its own issue (**#348**, from the loads lens). An unfixed finding that is neither is the
  actual failure mode - it just evaporates when the session ends.
- **Status:** graduated -> a bullet in `07-autonomy.md`'s subagent challenge protocol.

### L26 - Size a review-lens batch so the lens can read every changed line, and make it say when it did not
- **Trigger:** 2026-09-13, the seven-PR SHAREN wave. The four policy lenses were run twice
  rather than once: one batch over the four small PRs (#350, #352, #353, #354), one over the
  three large ones (#351, #355, #356). Batched that way, every lens was able to state that it
  had read the changed lines in full, which is what pass 2 requires before a CLEAN verdict; the
  one lens that resolved a file by targeted grep instead of a full read said so explicitly. Run
  as a single seven-PR sweep, the same four lenses would have had roughly 2,300 changed lines
  each and no honest way to make that claim.
- **Lesson:** the unit of a lens run is not "the PRs in this wave", it is "a diff this lens can
  actually read". Split by size, and require the verdict to name any file it did not read in
  full. A lens that cannot say it read the diff has not produced a CLEAN verdict, it has
  produced an absence of findings, and the two are not the same.
- **Status:** graduated -> a sentence in `10-external-contributions.md` pass 2.

### L27 - Give a lens the specific questions the diff raises, not a generic checklist
- **Trigger:** same wave. The four lenses on #353 each received the concrete questions the diff
  poses - which header decides the cookie flag, is the new route public, does the repo already
  have a documented rule for this, which sibling route enforces the guard this one skips - and
  all four landed independently on the same two majors (a `Secure` flag derived from
  `x-forwarded-proto` against the env-driven rule in `lib/auth.ts:71-84`, and an unvalidated
  body on a public POST). Convergence from independent lenses is the signal that a finding is
  real; a generic "look for security issues" prompt does not produce it, it produces four
  different lists of plausible nits.
- **Lesson:** when dispatching pass 2, pull the questions out of the diff first and hand each
  lens the ones in its remit, in addition to its standing remit. The orchestrator has read the
  file list and the repo; the lens has only the diff. Spending a minute turning "review this"
  into "this route sets a cookie from a header - what does the repo already say about that?"
  is what makes independent verdicts comparable.
- **Status:** graduated -> a sentence in `10-external-contributions.md` pass 2.

### L28 - The isolated-container gate is a script in the repo now, not a recipe retyped per wave
- **Trigger:** 2026-09-14. Five vetted fork PRs (#351, #352, #353, #355, #356) all needed a
  local gate run for their maintainer fixups, and the execution gate forbids running
  contributor code on the host. The container command was assembled by hand the first time and
  then copy-pasted, which is exactly how a control quietly stops being applied - the fifth
  paste is the one that drops a flag.
- **Lesson:** a security control that lives in an agent's short-term memory is not a control.
  `git archive` the COMMITTED ref, unpack it outside the checkout, and run
  `scripts/verify.sh` in `node:22-bookworm` with `--network none`, `--user $(id -u):$(id -g)`,
  `HOME=/tmp/home`, no `.env` and no credential mounts, host `node_modules` read-only.
  Integration and E2E stay CI-only (no database, no browser in the container). Three gotchas
  cost real time and are now comments in the script: `npm_config_offline=true` is mandatory or
  `npx prisma generate` probes the registry and fails `EAI_AGAIN` under `--network none`;
  vitest must be capped at 6 workers or a 5 s component test times out at ~5.2 s; and the gate
  covers the committed tree only, so an uncommitted fixup is gated as if it did not exist.
- **Status:** graduated -> `scripts/container-gate.sh` and `scripts/container-run.sh`, plus the
  paragraph under "The execution gate" in `10-external-contributions.md`.

### L29 - A maintainer fixup is un-reviewed code, and pinning a merge to an unread SHA proves nothing
- **Trigger:** same wave. Every one of the five PRs merged on a tree that no review lens had
  seen: the contributor's head plus a maintainer fixup. The verdict that authorized the merge
  was written against the pre-fixup SHA. Running an independent re-review on each fixup delta
  (eight times across the wave, READY/CLEAN every time, two lenses on the #356 contributor
  delta) caught two things the fixup author had missed: #353's same-origin check read
  `X-Forwarded-Host` whole, where a chained proxy appends and only the first entry is the host
  the browser addressed; and #351's zone fix covered the calendar but not the session detail
  page it links to.
- **Lesson:** pass 3 pins the merge to a SHA precisely so that what was reviewed is what lands.
  A fixup moves the head, so it resets that guarantee: re-review the delta (only the delta -
  it is small, which is what makes this cheap), then re-pin to the new SHA. "I wrote it, so I
  reviewed it" is the same failure the challenge protocol exists to prevent, and it does not
  become safe because the diff is small.
- **Status:** graduated -> rule 2 of "Maintainer fixups on a vetted fork PR" in
  `10-external-contributions.md`.

### L30 - Read the head before fixing: a responsive contributor makes the fixup tick redundant
- **Trigger:** same wave, #356. The structured verdict listed five findings including two
  majors. Within hours - and before the loop's fixup tick started - @SHAREN had pushed eleven
  commits closing every one of them: the PATCH guards mirroring the POST path, a serializable
  transaction with parameterized `FOR UPDATE` locks and a bounded retry, the canonical kg
  picker, `gymEquipmentId` back in the submit payload, the rollback re-read. Had the tick
  opened by re-implementing from the verdict it would have duplicated better work and created
  a conflict on a fork branch.
- **Lesson:** the first action of any fixup tick on an external PR is `gh pr view --json
  commits` / re-read the head SHA and diff it against the SHA the verdict was written on. If
  the contributor moved, the tick's job changes from "implement the findings" to "review the
  delta and fill what is genuinely still missing" (here: four integration tests for the new
  branches and picker labels aligned with the row format). Doing the review labor publicly is
  what makes this outcome possible; not checking for it is what wastes it.
- **Status:** graduated -> rule 1 of "Maintainer fixups on a vetted fork PR" in
  `10-external-contributions.md`.

### L31 - A stacked fork branch must re-merge `main` once its sibling lands, or GitHub calls it conflicting
- **Trigger:** 2026-09-30, the third SHAREN wave. To save a CI cycle, #368 was stacked on
  #362's branch and #369 on #368's. #362 then landed through `main`'s own merge commit, which
  left the stacked branches with a criss-cross history (two merge bases). Local `git merge`
  (ort) resolved it cleanly, but GitHub reported both PRs "dirty": it never started CI on
  #369, and it answered the pinned merge call on #368 with HTTP 405 "Pull Request has merge
  conflicts" although #368's CI was green. The fix was `git merge origin/main` into the
  stacked branch (clean, no hand edits), a re-gate and a push - one extra CI cycle on two
  PRs. The other stack of the wave (#364 then #363) had no such problem: #363's pushed head
  contained #364's exact head and both merged in order, so the tree CI tested was the tree
  that landed.
- **Lesson:** stacking on a reviewed-but-unmerged sibling is worth it, but a branch that
  received the sibling through its **branch** (rather than through `main`) must merge
  `origin/main` after the sibling lands and before it asks GitHub for CI or a merge. A clean
  local merge is not evidence that GitHub agrees.
- **Status:** graduated -> pass 3 of `10-external-contributions.md`.

### L32 - Never merge the second PR of a stack before the first is green on its own pinned SHA
- **Trigger:** same wave. #363 went green before #364, and #369 before #368; in both cases
  the second PR's run covered a tree that contained the first. It was tempting to read that
  as covering the first PR too.
- **Lesson:** pass 3 is "green CI on exactly the SHA that was reviewed", per PR. A superset
  tree going green is not the first PR's result: the first PR merges on its own pinned SHA,
  with its own green run, and only then does the second.
- **Status:** graduated -> pass 3 of `10-external-contributions.md` and step 5 of the
  `ship-pr` skill.

### L33 - The integration tier of external code can run locally without breaking the execution gate
- **Trigger:** same wave. Fixups on the MCP PRs (#362 carries a migration) needed their
  integration tests run, and until now the integration tier of a fork branch was CI-only -
  the only way to learn whether a fixup broke it was a CI round trip. The run used a helper: the test container on an `--internal` docker network whose only other member is a
  throwaway Postgres, a fresh database per run, `prisma migrate deploy`, then Vitest, with no
  route to the host or the internet and no credentials. First attempt with the unit tier's
  `VITEST_MAX_WORKERS=6` failed on foreign keys: forcing a worker cap overrides the
  integration config's `fileParallelism: false`, and the test files truncated each other's
  tables.
- **Lesson:** the execution gate forbids the host, not the database. An internal-only network
  plus a throwaway Postgres gives external code a database without giving it the host or the
  internet. The integration tier needs exactly one worker.
- **Status:** graduated -> `scripts/container-integration.sh` (with a `down` sub-command),
  "The execution gate" in `10-external-contributions.md` (the sentence saying integration
  stays CI-only is replaced), and a guardrail in the `ship-pr` skill.

### L34 - Bound the fixup rounds: a late MINOR goes to a maintainer follow-up, not a third container round
- **Trigger:** same wave. Second-round delta reviews found two MINORs on contributor
  branches after their majors were fixed: #364's wheel could rewrite an off-grid value to the
  nearest row on a nudge, and #365's weight-list parser accepted a token starting with a
  comma. Each would have meant a third fixup round in the container, a third delta review and
  another CI cycle on the fork, for a finding that did not block the merge.
- **Lesson:** after the second round, a MINOR is filed and fixed in a maintainer follow-up PR
  (the loop's own code, gated on the host) and the contributor PR merges on its reviewed SHA.
  Here: issue #382, PR #383.
- **Status:** graduated -> rule 3 of "Maintainer fixups on a vetted fork PR" in
  `10-external-contributions.md`.

### L35 - Rerun a red CI only when the failed step is the image pull, and do not trust "head moved" right after a push
- **Trigger:** same wave. 18 CI run attempts on 8 pushed heads; 10 were reruns, every one for
  the same infrastructure failure (`toomanyrequests: Data limit exceeded` pulling
  `postgres:16-alpine` from the ECR public mirror, at "Initialize containers" of the
  service-container jobs or "Start Postgres" of the smoke job). Zero real CI failures. The run
  used a small waiter that classified the failed step before calling `rerun-failed-jobs`, with
  bounded retries and a pause between them. Separately, the pulls API returned the previous
  head for a few seconds after a push, so a waiter that checked "head moved" immediately
  reported a false HEAD MOVED.
- **Lesson:** L2 said an image-pull failure is infra; the converse matters as much once
  reruns are automated - a rerun is only for the pull step, anything else is read as a real
  failure. Give the API a few seconds after a push before comparing heads. The mirror failure
  itself is tracked as #381.
- **Status:** graduated -> the CI guardrail of the `ship-pr` skill and pass 3 of
  `10-external-contributions.md`; the mirror was accepted risk until #381, which moved the
  pull behind the Actions cache with three registries (see L2's follow-up).

### L36 - Ask the fixup tick for a mutation check, and the verdict for the merge order
- **Trigger:** same wave. The fixup ticks reverted their own fix and confirmed the new tests
  failed, and reported it. That made the delta reviewer's standing question ("would this test
  fail without the fix?") a fact to check instead of a judgment - relevant here because #362's
  ownership guards had been correct but untested. With three overlapping groups of PRs
  (the sets table, the session runner, the MCP server), the merge order was the other thing a
  contributor needed to know before rebasing anything.
- **Lesson:** make the mutation check part of every fixup tick's report, and state the merge
  order at the top of the contributor-facing verdict whenever PRs overlap.
- **Status:** graduated -> rules 2 and 4 of "Maintainer fixups on a vetted fork PR" in
  `10-external-contributions.md`.

### L37 - Check a "duplicates are always a bug" assumption against the built-in data before enforcing it
- **Trigger:** 2026-10-09, #427 (refs #426). After #425 refused a duplicate exercise on POST,
  the follow-up extended the rule to every write path, program generation included (it
  deduped repeated rows), and a unique constraint on `(workoutId, exerciseId)` was on the
  table. CI's integration test that builds every built-in template went red: 5/3/1 Boring
  But Big programs the main lift twice in one workout on purpose (the 5/3/1 sets, then the
  5x10). The generation dedupe was reverted, a test now pins that generation keeps a
  deliberate repeat, the constraint was dropped, and the real cause (the live runner shares
  one set pool per exercise) was filed as #429. Only the hand-edit paths refuse a duplicate.
- **Lesson:** before enforcing a uniqueness or "no repeat" rule, grep the built-in templates,
  the seed and the demo data for a legitimate repeat, and prefer fixing the consumer that
  cannot handle the repeat over forbidding it. The integration test over every template was
  the safety net; keep such whole-catalog tests.
- **Status:** graduated -> step 3 of the `implement-issue` skill.

### L38 - A review subagent never runs `git checkout` in the main checkout or a shared worktree
- **Trigger:** 2026-10-09. Two review subagents ran `git checkout` to read a PR: one in the
  main checkout, one in a worktree that belonged to another tick, which detached that tick's
  `HEAD` mid-work. L15 gave every dev tick its own worktree, but nothing told a reviewer it
  writes git state too.
- **Lesson:** a reviewer reads, it does not switch. It reads a PR through `gh pr diff <n>`,
  `git show <sha>:<path>` and `git diff`, and when it needs a tree on disk it creates its own
  `git worktree add <scratch-path> <sha>` and removes it afterwards. The orchestrator says so
  in every review prompt.
- **Status:** graduated -> step 4 of the `ship-pr` skill and "Concurrent ticks" in
  `06-orchestration.md`. **Enforced since 2026-10-13:** it recurred on 2026-10-13 (a
  reviewer's `git checkout --detach` hijacked a dev tick's worktree), so prose was not
  enough. A PreToolUse hook (`automation/hooks/guard-git.cjs`, wired in
  `.claude/settings.json`) now refuses a subagent's `git checkout <ref>`, `git switch`,
  `git reset --hard`/`<commit>`, `git clean -f`, rebase-like commands and path-wide restores
  whenever the target, after `cd`/`pushd`/`git -C`, is a primary checkout or a worktree other
  than its own (the main session only in another session's worktree), plus the stash forms
  that can take another session's entry, for everyone. Every incident came from a subagent;
  the hook input tells them apart (`agent_id`, checked live). Reviewers read through
  `bash automation/review/snapshot.sh <pr>` (a read-only detached worktree at the PR head).

### L39 - A merge that changes a shared type or schema invalidates a sibling PR's green CI
- **Trigger:** 2026-10-13, #435 -> #436. Both PRs were open at once. #435 (favourite
  exercises) added `Exercise.isFavorite` to the Prisma schema, which changes the generated
  `Exercise` type; #436 (duplicate programs, save a session as a workout) had been tested
  against the `main` before it. Its CI said nothing about the tree that would exist after
  the merge.
- **Lesson:** after merging a PR that touches the Prisma schema, a migration, or a type or
  Zod schema another open PR imports, treat the sibling's green CI as stale: merge
  `origin/main` into the sibling, re-run `verify.sh`, push, and merge only on a fresh green
  CI for the new head. #436 was merged that way. Same family as L31/L32 (stacked fork PRs),
  but for independent loop branches that share a type.
- **Status:** graduated -> "Guardrails" of the `ship-pr` skill.

### L40 - A new `[param]` API route must join the ownership coverage ratchet in the same PR
- **Trigger:** 2026-10-13, #436. Its three new routes (`programs/[id]/duplicate`,
  `workouts/[id]/duplicate`, `sessions/[id]/save-as-workout`) had cross-user integration
  tests in `tests/integration/program-copy.test.ts`, but were not listed in
  `COVERED_ELSEWHERE` of `tests/integration/route-ownership-coverage.test.ts`. The ratchet
  is in the integration tier, which the default `verify.sh` skips, so the gap passed the
  local gate and CI caught it a cycle later.
- **Lesson:** when a PR adds an API route with a `[param]` segment, or one that takes
  another resource's id in its body, register it in the ratchet in the same PR (a case in
  `route-ownership.test.ts`, or a `COVERED_ELSEWHERE` entry pointing at the suite that holds
  its cross-user test). The ratchet worked as designed; the cost was one CI round trip.
- **Status:** graduated -> step 4 ("Test") of the `implement-issue` skill.

### L41 - A nested worktree failed `next lint` because ESLint also loaded the parent checkout's config
- **Trigger:** 2026-10-13. Worktrees live under `.claude/worktrees/<name>`, inside the main
  checkout. Without `"root": true`, ESLint 8 walks up the directories and merges every
  `.eslintrc.json` it finds, so a nested worktree loaded its own config and the main
  checkout's, both extending `next/core-web-vitals`, and `npm run lint` died with
  `Plugin "@next/next" was conflicted between ".eslintrc.json ..." and "../../../.eslintrc.json ..."`.
  Reproduced in this run's worktree before the fix.
- **Lesson:** a repo config that is meant to be the whole config says so. `.eslintrc.json`
  now has `"root": true`, and `bash scripts/verify.sh` passes from a nested worktree. Fixed
  at the root rather than by moving worktrees out of the checkout or skipping lint there.
- **Status:** graduated -> `"root": true` in `.eslintrc.json` (this write-up's PR; a
  maintainer-tier change to a group B path, which the loop may make for its own work).

### L42 - The unit tier timed out on heavy jsdom UI tests whenever other agents loaded the machine
- **Trigger:** 2026-10-13. While three dev ticks, CI watchers and a Docker test database ran in
  parallel (load average 16 to 30 on 12 cores), `bash scripts/verify.sh` failed its unit step
  in at least five runs this session: 3 to 13 tests hit the 5 s per-test timeout, always led by
  `components/session/editable-sets-table.test.tsx`, each file green when run alone. The same
  class had been patched case by case before (#219: `delay: null` plus a 15 s timeout on one
  readiness test). Reproduced on demand with 12 CPU busy loops: the slowest
  `EditableSetsTable` test took 5.2 s and failed.
- **Cause, measured with a CPU profile of that file:** React rendering (the weight picker
  renders about 88 option buttons) and Testing Library's accessible-name computation over
  them dominate; `formatWeight` rebuilt an `Intl.NumberFormat` on every call through
  `Number#toLocaleString(locale, options)`, which made the file 30% slower than needed
  (tests 5.2 to 5.9 s before, 3.6 to 3.9 s after, same load). On top of that, Vitest's default
  pool (cores minus one) piles more workers onto CPUs that other agents already use.
- **Lesson:** a flaky timeout under load is a performance defect with a cause, not a reason to
  raise the timeout. Profile the slow file, fix the hot path in the product code, and size
  the worker pool for a shared machine. `formatWeight` now reuses one formatter per
  configuration (also used by the live equipment-weight preview), and `vitest.config.ts`
  caps workers at half the cores (`VITEST_MAX_WORKERS` still overrides). With both, at load
  about 20 the slowest `EditableSetsTable` test took 2.9 s instead of timing out; at idle the
  tier takes about 14% longer.
- **Status:** graduated -> formatter cache in `lib/units.ts` with a cache-key test, worker cap
  in `vitest.config.ts` (this PR; CI runners keep Vitest's default). Never let a
  `VITEST_MAX_WORKERS` above 1 reach the integration tier: it overrides
  `fileParallelism: false` and files truncate each other's tables (L33).

### L43 - A proof run from the authoring folder cannot see a clash between folders
- **Trigger:** 2026-10-13, #441. `verify.sh --full` began starting the test Postgres itself
  with `docker compose -f docker-compose.test.yml up -d`. The author ran it green twice from
  the same worktree. The review found what those runs could not: compose derives its project
  name from the checkout's directory, while the container name is fixed, so a second worktree
  (every dev tick has its own) would fail on a container already owned by another project.
  The fix pinned one compose project (`gymcoach-test`) shared by every checkout and replaces
  a container left by an older directory-derived project; the validation then included a
  second fresh worktree reusing the container ("No pending migrations", integration green).
- **Lesson:** when a change touches state shared across checkouts (a Docker container or
  compose project, a port, a lock file, a cache directory, the test database), its proof
  includes a run from a second checkout. Repeating the run from the authoring folder adds
  confidence, not coverage.
- **Status:** graduated -> step 4 ("Test") of the `implement-issue` skill and step 4 of the
  `ship-pr` skill (the reviewer asks for the second-checkout run).

### L44 - Review a control through the control, and ask whether one actor can clear another's stop
- **Trigger:** 2026-10-13, #449 (structured review records required by the merge gate). Its
  first and last reviews were posted in the record format the PR introduced (the delta
  review between them was not). The first record
  (needs-changes) found a major: the gate took the latest record for a head and base, so a
  later ready record from one lens cleared an earlier blocking record from another lens,
  and a test asserted that override. The delta review found the next hole of the same
  shape: an edited maintainer record was dropped as invalid, so editing a needs-changes
  record erased its stop. Both were fixed (latest record per reviewer, all must be ready;
  an edited or broken record refuses the merge; maintainers pinned by numeric user id). The
  same shape came up on #448: reading `agent_type` as "subagent" would have locked the
  operator's own `claude --agent` session out.
- **Lesson:** a change to a gate, a review format or a guard is reviewed by using it on
  itself (post the PR's own records with the PR's tool, dry-run its gate against itself),
  and the review asks one adversarial question first: can one record, lens, edit or account
  undo another's refusal, or can the guard refuse the operator it serves? Plain correctness
  review of a control misses these, because each piece works as written.
- **Status:** graduated -> step 4 of the `ship-pr` skill (a review of review, merge or guard
  machinery asks that question and is posted through the machinery when it exists).

### L45 - Screen with allowlists, not denylists
- **Trigger:** 2026-10-13/14, #455 (eval containment). Four review rounds each found a new
  bypass of a denylist screen of what the agent under evaluation must not change: a Prisma
  generator opened on the same line as a closing brace, expected hashes taken after
  `prisma generate`, a generator hidden behind a lone carriage return ending a comment, and
  a project `.npmrc` whose `node-options` npm copies into `NODE_OPTIONS` under `npx`. Each
  fix closed one spelling and the next review found another. A fifth review then beat the
  first allowlist twice from inside it: a nested `lib/quiet/package.json` "imports" map
  aliasing `vitest`, and `expect.extend` on the vitest global from `messages/en`, which the
  base setup imports.
- **Lesson:** screen with allowlists, not denylists. Name what an untrusted actor may change
  (here: regular files under the application source roots, no dotfile, no `node_modules`
  segment, no test file, nothing under `prisma/`), take everything else from a trusted base,
  and stop running tools through layers that read untrusted config (call node scripts
  directly with an explicit environment). A denylist reviewer keeps finding the next
  spelling; an allowlist closes the file-level class. Name file types too, not only
  directories: "anything under lib/" still admitted a config. And where the untrusted code
  runs inside the judge's own process, no allowlist of files helps: detect tampering with
  a judge-owned canary. A canary that only probes behaviour is itself a list of cheats in
  disguise: the next review beat it with matchers lenient only for strings, spies or test
  callers. Record the judge's own functions by identity before any untrusted code loads,
  and fail on any change, whatever the new function does. Even that is a tripwire, not a
  proof: the sixth review beat it with a built-in left out of the hand-picked record, made
  to misbehave only for callers at hidden-test paths (the probes ran from elsewhere), and
  with test hooks reached through `globalThis`, which the lexical hook rule did not match.
  When the judge shares a process with the judged, say which checks exist, list the known
  gaps, keep a human diff review on the result, and stop hardening rounds at a stated
  budget instead of claiming closure.
- **Status:** graduated -> `isAgentWritable` in `evals/maintainer/runner.ts` (#455); the
  graded Prisma schema is the base file byte for byte; the tools run as node scripts with an
  empty `NODE_OPTIONS`; the `tamper-generator` self-check replays all four bypasses. Round 5:
  source-file extensions and config names at any depth in the allowlist, and the harness
  canary (`canaryFiles`), proven by the `tamper-inprocess` self-check. Round 6: the canary
  records function identities before the base setup and checks them around every test,
  proven by the `tamper-selective` self-check, which passes the round-5 canary. The two
  round-6 bypasses are documented residual risks, tracked in #468; the paid agent stays
  disabled until they are closed or accepted.
