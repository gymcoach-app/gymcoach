import { describe, expect, it } from 'vitest';
import { REQUIRED_CHECKS } from './checks';
import { type CheckRun, type GateInput, type RefusalCode, evaluateMergeGate } from './gate';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const CI_APP = 15368;

function green(name: string, id: number, over: Partial<CheckRun> = {}): CheckRun {
  return {
    id,
    name,
    headSha: SHA,
    status: 'completed',
    conclusion: 'success',
    appId: CI_APP,
    ...over,
  };
}

function input(over: Partial<GateInput> = {}): GateInput {
  return {
    pull: {
      number: 42,
      state: 'open',
      merged: false,
      draft: false,
      baseRef: 'main',
      headSha: SHA,
      mergeableState: 'clean',
    },
    approvedSha: SHA,
    checkRuns: REQUIRED_CHECKS.map((name, i) => green(name, 100 + i)),
    allowlist: REQUIRED_CHECKS,
    requiredChecks: REQUIRED_CHECKS.map((context) => ({ context, integrationId: CI_APP })),
    baseBranch: 'main',
    ...over,
  };
}

function codes(over: Partial<GateInput>): RefusalCode[] {
  const decision = evaluateMergeGate(input(over));
  if (decision.mergeable) throw new Error('expected a refusal');
  return decision.refusals.map((r) => r.code);
}

const pull = input().pull;

describe('merge gate', () => {
  it('allows a merge when every allowlisted check succeeded on the approved head', () => {
    const decision = evaluateMergeGate(input());
    expect(decision).toMatchObject({
      mergeable: true,
      sha: SHA,
      requiredChecksSource: 'repository',
    });
    if (decision.mergeable) expect(decision.checks).toHaveLength(REQUIRED_CHECKS.length);
  });

  it('refuses when the head moved after approval', () => {
    expect(codes({ pull: { ...pull, headSha: OTHER } })).toContain('head-moved');
  });

  it('refuses a short or malformed approved SHA', () => {
    expect(codes({ approvedSha: 'aaaaaaa' })).toContain('approved-sha-invalid');
  });

  it('refuses a closed, merged, draft or wrong-base PR', () => {
    expect(codes({ pull: { ...pull, state: 'closed' } })).toContain('pr-not-open');
    expect(codes({ pull: { ...pull, merged: true, state: 'closed' } })).toContain('pr-not-open');
    expect(codes({ pull: { ...pull, draft: true } })).toContain('pr-draft');
    expect(codes({ pull: { ...pull, baseRef: 'release' } })).toContain('wrong-base');
  });

  it('never treats an empty check list as success', () => {
    const result = codes({ checkRuns: [] });
    expect(result).toContain('no-checks');
    expect(result).toContain('check-missing');
  });

  it('refuses when an allowlisted check is missing', () => {
    expect(codes({ checkRuns: input().checkRuns.slice(1) })).toContain('check-missing');
  });

  it('refuses a pending required check', () => {
    const runs = input().checkRuns.map((r, i) =>
      i === 0 ? { ...r, status: 'in_progress', conclusion: null } : r,
    );
    expect(codes({ checkRuns: runs })).toContain('check-pending');
  });

  it.each(['failure', 'skipped', 'neutral', 'cancelled', 'timed_out'])(
    'refuses a required check that concluded %s',
    (conclusion) => {
      const runs = input().checkRuns.map((r, i) => (i === 2 ? { ...r, conclusion } : r));
      expect(codes({ checkRuns: runs })).toContain('check-not-success');
    },
  );

  it('lets the latest rerun decide a check', () => {
    const failedFirst = green(REQUIRED_CHECKS[0], 50, { conclusion: 'failure' });
    const decision = evaluateMergeGate(input({ checkRuns: [failedFirst, ...input().checkRuns] }));
    expect(decision.mergeable).toBe(true);

    const greenFirstThenRed = [
      ...input().checkRuns,
      green(REQUIRED_CHECKS[0], 999, { conclusion: 'failure' }),
    ];
    expect(codes({ checkRuns: greenFirstThenRed })).toContain('check-not-success');
  });

  it('refuses checks that ran on another SHA, even when green', () => {
    const runs = input().checkRuns.map((r) => ({ ...r, headSha: OTHER }));
    const result = codes({ checkRuns: runs });
    expect(result).toContain('check-wrong-sha');
    expect(result).toContain('check-missing');
  });

  it('refuses a same-named check posted by another app', () => {
    const impostor = green(REQUIRED_CHECKS[1], 500, { appId: 999 });
    expect(codes({ checkRuns: [...input().checkRuns, impostor] })).toContain('check-foreign-app');
    // An impostor alone never satisfies the check either.
    const onlyImpostor = input().checkRuns.map((r, i) => (i === 1 ? { ...r, appId: 999 } : r));
    expect(codes({ checkRuns: onlyImpostor })).toContain('check-missing');
  });

  it('refuses when the repository rules and the allowlist disagree', () => {
    const fewer = input().requiredChecks!.slice(1);
    expect(codes({ requiredChecks: fewer })).toContain('allowlist-mismatch');
    const extra = [...input().requiredChecks!, { context: 'New job', integrationId: CI_APP }];
    expect(codes({ requiredChecks: extra })).toContain('allowlist-mismatch');
  });

  it('falls back to the allowlist alone when the rules are unreadable, and says so', () => {
    const decision = evaluateMergeGate(input({ requiredChecks: null }));
    expect(decision).toMatchObject({ mergeable: true, requiredChecksSource: 'unreadable' });
  });

  it('refuses an empty allowlist', () => {
    expect(codes({ allowlist: [], requiredChecks: [] })).toContain('no-checks');
  });

  it.each(['blocked', 'behind', 'dirty', 'unstable', 'unknown', null])(
    'refuses a mergeable state of %s',
    (mergeableState) => {
      expect(codes({ pull: { ...pull, mergeableState } })).toContain('not-clean');
    },
  );
});
