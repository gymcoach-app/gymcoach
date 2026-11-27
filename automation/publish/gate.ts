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
// parents, a tree equal to a clean re-merge) or across merges of `main` that
// left the PR's diff identical, blob for blob (identical-diff carry-over, #582,
// also proven in base-update.ts), and CI must still pass on the new head
// itself.
//
// The ready records must also cover the review lenses the PR needs (lens
// routing, automation/review/lenses.ts): a pure function of the changed paths
// and the author's trust tier. The union of lenses over the passing records
// must meet every required group. The paths come from git at the approved SHA,
// never from the PR's live head; a git error refuses.
//
// A maintainer-authored PR also needs a green local gate run (#596, lessons
// L55 and L61): a `verify` line of the local run ledger, of the full tier (the
// default tier for a docs-only diff), on the content of the approved head or
// of a head whose records carry over to it. The rule, its exemptions and its
// limits are in local-gate.ts; the decision names the ledger line it accepted.

import type { ReviewEvidence } from '@/automation/review/comment';
import { STOPPING_SEVERITIES, type StructuredReview } from '@/automation/review/schema';
import type { ChangedPaths } from '@/automation/publish/changed-paths';
import {
  type TrustTier,
  lensCoverage,
  normaliseLens,
  requiredLenses,
} from '@/automation/review/lenses';
import {
  type LocalGateEvidence,
  type LocalGateRefusalCode,
  type LocalGateReport,
  evaluateLocalGate,
} from '@/automation/publish/local-gate';

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
  // Every path the approved SHA changes against its merge base with the base
  // branch, renamed-from paths included (changed-paths.ts), or the git error
  // that kept it from being read. An error refuses: lens routing never guesses.
  changedFiles: ChangedPaths;
  // The PR author's tier (lenses.ts trustTier); an unknown author is unvetted.
  authorTier: TrustTier;
  // The local run ledger's `verify` lines that git matched to the approved
  // head and to the heads review records may carry from, or why the ledger
  // could not be read (local-gate-collect.ts).
  localGate: LocalGateEvidence;
  // The pure base updates the local gate may follow, when they were verified
  // for it alone: the approved head is a merge of the base branch and every
  // review record is already on it, so `baseUpdates` was not computed (a run
  // made before an update-branch still counts, #596). Never used for review
  // records. Absent: the local gate uses `baseUpdates`.
  localGateBaseUpdates?: BaseUpdateEvidence;
}

// One verified hop: `head` is a merge commit whose first parent is
// `reviewedHead` and whose second parent is `base` (a commit on the base
// branch), and whose tree is exactly the clean merge of the two.
export interface PureBaseUpdate {
  head: string;
  reviewedHead: string;
  base: string;
}

// Identical-diff carry-over (#582): what git proved, in the trusted gate tree,
// about one review record pin (recordBase, recordHead) against the approved
// head and the live tip of the base branch. `carried` is true only when
// (a) recordHead is an ancestor of the approved head, (b) every commit added
// since on the first-parent chain is a two-parent merge whose second parent is
// on the base branch, (c) `git patch-id --stable` of the PR diff is the same
// before and after, (d) the PR's file list is the same, and, stricter than
// patch-id (which ignores whitespace and line numbers), every file of the PR
// has the same blob and mode on both sides of both diffs, so the base branch
// changed none of them. The record base must be on the base branch and the
// approved head must contain the live tip.
export interface IdenticalDiffCarry {
  recordHead: string;
  recordBase: string;
  // The approved head and the live tip the proof was made against.
  head: string;
  base: string;
  carried: boolean;
  // What git proved when carried; otherwise the first rule that failed.
  detail: string;
}

export interface BaseUpdateEvidence {
  // Newest first: hops[0].head is the approved head.
  hops: PureBaseUpdate[];
  // Review record bases git proved to be ancestors of the live tip. A carried
  // record counts only when its base is listed: a record bound to another
  // branch (a stacked PR later retargeted to main) never carries.
  basesOnMain: string[];
  // One entry per review record pin (base, head) for a head other than the
  // approved one: whether git proved the identical-diff carry-over rule for
  // it. Absent when no such pin was examined.
  identicalDiffs?: IdenticalDiffCarry[];
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
  | 'review-comment-invalid'
  | 'changed-files-unreadable'
  | 'review-lens-missing'
  | LocalGateRefusalCode;

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
  // through pure base updates or an identical-diff carry-over.
  carriedFrom?: string;
  // Which rule carried it, and what git proved (printed by the CLI).
  carriedBy?: 'pure-base-update' | 'identical-diff';
  carriedWhy?: string;
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
      // Advisory lens groups no record covered (reported, not enforced).
      advisories: string[];
      // The local gate run that allowed the merge (the ledger line), or why
      // none is required for this author.
      localGate: LocalGateReport;
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
  const advisories = reviews ? evaluateLenses(input, reviews, refuse) : [];
  for (const bad of input.invalidReviews) {
    refuse('review-comment-invalid', `review comment ${bad.commentId}: ${bad.reason}`);
  }

  // The local green gate, on the approved head or on a head the records carry
  // from, by the same two proofs and the same links to the live tip.
  const localGate = evaluateLocalGate({
    evidence: input.localGate,
    approvedSha,
    carriedHeads: [
      ...carriedHeads(input, input.localGateBaseUpdates ?? input.baseUpdates),
      ...identicalDiffCarries(input).map((c) => c.recordHead),
    ],
    carryError: (input.localGateBaseUpdates ?? input.baseUpdates).error,
    changedPaths: input.changedFiles.paths,
    authorTier: input.authorTier,
  });
  if (!localGate.ok) refuse(localGate.code, localGate.detail);

  if (pull.mergeableState !== 'clean') {
    refuse(
      'not-clean',
      `mergeable state is ${pull.mergeableState ?? 'not computed yet'}, not clean`,
    );
  }

  if (refusals.length || !reviews || !localGate.ok) return { mergeable: false, refusals };
  return {
    mergeable: true,
    sha: approvedSha,
    checks: passed,
    requiredChecksSource: input.requiredChecks ? 'repository' : 'unreadable',
    reviews,
    advisories,
    localGate: localGate.report,
  };
}

// Lens routing: the union of lenses over the passing records must cover every
// required group. Only called with the passing records (every reviewer ready),
// so a lens on a stopped record never counts. Returns the advisory groups left
// uncovered.
function evaluateLenses(
  input: GateInput,
  reviews: PassedReview[],
  refuse: (code: RefusalCode, detail: string) => void,
): string[] {
  if (input.changedFiles.paths === null) {
    refuse(
      'changed-files-unreadable',
      `could not read the paths ${input.approvedSha.slice(0, 12)} changes (${input.changedFiles.error}), so the required review lenses are unknown`,
    );
    return [];
  }
  const requirements = requiredLenses({ files: input.changedFiles.paths, tier: input.authorTier });
  const lenses = [...new Set(reviews.flatMap((r) => r.lenses.map(normaliseLens)))];
  const { missing, advisoryMissing } = lensCoverage(requirements, lenses);
  for (const r of missing) {
    refuse(
      'review-lens-missing',
      `rule ${r.rule} needs one of [${r.anyOf.join(', ')}]: ${r.reason}; the ready records cover [${lenses.sort().join(', ')}]`,
    );
  }
  return advisoryMissing.map((r) => `${r.rule}: one of [${r.anyOf.join(', ')}] (${r.reason})`);
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
export function carriedHeads(
  input: GateInput,
  baseUpdates: BaseUpdateEvidence = input.baseUpdates,
): string[] {
  const { pull, approvedSha } = input;
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

// The identical-diff proofs that count for this gate run: carried, and made
// against the approved head and a live tip that is also the PR's base (the
// same link carriedHeads requires of the newest hop). None on a git error.
export function identicalDiffCarries(input: GateInput): IdenticalDiffCarry[] {
  const { pull, approvedSha, baseUpdates } = input;
  if (baseUpdates.error !== null) return [];
  return (baseUpdates.identicalDiffs ?? []).filter(
    (c) =>
      c.carried &&
      c.head === approvedSha &&
      c.recordHead !== approvedSha &&
      c.base === pull.baseSha &&
      c.base === input.baseTipSha,
  );
}

// Why the records of other heads did not carry, for a refusal's detail.
function notCarried(input: GateInput): string {
  const failed = (input.baseUpdates.identicalDiffs ?? []).filter((c) => !c.carried);
  if (failed.length === 0) return '';
  const lines = failed.map(
    (c) => `${c.recordHead.slice(0, 12)} (base ${c.recordBase.slice(0, 12)}): ${c.detail}`,
  );
  return `; not carried over: ${lines.join('; ')}`;
}

// The review evidence for the approved head. A record counts when it is for
// (approved head, current base), or for a head that reached the approved head
// through pure base updates only (carriedHeads), or for a (base, head) pin git
// proved an identical-diff carry-over for (identicalDiffCarries); every other
// record is stale, never a fallback. A carried record keeps its verdict either
// way: a stop on the older head still stops, so merging `main` can never erase
// it. Among the
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
  const diffCarries = identicalDiffCarries(input);
  const diffCarriedHeads = new Set(diffCarries.map((c) => c.recordHead));
  const diffCarry = (r: ReviewEvidence) =>
    diffCarries.find(
      (c) => c.recordHead === r.review.headSha && c.recordBase === r.review.baseSha,
    );
  const forHead = reviews.filter(
    (r) =>
      r.review.headSha === approvedSha ||
      carried.has(r.review.headSha) ||
      diffCarriedHeads.has(r.review.headSha),
  );
  if (forHead.length === 0) {
    const heads = [...new Set(reviews.map((r) => r.review.headSha.slice(0, 12)))];
    refuse(
      'review-for-other-head',
      `review records cover head(s) [${heads.join(', ')}], not ${approvedSha}${notCarried(input)}`,
    );
    return null;
  }
  // A record for the approved head itself must be on the current base. A
  // carried record must have been made on a base that is on `main` (git proves
  // it, basesOnMain): otherwise the commits between that base and `main` (a
  // stacked PR's parent branch, say) would merge unreviewed. A carried stop
  // counts whatever its base: dropping it could only widen what merges. The
  // hops prove that only `main` was merged in since. An identical-diff
  // carry-over is proven per (base, head) pin, record base on `main` included;
  // a stop on a head some pin carried counts whatever its own pin proved, for
  // the same reason.
  const onMain = new Set(input.baseUpdates.basesOnMain);
  const byPureUpdate = (r: ReviewEvidence) =>
    carried.has(r.review.headSha) && onMain.has(r.review.baseSha);
  const matching = forHead.filter((r) =>
    r.review.headSha === approvedSha
      ? r.review.baseSha === pull.baseSha
      : byPureUpdate(r) || diffCarry(r) !== undefined || isStop(r.review),
  );
  if (matching.length === 0) {
    const bases = [...new Set(forHead.map((r) => r.review.baseSha.slice(0, 12)))];
    refuse(
      'review-for-other-base',
      `the review of ${approvedSha.slice(0, 12)} was made on base(s) [${bases.join(', ')}], the PR's base is now ${pull.baseSha}${notCarried(input)}`,
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
      ...(r.review.headSha === approvedSha
        ? {}
        : byPureUpdate(r)
          ? {
              carriedFrom: r.review.headSha,
              carriedBy: 'pure-base-update' as const,
              carriedWhy: `every commit since ${r.review.headSha.slice(0, 12)} is a merge of ${input.baseBranch} whose tree equals a clean re-merge`,
            }
          : {
              carriedFrom: r.review.headSha,
              carriedBy: 'identical-diff' as const,
              carriedWhy: diffCarry(r)?.detail ?? '',
            }),
    });
  }
  return stopped ? null : passed;
}
