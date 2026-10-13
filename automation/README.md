# Maintainer automation

Tooling for the autonomous maintainer, kept apart from the GymCoach application:
the app never imports this directory and the Docker image does not ship it
(`.dockerignore`). See the
[implementation roadmap](../docs/loops/11-autonomous-development-roadmap.md).

## Merge gate (milestone 2)

- `publish/gate.ts` - pure decision: a PR may be merged at an approved SHA only when
  it is open, not a draft, targets `main`, is `clean`, its head is still the approved
  SHA, and every allowlisted CI check, from the pinned CI app and one check suite,
  succeeded on that exact SHA (latest rerun in that suite decides). Empty, missing,
  pending, skipped, neutral, foreign-app, second-suite and other-SHA checks refuse
  the merge. It also needs a review record (below) for that head and the PR's current
  base SHA; the latest matching record decides and must be ready with no blocking or
  major finding (`no-review`, `review-for-other-head`, `review-for-other-base`,
  `review-not-ready`).
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
  maintainer account (`MAINTAINERS` in `publish/checks.ts`) count; anyone can post a
  look-alike, so the author decides, not the content. Malformed maintainer records are
  reported and ignored, never counted.
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
account that posts them, and editing a posted comment changes the record it holds.

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
