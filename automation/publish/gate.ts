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

import type { ReviewEvidence } from '@/automation/review/comment';
import { STOPPING_SEVERITIES } from '@/automation/review/schema';

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
}

export type RefusalCode =
  | 'approved-sha-invalid'
  | 'pr-not-open'
  | 'pr-draft'
  | 'wrong-base'
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
  | 'review-not-ready';

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
}

export type GateDecision =
  | {
      mergeable: true;
      sha: string;
      checks: PassedCheck[];
      requiredChecksSource: 'repository' | 'unreadable';
      review: PassedReview;
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

  const review = evaluateReviews(input, refuse);

  if (pull.mergeableState !== 'clean') {
    refuse(
      'not-clean',
      `mergeable state is ${pull.mergeableState ?? 'not computed yet'}, not clean`,
    );
  }

  if (refusals.length || !review) return { mergeable: false, refusals };
  return {
    mergeable: true,
    sha: approvedSha,
    checks: passed,
    requiredChecksSource: input.requiredChecks ? 'repository' : 'unreadable',
    review,
  };
}

// The review evidence for (approved head, current base). Records for another
// head or base are stale, never a fallback: the latest record for the exact
// pair decides, so a later needs-changes record overrides an earlier ready one.
function evaluateReviews(
  input: GateInput,
  refuse: (code: RefusalCode, detail: string) => void,
): PassedReview | null {
  const { pull, approvedSha, reviews } = input;
  if (reviews.length === 0) {
    refuse('no-review', `no review record on PR #${pull.number}`);
    return null;
  }
  const forHead = reviews.filter((r) => r.review.headSha === approvedSha);
  if (forHead.length === 0) {
    const heads = [...new Set(reviews.map((r) => r.review.headSha.slice(0, 12)))];
    refuse(
      'review-for-other-head',
      `review records cover head(s) [${heads.join(', ')}], not ${approvedSha}`,
    );
    return null;
  }
  const matching = forHead.filter((r) => r.review.baseSha === pull.baseSha);
  if (matching.length === 0) {
    const bases = [...new Set(forHead.map((r) => r.review.baseSha.slice(0, 12)))];
    refuse(
      'review-for-other-base',
      `the review of ${approvedSha.slice(0, 12)} was made on base(s) [${bases.join(', ')}], the PR's base is now ${pull.baseSha}`,
    );
    return null;
  }
  const latest = matching[matching.length - 1]!;
  const stopping = latest.review.findings.filter((f) => STOPPING_SEVERITIES.includes(f.severity));
  if (latest.review.verdict !== 'ready' || stopping.length > 0) {
    refuse(
      'review-not-ready',
      `the latest review record (comment ${latest.commentId}) says ${latest.review.verdict} with ${stopping.length} blocking or major finding(s)`,
    );
    return null;
  }
  return {
    commentId: latest.commentId,
    author: latest.author,
    reviewer: latest.review.reviewer.model ?? latest.review.reviewer.kind,
    lenses: latest.review.lenses,
  };
}
