# Maintainer automation

Tooling for the autonomous maintainer, kept apart from the GymCoach application:
the app never imports this directory and the Docker image does not ship it
(`.dockerignore`). See the
[implementation roadmap](../docs/loops/11-autonomous-development-roadmap.md).

## Git guard and review snapshots (milestone 2, lessons L15 and L38)

- `hooks/guard-git.cjs` - a PreToolUse hook for the Bash tool, wired in
  `.claude/settings.json`. It reads the hook JSON on stdin, parses the command (quotes,
  `&&`/`;`/`|`, subshells, `$(...)`, `bash -c`, here-documents, `cd`/`pushd`, `git -C`)
  and exits 2 with a reason when a git command would move `HEAD` or clobber the tree of a
  checkout the session does not own. Claude Code puts `agent_id` in a subagent's hook
  input and leaves it out for the main session (checked live on Claude Code 2.1.296, the
  minimum version assumed). `agent_type` is not used: Claude Code also sets it for a main
  session started with `claude --agent`. If a version ever omitted `agent_id` for a
  subagent, the guard would treat it as a main session (fail open); the session-start
  canary below catches that. The rules differ:
  - "moves HEAD or clobbers": `git checkout <ref>` (including `-b`, `--detach`), `git switch`,
    `git reset --hard|--keep|--merge|--soft` and `git reset <commit>`, `git clean -f`,
    `rebase`, `cherry-pick`, `am`, `revert`, `update-ref`, `symbolic-ref <name> <ref>`,
    `read-tree -u`, and path-wide or sourced restores (`git checkout -- .`,
    `git checkout <commit> -- <path>`, `git restore .`, `git restore --source=...`);
    plus `git checkout-index -f`, `git apply -R`, `git worktree add --force|-B` and
    `git submodule update --force`, and a git subcommand only known at run time
    (`git $x`, `git $(...)`);
  - a **subagent** is refused those in a **primary checkout** (its `.git` is a directory,
    such as the main checkout) and in a **linked worktree other than the one containing its
    cwd**; it is also refused `git worktree remove|move` of another worktree,
    `git branch -D|-d|-f|-M|-m|-C` (the orchestrator cleans up), and `git pull`, `git merge`
    and `git commit --amend` in a primary checkout;
  - the **main session** (operator or orchestrator) may do them in a primary checkout, but
    not in another session's linked worktree;
  - refused for everyone, because the stash stack is shared by every worktree: `git stash`,
    `git stash push|save` without a message, `pop`, `drop`, `clear`, `branch`, and `apply`
    without an explicit stash commit sha;
  - allowed: read-only git, `fetch`, `commit`, `push`, `worktree add -b` (and, outside a
    primary checkout or for the main session, `pull` and `merge`),
    restoring a single file (`git checkout -- <file>`, `git restore <file>`),
    `git reset [HEAD] [--] <paths>`, tagged stash pushes, `git stash apply <sha>`.
  The parser follows shell keywords and groups (`if`/`then`, `do`/`done`, `{ }`, `!`),
  wrappers (`env`, `command`, `time`, `timeout`, `nice`, `xargs`, `sudo`, `stdbuf`; the
  chdir of `env -C`/`--chdir` and `sudo -D` is applied), `cd` options (`cd -P`, `cd --`),
  an absolute `git -C /path` even after `cd -`, git spelled with quotes or a backslash, any
  `-c` flag cluster of a shell (`bash -lc`, `sh -ec`), and treats `GIT_DIR=`/`GIT_WORK_TREE=`
  (also exported) as an unknown target. Unbalanced quotes alone (an apostrophe in prose) are
  not refused; a guarded git command next to them is. A guarded command whose target it
  cannot resolve (`cd "$DIR"`, `cd -` followed by a relative path, `--work-tree`,
  `xargs git checkout`) is refused; a main session's `git worktree remove|move` is allowed
  wherever its shell is (the merge-gate cleanup). Session-start canary:
  `node automation/hooks/guard-git.cjs --self-test` checks the decision logic, and the
  subagent probe in `docs/loops/06-orchestration.md` checks that Claude Code still sends
  `agent_id`. A bug in
  the guard itself allows the command, so a broken guard cannot block every Bash call. It
  runs on old Node too (no modern syntax) and takes about 30 ms. The operator turns it off
  for one session by starting Claude Code with `GYMCOACH_GIT_GUARD=off`; an assignment
  inside the command has no effect.
- `review/snapshot.sh <pr> [dir]` - fetches the PR head into `refs/remotes/pr/<pr>`, adds
  a detached worktree at that SHA (default `${TMPDIR:-/tmp}/gymcoach-review/pr-<n>-<sha12>`),
  makes it read-only and prints its path; `--remove <dir>` deletes it, and refuses any path
  outside `${TMPDIR:-/tmp}/gymcoach-review/` or a worktree that is not detached. For reading
  only: never start `claude`, `npm` or `eslint` inside a snapshot of a fork PR (its
  `.claude/settings.json` hooks and configs would run); external code still runs only in CI.
  If a snapshot directory is deleted by hand, `git worktree prune` drops the stale entry.

Limits: "own" means the worktree containing the session's current directory, so a session
that `cd`s into another worktree in one call and runs a checkout in the next is treated as
its owner; a git call hidden in a variable, `eval`, an alias (`git co`), a script file, a
here-document fed to a shell, backticks or `"$(...)"` inside double quotes is not
inspected; `merge` and `pull` are not guarded; `git branch -D` by the main session is
allowed (git itself refuses to delete a branch checked out in a worktree); the hook guards
Claude Code sessions in this project, not humans or other tools.

## Merge gate (milestone 2)

- `publish/gate.ts` - pure decision: a PR may be merged at an approved SHA only when
  it is open, not a draft, targets `main`, is `clean`, its head is still the approved
  SHA, and every allowlisted CI check, from the pinned CI app and one check suite,
  succeeded on that exact SHA (latest rerun in that suite decides). Empty, missing,
  pending, skipped, neutral, foreign-app, second-suite and other-SHA checks refuse
  the merge. It also needs a review record (below) for that head and the PR's current
  base SHA. For that pair, the latest record of each reviewer (kind, model and lens set)
  counts, and every one must be ready with no blocking or major finding: one lens never
  overrides another lens's stop, only the same reviewer can retract its own verdict with
  a later record (`no-review`, `review-for-other-head`, `review-for-other-base`,
  `review-not-ready`). A maintainer comment with the review marker that was edited after
  posting or does not parse refuses the merge (`review-comment-invalid`): an edit must not
  erase a stop. Post a fresh record and delete the broken comment.
  The PR's base must be the live tip of `main` (`base-stale`, lesson L39): the pulls API
  base only moves on a push, so the CLI reads `refs/heads/main` itself. Merging
  `origin/main` into the branch is the remedy, and CI must then pass on that new head.
- `publish/base-update.ts` - proves with git, in the trusted gate tree, which updates
  of the approved head were pure base updates: a merge commit with exactly two parents,
  the second one the live tip of `main` (a commit on `main` for an older hop, up to 5
  hops), the same `.gitattributes` files on both parents, nested ones included and
  compared from NUL-separated `ls-tree -z` output so a quoted (non-ASCII) path is not
  missed (the reviewed head therefore cannot pick a built-in merge driver such as
  `merge=union` for the re-merge), and a tree equal to a clean re-merge of the two
  parents done in a throwaway worktree. Git runs without the host's global or system
  config or attributes files (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`,
  `GIT_ATTR_NOSYSTEM=1`, `core.attributesFile=/dev/null`), with hooks and rerere off
  and a fixed identity. Records on the head before such a hop carry over to the new
  head: stops always, so merging `main` never erases one, and ready records only when
  git proves their base is on `main` (a stacked PR retargeted to `main` carries
  nothing; a base never fetched is not on `main`, since all of `main` is fetched, and
  no longer refuses the merge). A hand edit, a conflict
  resolution or an extra commit ends the chain (the old records are stale, as before).
  The CLI only runs git when the approved head is a two-parent merge and some record is
  for another head, fetching into a ref namespace private to the run and deleting it
  after; when it runs, any git failure refuses the merge (`base-update-unverified`).
  Tested against real git in a throwaway repository (`base-update.test.ts`). For a fork
  PR, `gh api -X PUT repos/gymcoach-app/gymcoach/pulls/<n>/update-branch -f
  expected_head_sha=<head>` writes the base update when `maintainerCanModify` is set and
  the tier rules allow it.
- `publish/checks.ts` - the allowlist (the five jobs of `.github/workflows/ci.yml`) and
  the pinned CI app (`CI_APP_ID`, GitHub Actions). The gate refuses when either
  disagrees with the repository's required status checks; when the rules cannot be
  read, the allowlist and the pinned app still apply (fail closed).
- `publish/merge.ts` - the only way the maintainer merges (see the `ship-pr` skill,
  which runs it from a detached worktree of freshly fetched `origin/main`). Dry run by
  default; `--merge` calls the merge endpoint with `sha=<approved>`, then deletes a
  same-repo head branch (never a fork's; `--keep-branch` to keep it). Strict argument
  parsing; re-reads an unknown mergeable state up to 5 times. Exit codes: 0 merged or
  mergeable, 1 refused, 2 usage error, 3 `gh`, network or any unexpected error (one
  line, no stack; check the PR before any retry).

  ```bash
  npx tsx automation/publish/merge.ts 123 --sha <reviewed-40-hex-sha>
  npx tsx automation/publish/merge.ts 123 --sha <sha> --merge --method squash \
    --title "feat: ... (#123)" --message "Closes #120"
  ```

## Review records (milestones 2 and 4)

- `review/schema.ts` - one structured review of one PR at one base and head SHA:
  reviewer, lenses, files inspected, files not read in full, findings (blocking, major,
  minor, nit, with file, line and claim) and the verdict. A `ready` verdict cannot carry
  a blocking or major finding.
- `review/comment.ts` - the record travels as a PR comment: a short summary, the marker
  `<!-- gymcoach-review v1 -->` and one fenced JSON block. Only comments authored by a
  maintainer account (`MAINTAINERS` in `publish/checks.ts`, matched on the numeric user
  id, never the login, which a renamed account frees for reuse) count; anyone can post a
  look-alike, so the author decides, not the content. An edited record is refused (post
  a new one instead). Malformed maintainer records are reported and ignored, never
  counted. Not checked: `performed_via_github_app` (an app acting with a maintainer's
  own user token posts as that maintainer).
- `review/lenses.ts` - lens routing: which review lenses a PR needs, from its changed
  paths (renamed-from paths included) and its author's trust tier. Each rule returns a
  group of lenses, any one of which satisfies it, and the reason it applies:

  | Rule | Applies when | Needs one of |
  |---|---|---|
  | `base` | every PR | `correctness`, `tests` |
  | `group-a-security` | a group A path (docs/loops/10) | `security` (advisory for a maintainer) |
  | `group-a-threat-model` | a group A path | `threat-model` (advisory for a maintainer) |
  | `external-security` | the author is not a maintainer | `security` |
  | `docs-accuracy` | every path is `*.md` or under `docs/` | `docs-accuracy` |
  | `translation-quality` | a `messages/<locale>/` path, locale not `en` | `translation-quality` (advisory for a maintainer) |

  Rules only add requirements. The group A conditions of docs/loops/10 apply to external
  PRs; the loop's own work on those paths is governed by the charter, so for a maintainer
  the two group A lenses, like translation quality, are advice the decision reports, not
  a refusal. Lens names are compared trimmed and lowercase, and these spellings from past
  records are aliases: `egress-backdoor`, `backdoor-egress` and `egress` for `security`,
  `docs` for `docs-accuracy`, `test` for `tests`. Any other name satisfies nothing. The
  tier fails closed: a maintainer matches on the numeric user id, a missing author is
  unvetted, and vetted logins come from the policy file next to the running module (the
  trusted tree, whatever the cwd). The merge gate takes the union of lenses over the
  records that count for the approved head and passed, and refuses with
  `review-lens-missing`, naming the rule and its reason, when a group is uncovered.
  Advisory groups are listed in the decision's `advisories`.
- `publish/changed-paths.ts` - the paths the gate routes on, read with git in the trusted
  gate tree for the approved SHA, never from the files API (which lists the PR's live
  head, so a push after approval could change the routing): it fetches the PR head and
  `main` into a private ref namespace, checks the approved commit is present, and diffs
  it against its merge base with `main` with rename detection, listing both paths of a
  rename or copy. Any git error refuses (`changed-files-unreadable`).
  `npx tsx automation/review/lenses.ts <pr>` prints the groups for a live PR from the
  files API, to plan the reviewers before the gate runs.
- `review/record.ts` - posts a record after validating it and checking that its head
  and base are the PR's live head and base and that `gh` is a maintainer account.
  `--dry-run` prints the comment. Exit codes as for `merge.ts`.

  ```bash
  npx tsx automation/review/record.ts 123 --file review.json
  ```

A fixup push changes the head and a push after merging `main` into the branch changes
the base, so the previous record stops matching and a fresh review must post a new
one. "Base" is GitHub's `base.sha`: it does not move when `main` advances without a
push, so a base that moved under a reviewed PR is not yet revalidated mechanically
(lesson L39 remains a procedure). Records are only as trustworthy as the maintainer
account that posts them: the gate proves a record exists for the right commits, not
that the review was independent, since the loop posts records from the same account that
authors its PRs. `record.ts` sends the comment body on stdin, so a large record never
hits the argument size limit.

Limits: closing and reopening a PR, or opening a second PR at the same head SHA,
starts a second check suite, and the gate then refuses that SHA for good (fail
closed, `check-suite-mismatch`); the remedy is a new commit, a review of it, and a
new gate run. The trusted copy is whatever `origin/main` holds, which is why
`automation/**` is a group B path in `docs/loops/10-external-contributions.md`. It runs with the caller's gh credentials, so it constrains the agent that
follows the skill, not a determined one with the same token.

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

Attribution, never guessed:

- `head-branch`: the session worked, from inside an agent worktree
  (`.claude/worktrees/`), on exactly one branch other than `main`, a detached HEAD or
  a fresh `worktree-agent-*` branch, and that branch is the PR's head branch. A
  branch seen while a session sat in the main checkout is whatever that checkout
  had checked out, so it is not evidence.
- `pr-reference`: the session worked on no branch of its own and its task prompt
  names exactly one PR (`pull/<n>/head` first, else `PR #<n>`) in the baseline. A
  session on its own branch that is no run's head branch stays unattributed even if
  it names a PR: the PR is context, not its task.
- Conflicting, ambiguous or missing evidence leaves a session unattributed.
  Orchestrating (main) sessions span many runs: their usage is totalled apart and
  only their link count is recorded per run. Review subagents count toward the run
  they review, so for an external PR the attributed usage is the maintainer side.

Each API response is counted once, at its final usage, even when logged per
streamed block. A response held by an orchestrating transcript and a subagent one
(a fork copies its parent's turns) goes to orchestration; one held by several
subagents goes to the unattributed side; the result does not depend on file order.
A token count the transcript did not record (a missing field, a cache write without
its TTL split) stays unknown, never 0; records without a response id, model or
usage are dropped and counted. Only `claude-*` model ids are published, anything
else is `other` (unpriced). Skill version is known only for a skill invoked through
the Skill tool (`<skill>@<commit>` of its `SKILL.md` at session start).

Privacy: transcripts are read in memory (`cwd` only to tell an agent worktree from
the main checkout, the first prompt only for PR numbers). The outputs hold token
counts, estimated cost, durations, counts, model ids and skill versions, never
prompts, tool output, paths, branch names or session ids. The script also makes
read-only `gh api` GET calls for PR head branches (PR numbers from `runs.jsonl`
only), and `git log` for skill versions.

Limits: only transcripts still on this machine are visible; Claude Code removes old
session files automatically, so the window starts at the oldest retained one
(2026-09-11 here), cannot be regenerated later, and runs created within 48 hours of
its start are flagged possibly partial. Work outside Claude Code is invisible.
Per-run cost is a lower bound. Summed session time is not human-attended time:
parallel subagents overlap and sessions include idle waits. The estimate is not an
amount billed.

## Run-time usage ledger (milestone 1)

The transcript scan above only sees transcripts that are still on the machine.
Since this change, every Claude Code session in this project also records usage
**at run time**, through hooks wired in `.claude/settings.json`:

- `hooks/record-usage.cjs` runs on `SubagentStop`, `SessionEnd` and
  `UserPromptSubmit`, and appends at most one line per event to a ledger outside
  the repository: `${XDG_DATA_HOME:-~/.local/share}/gymcoach-runs/ledger.jsonl`
  (or `GYMCOACH_USAGE_LEDGER_PATH`). `GYMCOACH_USAGE_LEDGER=off` at launch
  disables it.
  - `agent` line, when a subagent finishes: its own transcript
    (`agent_transcript_path` in the hook input) summarised with the same rules as
    `usage/build.ts` (one entry per response id at its final usage, unknown never
    0, `claude-*` model ids only), as token sums per model and speed, plus response
    and dropped counts, first and last timestamps, skills invoked through the Skill
    tool, PR numbers named in its task prompt, the Claude Code version, and
    SHA-256 prefixes of the worktree branches it worked on. A fork's transcript
    starts with a copy of its parent's turn; responses also present in the parent
    transcript are left out and counted (`inheritedResponses`, null when the parent
    could not be read).
  - `session` line, when a session ends: the main session's own usage and the PR
    numbers it linked.
  - `prompt` line, when a prompt arrives: only whether it was a harness
    notification (a background task finishing) or anything else.
- `ledger/schema.ts` - the ledger line schema (version 1).
- `ledger/attribute.ts` - pure: ledger lines in, the session summaries
  `usage/build.ts` already attributes, so the ledger produces the same
  `usage.jsonl` shape with the same rules (head branch, compared as hashes, or a
  single PR reference). The latest line per agent or session wins.
- `ledger/collect.ts` - writes `usage.jsonl` and `usage-meta.json` (with
  `source: "ledger"`) for the runs of a baseline into a separate directory:

  ```bash
  npx tsx automation/ledger/collect.ts --dir docs/loops/baseline/<date> --out <dir>
  ```

### Green-gate runs in the ledger

`scripts/verify.sh` records each of its runs in the same ledger, as a `verify`
line, from its exit handler (`scripts/verify-steps.sh` keeps the step
bookkeeping, `ledger/record-verify.cjs` writes the line). Same file and same
switches as the usage hook (`GYMCOACH_USAGE_LEDGER=off`,
`GYMCOACH_USAGE_LEDGER_PATH`), because a run's evidence is read by joining both;
the line kind keeps them apart, and the usage attribution ignores it.

- A line holds: the tier (`default` or `full`), the exit code (null when the shell
  died from a signal during a step), each step's fixed
  name (`slot`, `prisma`, `lint`, `typecheck`, `unit`, `script-tests`, `build`,
  `infra-lock`, `test-db`, `integration`, `e2e`), outcome (`passed`, `failed`,
  or `interrupted` for a step still open when the shell exited) and duration in
  ms, the start and end times, HEAD's SHA, whether the tree was dirty, the
  **tree SHA of the checked files**, a hash of the branch name, and the hashed
  Claude Code session id (`CLAUDE_CODE_SESSION_ID`, the hook's `sessionKey`) when
  the gate ran inside Claude Code. No names, paths or output.
- The tree SHA is the point: the gate usually runs before the commit, so HEAD
  alone does not say what passed. On a dirty tree it is computed with a temporary
  index (a copy of the real one, else `read-tree HEAD`; then `add -A`, `write-tree`):
  it stores blob and tree objects that `git gc` later collects, and touches no ref
  and not the real index (the dirty check runs `git --no-optional-locks status`).
  The tree is taken before the first step and again at exit, and recorded only when
  the two agree; a file changed while the gate ran (an agent editing during a
  background run) leaves `treeSha` null and `treeChanged` true. A recorded
  `treeSha` means the same tree at start and at exit, not that nothing changed in
  between: an edit reverted before the gate ended (or a stash or checkout round
  trip) leaves the two equal although some steps saw other content. With that
  caveat, a PR head whose tree is a recorded `treeSha` had that content gated, at
  the steps the line lists; for a squash merge, that is the merged content only if
  the base did not move after the gate.
- Signals: `verify.sh` sets no INT or TERM trap, because bash defers a trapped
  signal until the running step ends. A killed gate dies at once with the signal's
  own status (a calling loop still sees death by SIGINT); bash still runs the EXIT
  trap, which records the open step as `interrupted` with exit null. The trap
  closes the heavy slot and the test-infra lock before it starts the recorder, so a
  waiting run does not wait for it (one node process and a few git calls, usually
  well under a second; each git call has a 20 s timeout).
- Fail-open: recording never changes the gate's exit code or output (one stderr
  line, `record-verify: skipped (<code>)`, when the line cannot be written).
  Self-tested by `scripts/verify-steps.test.sh` in the default gate, including a
  file edited mid-run and real TERM and INT signals to a gate blocked in a step.
- `ledger/verify.ts` - pure: verify lines in, one record per PR run
  (`verify.jsonl`, written by `ledger/collect.ts` next to `usage.jsonl`, with
  `verify-meta.json`): the number of gate runs, green runs and green `--full`
  runs, the last green run (time, tier, HEAD and tree), and whether a green run
  checked exactly the PR's final head tree, and at which tier. A gate run belongs
  to a PR run by the hashed head branch (after any earlier PR run on the same branch
  name closed) or by the head tree, before the PR closed; one that matches two runs
  is left out and counted. Unknown, never 0: recording is per checkout (a worktree
  created before the recorder merged runs an older `verify.sh` and writes nothing),
  so counts are known only for a run that at least one recorded gate run matches,
  created after the first recorded gate run, and touched by no ambiguous gate run;
  every other run has unknown counts, so a run that was never gated (an external PR,
  whose code is never run locally) is unknown too, not 0. `finalHeadGreen` is known
  true whenever a recorded green gate run checked the exact final head tree, and
  known false only for a run whose counts are known and none of whose green gate
  runs left its tree unrecorded. So a known `gateRuns` is never 0: the records
  with known counts are exactly the gated runs, and a rollup over them (a share of
  PR runs gated, a mean `gateRuns`) is biased upward by construction; do not build
  such a metric on these records.

Limits: gate runs outside `verify.sh` (a lone `npx vitest`, CI) are not recorded;
the head tree comes from the local clone or `gh api`, and is unknown when neither
has it; attempts inside an agent (edits between gate runs) are still not counted,
only gate runs.

Human interventions: a session's prompts are counted (`ledger.prompts` in the
meta), split into harness notifications and other prompts. They are not
attributed to a run, because one orchestrating session spans many runs, so the
per-run human-interventions measure stays unknown. "Other" includes a scripted
`claude -p` prompt, so it is an upper bound on operator prompts.

Privacy: the hook reads transcripts and prompts in memory only. A line holds
numbers, model ids, skill names, public PR numbers, random agent ids and 16-hex
SHA-256 prefixes of the session id and of branch names; never prompt or message
text, tool output, paths or branch names. It prints nothing on stdout.

Failure policy: fail open. Any error ends the hook with exit 0 and no line, so a
broken ledger never blocks an agent; the line is written with one append call.
Checked live on Claude Code 2.1.296: one `agent` line per finished subagent; a
ledger path that cannot be written left the agent's run unaffected. Limits: a
`SessionEnd` hook can be cancelled when the CLI exits first (seen once, with a
failing write), so a session line can be missing; usage outside Claude Code, and
before this hook, is not recorded; attribution is as conservative as the
transcript scan.

Flush race (mitigated in the milestone 2 limits PR): `SubagentStop` fires a few
tens of milliseconds before Claude Code writes the subagent's last records, so a
first read often saw no response at all; 3 of the first 4 live `agent` lines had
`responses: 0`. An `agent` line is now written only once the transcript holds at
least one response and has stopped growing (two sizes 150 ms apart are equal), or
after 2 s, whichever comes first. A write that lands more than 2 s after the
hook starts would still be missed; none was seen.

## Local limits: heavy-work slots and subagent dispatch (milestone 2)

Two machine-level limits replace "be careful when running ticks in parallel".
Both were motivated by one session (2026-10-13) where three or four dev ticks
plus Docker pushed the load average to ~20: Playwright pages crashed with
`ERR_INSUFFICIENT_RESOURCES` and jsdom tests crossed their timeouts (L42).

- **Heavy-work slots** (`scripts/heavy-slot.sh`, sourced by `scripts/verify.sh`).
  A `verify.sh` run takes one of N machine-wide slots before it lints, tests and
  builds: N = `GYMCOACH_HEAVY_SLOTS`, default max(1, cores / 4). A slot is a
  `flock` on `${TMPDIR:-/tmp}/gymcoach-heavy/slot-<i>`, so the kernel releases it
  when the run dies; there is no stale-lock cleanup to get wrong. A run that finds
  every slot taken waits (up to `GYMCOACH_HEAVY_WAIT` seconds, default 3600) and
  prints each holder's pid, start time and label. Lock order: heavy slot first,
  then the `--full` test-infra lock, and long-lived children get `8>&- 9>&-`, so
  the two locks cannot deadlock and a zombie next-server (L12) holds neither.
  `GYMCOACH_HEAVY_SLOTS=off` skips it for one run. Every child of `verify.sh`, default
  tier included, gets `8>&-`, so an orphaned worker cannot keep a slot. Only
  `verify.sh` takes a slot: `scripts/container-gate.sh`, `container-run.sh` and
  `container-integration.sh` runs (inside Docker) take none. Self-test:
  `scripts/heavy-slot.test.sh` (run by the default gate).
- **Subagent dispatch limit** (`hooks/dispatch-limit.cjs`, wired in
  `.claude/settings.json` on `PreToolUse` for the Agent tool, `SubagentStart`,
  `SubagentStop` and `SessionEnd`). A session may have at most
  `GYMCOACH_MAX_SUBAGENTS` (default 3) subagents running or starting; the next
  Agent call is refused with a reason that tells the model to wait for a
  completion notification. Running means between `SubagentStart` and
  `SubagentStop` (subagents run in the background by default, so the Agent call
  itself returns at once); an accepted call leaves a two-minute reservation so
  several Agent calls in one turn cannot overshoot. With
  `GYMCOACH_SESSION_TOKEN_BUDGET` set, a new subagent is also refused once the
  session's finished subagents spent more tokens than the budget at full or write
  rates (input, output, cache writes, from the run-time ledger; cache reads not
  counted). It is a token budget, not a cost budget: cache reads, often the
  largest share of an agent's tokens, are left out, and cache writes count once.
  With the ledger off (`GYMCOACH_USAGE_LEDGER=off`) the budget cannot be measured:
  the hook says so once on stderr and does not enforce it. The ledger read is cached
  by the ledger's size and mtime. Subagents already running finish: the in-flight
  overrun is bounded by the concurrency limit. Only the Agent tool is ever refused;
  the hook fails open on any error. State lives in
  `${XDG_STATE_HOME:-~/.local/state}/gymcoach-runs/agents/<session key>/`.
  `SubagentStop` does not always fire: a background subagent stopped with
  TaskStop produced none on Claude Code 2.1.296 (probe in a throwaway repo), and
  a crash can skip it. So a running entry counts only while its subagent looks
  alive: its transcript (`<session transcript dir>/<session id>/subagents/agent-<id>.jsonl`)
  was written within `GYMCOACH_SUBAGENT_IDLE_MINUTES` (default 60: real subagent
  transcripts here stay silent for up to 46 minutes during one long tool call, such as
  a wait on a heavy-work slot or the `--full` lock); an entry whose transcript cannot
  be derived counts for `GYMCOACH_SUBAGENT_STALE_HOURS` (default 2). A subagent running
  one silent command longer than the idle window stops counting early, so the limit can
  be loose, never stuck. The long default has a cost: a subagent that crashed or was
  stopped without a `SubagentStop` keeps its place until its transcript has been silent
  for 60 minutes, so the session can run one subagent fewer for up to an hour (lower
  `GYMCOACH_SUBAGENT_IDLE_MINUTES` for that session, or wait). A `SubagentStart` that hits the 3 s state-lock timeout fails
  open and writes no running entry, so that subagent is never counted (fails loose). `SubagentStop`
  removes its own entry without the lock, so a busy lock never leaves a finished
  subagent counted. The refusal names these recovery paths.
  `GYMCOACH_MAX_SUBAGENTS=off` disables the concurrency limit.

Checked live on Claude Code 2.1.296 in a throwaway repository (trivial "reply ok"
subagents on Haiku): with a limit of 3, four parallel Agent calls in one message
gave three accepted and the fourth refused with the hook's reason, and a fifth
call after the first three finished was accepted; with a budget of 1 token, the
first subagent ran and the second was refused ("finished subagents used 62
tokens"). Limits: the slots cover `verify.sh` only (a bare `npm run build` or
Playwright run outside it takes no slot); the dispatch limit is per session, not
machine-wide, so two orchestrating sessions get three subagents each; the token
budget sees only finished subagents and only what the ledger recorded, and is checked
against recorded spend, so it can lag by one agent (the usage line of the last finished
subagent may reach the ledger about 2 s after its `SubagentStop`: the 2 s cap plus one
150 ms poll and a read); turn,
retry and wall-time budgets are not enforced yet.

## Changelog fragments (milestone 4, lesson L47)

- `changelog/assemble.ts` - folds the fragments in `changelog.d/` (one file per change,
  `<issue-or-pr>-<slug>.md` with a `section` front matter; format in
  [`changelog.d/README.md`](../changelog.d/README.md)) into `CHANGELOG.md`:
  `npx tsx automation/changelog/assemble.ts`. Each entry goes at the top of its section
  under `## [Unreleased]`, newest number first; a missing section is created at its Keep a
  Changelog position; existing entries are kept as they are; the folded files are deleted.
  An entry already present in its section, as a whole entry (a one-line fragment does not
  match the first line of a longer entry), is skipped and named in the output, so a rerun
  after a partial fold adds no duplicate; CRLF line endings are kept.
  `--check` only validates the fragments (name, known section, one non-empty entry without
  a bullet or blank lines, no em or en dash) and runs in the green gate's script
  self-tests step. Exit codes: 0 done, 1 an invalid fragment, 2 usage error. `--dir` and
  `--changelog` point it at other paths.
- Why: with a stale base refused (L39), every merge makes the next PRs merge `main`; when
  they all edit the same `## [Unreleased]` lines that merge conflicts, a hand-resolved
  conflict is not a pure base update, and every review record must be posted again. New
  files never conflict, so the merge stays one the gate can prove.

## Related: replayable evaluation tasks

The maintainer's evaluation harness (roadmap milestone 3) lives in
[`evals/maintainer/`](../evals/maintainer/README.md): versioned tasks replayed
from frozen snapshots of this repository, hidden graders, and a runner that
records pass, fail or infra-error per run.
