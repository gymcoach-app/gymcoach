# 04 — The ship loop (CI-watch + auto-merge)

`implement-issue` opens a PR and then, by design, stops: "never merge - a human reviews".
That human is the last manual step in the pipeline. The ship loop removes it **safely**:
it watches the PR's CI, fixes a red gate within bounds, self-reviews the diff, and
**auto-merges on green**. This is the shipping half - the CI-watch and merge stages of the
pipeline, in one reusable skill (`.claude/skills/ship-pr/`).

## The autonomy boundary (the decision that defines this loop)

Auto-merge is allowed **only** when CI is green and the self-review is clean. The green CI
is the trust boundary. The loop never merges around it:

- never merge while a required check is **red or pending**;
- never merge a **draft**, a `CHANGES_REQUESTED` PR, or one not targeting `main`;
- PRs only - nothing ever lands on `main` directly;
- the inherited deny-list (no force-push, no hard reset) still holds.

This is why local-only verification is not enough: `scripts/verify.sh` covers
lint/type/unit/build by default and integration + E2E only with `--full`, on one machine,
while CI runs the whole pyramid on every PR. The ship loop is where the full gate actually
gates a merge; since #596 the merge gate also requires the local `--full` run on the
reviewed head (section below).

## The body is one sentence

> for each ready PR: watch CI -> if red, fix (<=3 tries) -> self-review -> merge on green.

## Running it

```
/loop Run the ship-pr skill on the open, non-draft PRs that target main. Watch CI, fix a
red gate up to 3 times, self-review, and squash-merge any PR that is green and clean.
STOP when there are no ready PRs, or a PR is still red after 3 fix attempts (leave a
comment and move on). Never merge on a red or pending gate.
```

## The three hard stops

1. **Max fix attempts** - 3 per PR, then comment the blocker and stop. No thrashing on a
   genuinely broken change.
2. **No-progress detection** - a stuck-pending CI or a PR that fails the skip checks is
   reported, not forced through.
3. **Budget ceiling** - token target on the turn.

## Fixing a red gate

Reproduce locally with the matching gate tier (`bash scripts/verify.sh`, or `--full` for
integration/E2E), read the real error with `gh run view --log-failed`, fix the **cause**
on the PR branch, re-verify, push. Each fix counts against the 3-attempt budget so a
flaky-looking failure cannot loop forever.

## Sequential merges: a stale base is refused, records carry over a pure update

The `ship-pr` skill merges through the merge gate
([`automation/publish/merge.ts`](../../automation/publish/merge.ts)). Since #481 (lesson
L39, follow-ups in #483) a merge done through `merge.ts` reads the live tip of `main` and
refuses a PR whose base is not that tip (`base-stale`). The PR merges `origin/main`, CI runs
again on the new head, and only then may it merge, so CI must be green on a head that
already contains the current `main`. Two residuals stay open (the roadmap's milestone 2
item says the same): the merge call pins the head, not the base, so a merge by another
session or a human in the seconds between the gate's read of `main` and the merge call is
not caught (no merge queue, no lock across sessions); and a merge from the GitHub UI or a
plain `gh` call bypasses the gate, because the `protect-main` ruleset does not require
up-to-date branches (`strict_required_status_checks_policy: false`).

Re-reviewing after every such merge would make a wave of N PRs cost about N squared
reviews. The gate avoids that: it carries review records across a **pure base update**, a
merge of `main` with no hand edit and the same `.gitattributes` files on both parents,
which it proves with git in its own trusted tree
([`base-update.ts`](../../automation/publish/base-update.ts)). Stops always carry; a ready
record carries only when its base is on `main`. A hand-resolved conflict is not a pure
update, so every record has to be posted again for the new head.

Since #582 the gate has a second proof for the pins the first one does not reach
(identical-diff carry-over, same file): a record pinned to (base, head) counts for the
live head when its head is an ancestor of the live head, every commit added since is a
two-parent merge whose second parent is on `main`, `git patch-id --stable` of the PR diff
and the PR's file list are unchanged, and every file of the PR has the same blobs on both
sides of both diffs (so `main` changed none of them; patch-id alone ignores whitespace and
line numbers). It replaces a manual step of the 2026-11-17 wave, where the orchestrator
re-posted records for the new head after its own patch-id check: records are now posted
once, for the head the reviewer read (`record.ts --head-moved` when the branch was updated
in the meantime), and the gate prints which rule carried each one. A hand-resolved
conflict changes the diff and still needs a fresh review of the delta.

The same day (2026-11-18, lesson L60): after #584 merged, #585 and #583 were brought up to
date with `main` and the gate carried their records with the pure base update proof that
existed before #584 (now printed as `carriedBy: pure-base-update`). What changed in practice
is the ordering: the records were posted once, before the `update-branch`, and nothing was
re-pinned by hand. The new identical-diff rule was not exercised in this batch. #586,
stacked on the Apple Health branch, conflicted with the squash of #583 in 14 files; that hand
resolution (the superset side kept) is not a merge the gate can prove, so it needed a delta
review, as the rule says.

What it cost before the fix (2026-10-19, the #485-#489 wave, lesson L47): every PR added
its entry to the same lines of `CHANGELOG.md`, so each merge left the next PRs with a
conflict that GitHub's update-branch could not write. That gave 3 hand-resolved merges and
5 re-attestation rounds, each a diff check that found nothing, plus a CI cycle per merge.
The fix is structural: PRs now add a file in `changelog.d/` instead (#491, #492) and the
write-up PR folds them, so a merge of `main` stays a pure update and the records carry.

The gate also caught a slip of the loop itself on #492, the first PR merged after
fragments landed: the review record post failed on a transient GitHub API error, the gate
refused the merge with `no-review`, the record was posted again, and the merge went
through on it. Nothing merged without its record.

## A green local gate on the reviewed head is part of the merge gate

Lesson L61 recorded a deviation: #587 was merged on green CI and two clean reviews while
all six local `verify.sh --full` runs on its head were red, and the rule that forbids it
existed only as prose in two skills. Since #596 (part A) the merge gate checks it. For a
PR authored by a maintainer account it reads the local run ledger (the `verify` line each
`scripts/verify.sh` run appends) and refuses unless a green run checked the content of the
approved head:

- **Tier.** The full tier (`--full`: integration and E2E as well). A docs-only diff may
  use the default tier: every changed path under `docs/`, or Markdown at the repository
  root or under `.claude/`, `.github/`, `automation/`, `changelog.d/` or `evals/`. Those
  files are read by the default tier (unit tests, the changelog fragment check) and by
  neither of the two tiers `--full` adds.
- **Content, not a commit id.** The line counts when the tree it checked is the tree of
  the head commit, so a run made just before the commit counts for it. A run in an agent
  worktree, whose only untracked file is the `node_modules` symlink, counts too: git
  proves that the symlink is the only difference. A run whose files changed while it ran
  never counts.
- **Head.** The approved head, or the head the review records are carried from (a pure
  base update or an identical-diff carry-over, the section above). A fixup push or a
  hand-resolved merge is a new head and needs its own run.
- **Red after green.** A failed run newer than the green one, on the same content,
  refuses the merge: the latest verdict decides, and a tree that passes and then fails is
  the flake L61 and L42 say to explain, not to outvote. A run that only failed waiting for
  a machine lock, or was killed, is no verdict.
- **No ledger, no merge.** `GYMCOACH_USAGE_LEDGER=off`, a missing file or an unreadable one
  refuses with the reason and the remedy. There is no override flag: a maintainer's code
  can always be gated on this machine, so the way forward is always the run itself.
- **External PRs are exempt**, and the gate says so in its output: their code is never
  run on the host (`10-external-contributions.md`), CI is their only executor.

The gate prints the ledger line it accepted (file, line number, tier, time, tree). The
loop and the operator share one machine account and the ledger is a local file, so this
check prevents slips, not forgery. The rule and its justifications are in
[`automation/README.md`](../../automation/README.md), "Merge gate";
the code is [`local-gate.ts`](../../automation/publish/local-gate.ts).

In practice: run `bash scripts/verify.sh --full` on the final content before the commit
that is pushed for merge (or on a clean checkout of it), on its own line, and read its own
exit code (L55). When `main` is merged in without hand edits afterwards, that run still
counts. After any fixup, run it again.

## How it chains

`implement-issue` (`02`) and `write-up` (`05`) both produce PRs; the ship loop merges
both. After each merge it re-checks the next PR's CI, because `main` just moved. Merged
work then becomes the raw material for the content loop (`05`).
