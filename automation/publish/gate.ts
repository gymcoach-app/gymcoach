// Merge gate (roadmap milestone 2): decides whether a PR may be merged at an
// approved head SHA. Pure: the CLI in merge.ts fetches the live state and only
// calls the merge endpoint when this returns `mergeable`.
//
// The gate fails closed. A merge needs, for the exact approved SHA, a
// successful run of every allowlisted check from the expected CI app, with
// nothing missing, pending or failed; an empty check list is never success.
// The expected app is pinned (CI_APP_ID) and all required checks must come
// from one check suite, so no other app or workflow can stand in for CI.

export const FULL_SHA = /^[0-9a-f]{40}$/;

export interface PullState {
  number: number;
  state: string; // 'open' | 'closed'
  merged: boolean;
  draft: boolean;
  baseRef: string;
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
  | 'not-clean';

export interface Refusal {
  code: RefusalCode;
  detail: string;
}

export interface PassedCheck {
  name: string;
  checkRunId: number;
}

export type GateDecision =
  | {
      mergeable: true;
      sha: string;
      checks: PassedCheck[];
      requiredChecksSource: 'repository' | 'unreadable';
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

  if (pull.mergeableState !== 'clean') {
    refuse(
      'not-clean',
      `mergeable state is ${pull.mergeableState ?? 'not computed yet'}, not clean`,
    );
  }

  if (refusals.length) return { mergeable: false, refusals };
  return {
    mergeable: true,
    sha: approvedSha,
    checks: passed,
    requiredChecksSource: input.requiredChecks ? 'repository' : 'unreadable',
  };
}
