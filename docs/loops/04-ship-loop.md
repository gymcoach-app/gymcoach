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
lint/type/unit/build, but integration + E2E run **only in CI**. The ship loop is where the
full gate actually gates a merge.

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

Every merge goes through the merge gate
([`automation/publish/merge.ts`](../../automation/publish/merge.ts)). Since #481 (lesson
L39, follow-ups in #483) the gate reads the live tip of `main` and refuses a PR whose base
is behind it (`base-stale`). The PR merges `origin/main`, CI runs again on the new head,
and only then may it merge. So a green CI always describes a tree that already holds every
sibling that merged first.

Re-reviewing after every such merge would make a wave of N PRs cost about N squared
reviews. The gate avoids that: it carries review records across a **pure base update**, a
merge of `main` with no hand edit and the same `.gitattributes` files on both parents,
which it proves with git in its own trusted tree
([`base-update.ts`](../../automation/publish/base-update.ts)). Stops always carry; a ready
record carries only when its base is on `main`. A hand-resolved conflict is not a pure
update, so every record has to be posted again for the new head.

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

## How it chains

`implement-issue` (`02`) and `write-up` (`05`) both produce PRs; the ship loop merges
both. After each merge it re-checks the next PR's CI, because `main` just moved. Merged
work then becomes the raw material for the content loop (`05`).
