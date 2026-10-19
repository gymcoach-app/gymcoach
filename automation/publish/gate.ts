// Merge gate (roadmap milestone 2): decides whether a PR may be merged at an
// approved head SHA. Pure: the CLI in merge.ts fetches the live state and only
// calls the merge endpoint when this returns `mergeable`.
//
// The gate fails closed. A merge needs, for the exact approved SHA, a
// successful run of every allowlisted check from the expected CI app, with
// nothing missing, pending or failed; an empty check list is never success.
// The expected app is pinned (CI_APP_ID) and all required checks must come
// from one check suite, so no other app or workflow can stand in for CI.
//
// It also needs review evidence bound to the same commits: a structured review
// record (automation/review/) posted by a maintainer account whose head SHA is
// the approved SHA and whose base SHA is the PR's current base. The latest such
// record decides, and it must be ready with no blocking or major finding. A
// fixup push or a rebase therefore leaves no matching record until a fresh
// review is posted.
//
// The base must be the live tip of the base branch (lesson L39): the pulls API
// base only moves on a push, so a PR reviewed and tested before a sibling
// merged still looks current. Merging `origin/main` into the branch is the
// remedy. That merge is a new head; the records of the head before it carry
// over only across pure base updates (base-update.ts proves each hop: two
// parents, the second one on `main`, the same .gitattributes files on both
// parents, a tree equal to a clean re-merge), and CI must still pass on the
// new head itself.

import type { ReviewEvidence } from '@/automation/review/comment';
import { STOPPING_SEVERITIES, type StructuredReview } from '@/automation/review/schema';

export const FULL_SHA = /^[0-9a-f]{40}$/;

export interface PullState {
  number: number;
  state: string; // 'open' | 'closed'
  merged: boolean;
  draft: boolean;
  baseRef: string;
  // The base commit GitHub holds for the PR (pulls API base.sha). It moves when
  // the head is pushed or the PR is rebased, not when the base branch merely
  // advances.
  baseSha: string;
  headSha: string;
  // GitHub's mergeable_state: clean, unstable, blocked, behind, dirty,
  // unknown, has_hooks, draft. Null while GitHub is still computing it.
  mergeableState: string | null;
}

export interface CheckRun {
  id: number;
  name: string;
  headSha: string;
  status: string; // queued | in_progress | completed | ...
  conclusion: string | null; // success | failure | neutral | skipped | ...
  appId: number | null;
  // The check suite the run belongs to. A CI rerun stays in the same suite; a
  // same-named job from another workflow or event lands in another one.
  suiteId: number | null;
}

export interface RequiredCheck {
  context: string;
  integrationId: number | null;
}

export interface GateInput {
  pull: PullState;
  approvedSha: string;
  checkRuns: CheckRun[];
  // The committed allowlist (automation/publish/checks.ts).
  allowlist: readonly string[];
  // The repository's required status checks for the base branch, or null when
  // they could not be read (the allowlist and the pinned app then stand alone,
  // and the decision says so).
  requiredChecks: RequiredCheck[] | null;
  // The app expected to post every required check (checks.ts CI_APP_ID).
  ciAppId: number;
  baseBranch: string;
  // Valid review records from maintainer comments, oldest first
  // (automation/review/comment.ts parseReviewComments).
  reviews: ReviewEvidence[];
  // Maintainer comments carrying the review marker that did not parse or were
  // edited after posting. Any one refuses the merge: dropping it silently
  // would let an edit erase a stop.
  invalidReviews: { commentId: number; reason: string }[];
  // The live tip of the base branch (refs/heads/<baseBranch>), read at gate
  // time. The PR's base must be this commit.
  baseTipSha: string;
  // Pure base updates ending at the approved head, verified with git in the
  // trusted gate tree (base-update.ts).
  baseUpdates: BaseUpdateEvidence;
}

// One verified hop: `head` is a merge commit whose first parent is
// `reviewedHead` and whose second parent is `base` (a commit on the base
// branch), and whose tree is exactly the clean merge of the two.
export interface PureBaseUpdate {
  head: string;
  reviewedHead: string;
  base: string;
}

export interface BaseUpdateEvidence {
  // Newest first: hops[0].head is the approved head.
  hops: PureBaseUpdate[];
  // Review record bases git proved to be ancestors of the live tip. A carried
  // record counts only when its base is listed: a record bound to another
  // branch (a stacked PR later retargeted to main) never carries.
  basesOnMain: string[];
  // Set when git could not answer. The gate refuses: it never guesses.
  error: string | null;
}

export type RefusalCode =
  | 'approved-sha-invalid'
  | 'pr-not-open'
  | 'pr-draft'
  | 'wrong-base'
  | 'base-stale'
  | 'base-update-unverified'
  | 'head-moved'
  | 'allowlist-mismatch'
  | 'required-app-mismatch'
  | 'check-suite-mismatch'
  | 'no-checks'
  | 'check-wrong-sha'
  | 'check-foreign-app'
  | 'check-missing'
  | 'check-pending'
  | 'check-not-success'
  | 'not-clean'
  | 'no-review'
  | 'review-for-other-head'
  | 'review-for-other-base'
  | 'review-not-ready'
  | 'review-comment-invalid';

export interface Refusal {
  code: RefusalCode;
  detail: string;
}

export interface PassedCheck {
  name: string;
  checkRunId: number;
}

export interface PassedReview {
  commentId: number;
  author: string;
  reviewer: string;
  lenses: string[];
  // The head the record was posted for, when it reached the approved head
  // through pure base updates.
  carriedFrom?: string;
}

// A reviewer's identity for the gate: who reviewed (kind and model) and what
// they looked for (the lens set). A later record with the same identity
// replaces the earlier one (an explicit retraction or a re-review); a record
// with a different identity is another reviewer whose verdict also counts.
export function reviewerIdentity(review: StructuredReview): string {
  // JSON keeps the parts unambiguous whatever characters they contain.
  return JSON.stringify([
    review.reviewer.kind,
    review.reviewer.model ?? null,
    [...new Set(review.lenses)].sort(),
  ]);
}

export type GateDecision =
  | {
      mergeable: true;
      sha: string;
      checks: PassedCheck[];
      requiredChecksSource: 'repository' | 'unreadable';
      // One entry per reviewer identity, all ready.
      reviews: PassedReview[];
    }
  | { mergeable: false; refusals: Refusal[] };

export function evaluateMergeGate(input: GateInput): GateDecision {
  const { pull, approvedSha, allowlist, baseBranch } = input;
  const refusals: Refusal[] = [];
  const refuse = (code: RefusalCode, detail: string) => refusals.push({ code, detail });

  if (!FULL_SHA.test(approvedSha)) {
    refuse(
      'approved-sha-invalid',
      `approved SHA must be 40 lowercase hex characters: ${approvedSha}`,
    );
  }
  if (pull.state !== 'open' || pull.merged) {
    refuse('pr-not-open', `PR #${pull.number} is ${pull.merged ? 'already merged' : pull.state}`);
  }
  if (pull.draft) refuse('pr-draft', `PR #${pull.number} is a draft`);
  if (pull.baseRef !== baseBranch) {
    refuse('wrong-base', `PR #${pull.number} targets ${pull.baseRef}, not ${baseBranch}`);
  }
  if (pull.headSha !== approvedSha) {
    refuse('head-moved', `head is ${pull.headSha}, approved ${approvedSha}`);
  }
  if (pull.baseSha !== input.baseTipSha) {
    refuse(
      'base-stale',
      `the PR's base is ${pull.baseSha}, but ${baseBranch} is now at ${input.baseTipSha}: merge origin/${baseBranch} into the branch, push, and wait for CI on the new head`,
    );
  }
  if (input.baseUpdates.error !== null) {
    refuse(
      'base-update-unverified',
      `could not verify base updates with git: ${input.baseUpdates.error}`,
    );
  }

  // The repository's rules and the committed allowlist must name the same
  // checks: a drift either way means one of them is stale.
  const { ciAppId } = input;
  if (input.requiredChecks) {
    const required = new Set(input.requiredChecks.map((c) => c.context));
    const listed = new Set(allowlist);
    const onlyRequired = [...required].filter((c) => !listed.has(c));
    const onlyListed = [...listed].filter((c) => !required.has(c));
    if (onlyRequired.length || onlyListed.length) {
      refuse(
        'allowlist-mismatch',
        `required by the repository but not allowlisted: [${onlyRequired.join(', ')}]; allowlisted but not required: [${onlyListed.join(', ')}]`,
      );
    }
    // A rule naming another app means the pinned CI app is stale or the rules
    // were changed: refuse rather than guess. A rule with no app (any app may
    // post it) falls back to the pinned app, which is stricter.
    for (const c of input.requiredChecks) {
      if (c.integrationId != null && c.integrationId !== ciAppId) {
        refuse(
          'required-app-mismatch',
          `the repository requires "${c.context}" from app ${c.integrationId}, the gate pins app ${ciAppId}`,
        );
      }
    }
  }

  if (allowlist.length === 0) refuse('no-checks', 'the allowlist is empty');
  if (input.checkRuns.length === 0) {
    refuse('no-checks', `no check runs reported for ${approvedSha}`);
  }

  for (const run of input.checkRuns) {
    if (run.headSha !== approvedSha) {
      refuse('check-wrong-sha', `check "${run.name}" (${run.id}) ran on ${run.headSha}`);
    }
  }

  // Every required check from the CI app must sit in one check suite. Reruns
  // stay in their suite, so a second suite means another workflow or event
  // posted a same-named check, whose later run could shadow a real failure.
  const suites = new Set(
    input.checkRuns
      .filter((r) => r.headSha === approvedSha && r.appId === ciAppId && allowlist.includes(r.name))
      .map((r) => r.suiteId),
  );
  if (suites.size > 1 || suites.has(null)) {
    refuse(
      'check-suite-mismatch',
      `required checks span ${suites.size} check suites [${[...suites].map((s) => s ?? 'unknown').join(', ')}], expected one`,
    );
  }

  const passed: PassedCheck[] = [];
  for (const name of allowlist) {
    const named = input.checkRuns.filter((r) => r.name === name && r.headSha === approvedSha);
    const fromApp = named.filter((r) => r.appId === ciAppId);
    // A same-named check from another app could impersonate CI: fail closed.
    for (const foreign of named.filter((r) => r.appId !== ciAppId)) {
      refuse(
        'check-foreign-app',
        `check "${name}" (${foreign.id}) comes from app ${foreign.appId ?? 'unknown'}, expected ${ciAppId}`,
      );
    }
    if (fromApp.length === 0) {
      refuse('check-missing', `required check "${name}" has no run on ${approvedSha}`);
      continue;
    }
    // A rerun creates a new check run: the latest one decides.
    const latest = fromApp.reduce((a, b) => (b.id > a.id ? b : a));
    if (latest.status !== 'completed') {
      refuse('check-pending', `required check "${name}" is ${latest.status}`);
    } else if (latest.conclusion !== 'success') {
      // skipped and neutral are not success for a required check.
      refuse(
        'check-not-success',
        `required check "${name}" concluded ${latest.conclusion ?? 'null'}`,
      );
    } else {
      passed.push({ name, checkRunId: latest.id });
    }
  }

  const reviews = evaluateReviews(input, refuse);
  for (const bad of input.invalidReviews) {
    refuse('review-comment-invalid', `review comment ${bad.commentId}: ${bad.reason}`);
  }

  if (pull.mergeableState !== 'clean') {
    refuse(
      'not-clean',
      `mergeable state is ${pull.mergeableState ?? 'not computed yet'}, not clean`,
    );
  }

  if (refusals.length || !reviews) return { mergeable: false, refusals };
  return {
    mergeable: true,
    sha: approvedSha,
    checks: passed,
    requiredChecksSource: input.requiredChecks ? 'repository' : 'unreadable',
    reviews,
  };
}

// A record that stops the merge: not ready, or ready with a blocking or major
// finding (the schema rejects that shape; the gate does not rely on it).
function isStop(review: StructuredReview): boolean {
  return (
    review.verdict !== 'ready' ||
    review.findings.some((f) => STOPPING_SEVERITIES.includes(f.severity))
  );
}

// The older heads whose review records also count for the approved head:
// walking the verified pure base updates from the approved head backwards,
// each hop linked to the previous one, the head each hop was merged from. The
// newest hop must have merged in the PR's current base, which the gate
// separately requires to be the live tip. Anything that does not link ends
// the walk, so a gap never widens what counts.
export function carriedHeads(input: GateInput): string[] {
  const { pull, approvedSha, baseUpdates } = input;
  const carried: string[] = [];
  if (baseUpdates.error !== null) return carried;
  let head = approvedSha;
  for (const [i, hop] of baseUpdates.hops.entries()) {
    if (hop.head !== head) break;
    if (i === 0 && (hop.base !== pull.baseSha || hop.base !== input.baseTipSha)) break;
    if (hop.reviewedHead === approvedSha || carried.includes(hop.reviewedHead)) break;
    carried.push(hop.reviewedHead);
    head = hop.reviewedHead;
  }
  return carried;
}

// The review evidence for the approved head. A record counts when it is for
// (approved head, current base), or for a head that reached the approved head
// through pure base updates only (carriedHeads); every other record is stale,
// never a fallback. A carried record keeps its verdict either way: a stop on
// the older head still stops, so merging `main` can never erase it. Among the
// records that count, the latest of each reviewer identity decides, and every
// one must be ready with no blocking or major finding: one lens cannot
// override another lens's stop (multi-lens unanimity, docs/loops/10), only the
// same reviewer can retract its own verdict with a later record.
function evaluateReviews(
  input: GateInput,
  refuse: (code: RefusalCode, detail: string) => void,
): PassedReview[] | null {
  const { pull, approvedSha } = input;
  // Oldest first by comment id, whatever order the caller passed.
  const reviews = [...input.reviews].sort((a, b) => a.commentId - b.commentId);
  if (reviews.length === 0) {
    refuse('no-review', `no review record on PR #${pull.number}`);
    return null;
  }
  const carried = new Set(carriedHeads(input));
  const forHead = reviews.filter(
    (r) => r.review.headSha === approvedSha || carried.has(r.review.headSha),
  );
  if (forHead.length === 0) {
    const heads = [...new Set(reviews.map((r) => r.review.headSha.slice(0, 12)))];
    refuse(
      'review-for-other-head',
      `review records cover head(s) [${heads.join(', ')}], not ${approvedSha}`,
    );
    return null;
  }
  // A record for the approved head itself must be on the current base. A
  // carried record must have been made on a base that is on `main` (git proves
  // it, basesOnMain): otherwise the commits between that base and `main` (a
  // stacked PR's parent branch, say) would merge unreviewed. A carried stop
  // counts whatever its base: dropping it could only widen what merges. The
  // hops prove that only `main` was merged in since.
  const onMain = new Set(input.baseUpdates.basesOnMain);
  const matching = forHead.filter((r) =>
    carried.has(r.review.headSha)
      ? onMain.has(r.review.baseSha) || isStop(r.review)
      : r.review.baseSha === pull.baseSha,
  );
  if (matching.length === 0) {
    const bases = [...new Set(forHead.map((r) => r.review.baseSha.slice(0, 12)))];
    refuse(
      'review-for-other-base',
      `the review of ${approvedSha.slice(0, 12)} was made on base(s) [${bases.join(', ')}], the PR's base is now ${pull.baseSha}`,
    );
    return null;
  }
  const latestByReviewer = new Map<string, ReviewEvidence>();
  for (const r of matching) latestByReviewer.set(reviewerIdentity(r.review), r);
  const passed: PassedReview[] = [];
  let stopped = false;
  for (const [identity, r] of latestByReviewer) {
    const stopping = r.review.findings.filter((f) => STOPPING_SEVERITIES.includes(f.severity));
    if (isStop(r.review)) {
      refuse(
        'review-not-ready',
        `reviewer ${identity} (comment ${r.commentId}) says ${r.review.verdict} with ${stopping.length} blocking or major finding(s)`,
      );
      stopped = true;
      continue;
    }
    passed.push({
      commentId: r.commentId,
      author: r.author,
      reviewer: r.review.reviewer.model ?? r.review.reviewer.kind,
      lenses: r.review.lenses,
      ...(r.review.headSha === approvedSha ? {} : { carriedFrom: r.review.headSha }),
    });
  }
  return stopped ? null : passed;
}
