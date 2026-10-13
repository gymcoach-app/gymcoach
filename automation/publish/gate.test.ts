import { describe, expect, it } from 'vitest';
import { CI_APP_ID, REQUIRED_CHECKS } from './checks';
import { type CheckRun, type GateInput, type RefusalCode, evaluateMergeGate } from './gate';
import type { ReviewEvidence } from '../review/comment';
import type { StructuredReview } from '../review/schema';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const CI_APP = CI_APP_ID;
const SUITE = 7000;
const BASE = 'c'.repeat(40);

function evidence(over: Partial<StructuredReview> = {}, commentId = 900): ReviewEvidence {
  return {
    commentId,
    author: 'JulienAu',
    review: {
      schemaVersion: 1,
      pr: 42,
      baseSha: BASE,
      headSha: SHA,
      reviewer: { kind: 'agent', model: 'claude-opus-5-5' },
      lenses: ['correctness'],
      filesInspected: ['lib/a.ts'],
      filesNotReadInFull: [],
      findings: [],
      verdict: 'ready',
      createdAt: '2026-10-13T12:00:00Z',
      ...over,
    },
  };
}

function green(name: string, id: number, over: Partial<CheckRun> = {}): CheckRun {
  return {
    id,
    name,
    headSha: SHA,
    status: 'completed',
    conclusion: 'success',
    appId: CI_APP,
    suiteId: SUITE,
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
      baseSha: BASE,
      headSha: SHA,
      mergeableState: 'clean',
    },
    approvedSha: SHA,
    checkRuns: REQUIRED_CHECKS.map((name, i) => green(name, 100 + i)),
    allowlist: REQUIRED_CHECKS,
    requiredChecks: REQUIRED_CHECKS.map((context) => ({ context, integrationId: CI_APP })),
    ciAppId: CI_APP,
    baseBranch: 'main',
    reviews: [evidence()],
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

  it('refuses a short, malformed or uppercase approved SHA', () => {
    expect(codes({ approvedSha: 'aaaaaaa' })).toContain('approved-sha-invalid');
    expect(codes({ approvedSha: 'A'.repeat(40) })).toContain('approved-sha-invalid');
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

  it('falls back to the allowlist and the pinned app when the rules are unreadable', () => {
    const decision = evaluateMergeGate(input({ requiredChecks: null }));
    expect(decision).toMatchObject({ mergeable: true, requiredChecksSource: 'unreadable' });
    // Unreadable rules never open the app check: a same-named run from another
    // app is still refused.
    const impostor = green(REQUIRED_CHECKS[0], 900, { appId: 999 });
    expect(codes({ requiredChecks: null, checkRuns: [...input().checkRuns, impostor] })).toContain(
      'check-foreign-app',
    );
  });

  it('uses the pinned app when a required check names no app', () => {
    const openRule = input().requiredChecks!.map((c) => ({ ...c, integrationId: null }));
    expect(evaluateMergeGate(input({ requiredChecks: openRule })).mergeable).toBe(true);
    const onlyImpostor = input().checkRuns.map((r, i) => (i === 0 ? { ...r, appId: 999 } : r));
    const result = codes({ requiredChecks: openRule, checkRuns: onlyImpostor });
    expect(result).toContain('check-foreign-app');
    expect(result).toContain('check-missing');
  });

  it('refuses when the repository requires a check from another app than the pinned one', () => {
    const otherApp = input().requiredChecks!.map((c, i) =>
      i === 0 ? { ...c, integrationId: 4242 } : c,
    );
    expect(codes({ requiredChecks: otherApp })).toContain('required-app-mismatch');
  });

  it('ignores a higher-id run from a foreign app instead of letting it decide', () => {
    const failed = input().checkRuns.map((r, i) => (i === 0 ? { ...r, conclusion: 'failure' } : r));
    const foreignGreen = green(REQUIRED_CHECKS[0], 99999, { appId: 999, suiteId: 8000 });
    const result = codes({ checkRuns: [...failed, foreignGreen] });
    expect(result).toContain('check-not-success');
    expect(result).toContain('check-foreign-app');
  });

  it('refuses required checks spread over two check suites', () => {
    // Another workflow posts a later green run with the CI job's name: it must
    // not shadow the real (failed) CI run.
    const failed = input().checkRuns.map((r, i) => (i === 0 ? { ...r, conclusion: 'failure' } : r));
    const shadow = green(REQUIRED_CHECKS[0], 99999, { suiteId: 8000 });
    expect(codes({ checkRuns: [...failed, shadow] })).toContain('check-suite-mismatch');
    const unknownSuite = input().checkRuns.map((r, i) => (i === 1 ? { ...r, suiteId: null } : r));
    expect(codes({ checkRuns: unknownSuite })).toContain('check-suite-mismatch');
  });

  it('accepts a rerun inside the same check suite', () => {
    const failedFirst = green(REQUIRED_CHECKS[3], 60, { conclusion: 'failure' });
    expect(
      evaluateMergeGate(input({ checkRuns: [failedFirst, ...input().checkRuns] })).mergeable,
    ).toBe(true);
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

  describe('review evidence', () => {
    it('names the review record that allowed the merge', () => {
      const decision = evaluateMergeGate(input());
      expect(decision).toMatchObject({
        mergeable: true,
        review: { commentId: 900, author: 'JulienAu', reviewer: 'claude-opus-5-5' },
      });
    });

    it('refuses a PR with no review record', () => {
      expect(codes({ reviews: [] })).toEqual(['no-review']);
    });

    it('refuses when the only review is of another head (a fixup was pushed)', () => {
      expect(codes({ reviews: [evidence({ headSha: OTHER })] })).toEqual(['review-for-other-head']);
    });

    it('refuses when the review was made on another base (the PR was rebased)', () => {
      expect(codes({ reviews: [evidence({ baseSha: OTHER })] })).toEqual(['review-for-other-base']);
    });

    it('refuses a needs-changes verdict', () => {
      expect(
        codes({
          reviews: [
            evidence({
              verdict: 'needs-changes',
              findings: [{ severity: 'minor', file: 'lib/a.ts', line: 3, claim: 'x' }],
            }),
          ],
        }),
      ).toEqual(['review-not-ready']);
    });

    it('refuses a ready verdict that still carries a major finding', () => {
      // The schema rejects this shape; the gate must not rely on that alone.
      expect(
        codes({
          reviews: [
            evidence({ findings: [{ severity: 'major', file: null, line: null, claim: 'x' }] }),
          ],
        }),
      ).toEqual(['review-not-ready']);
    });

    it('lets the latest record for the exact head and base decide', () => {
      const ready = evidence({}, 900);
      const later = evidence({ verdict: 'needs-changes' }, 901);
      expect(codes({ reviews: [ready, later] })).toEqual(['review-not-ready']);
      expect(evaluateMergeGate(input({ reviews: [later, evidence({}, 902)] })).mergeable).toBe(
        true,
      );
    });

    it('never falls back to a ready review of an older head', () => {
      const old = evidence({ headSha: OTHER }, 900);
      const current = evidence({ verdict: 'needs-changes' }, 901);
      expect(codes({ reviews: [old, current] })).toEqual(['review-not-ready']);
    });

    it('accepts minor and nit findings on a ready verdict', () => {
      const decision = evaluateMergeGate(
        input({
          reviews: [
            evidence({
              findings: [
                { severity: 'minor', file: 'lib/a.ts', line: 1, claim: 'x' },
                { severity: 'nit', file: null, line: null, claim: 'y' },
              ],
            }),
          ],
        }),
      );
      expect(decision.mergeable).toBe(true);
    });
  });
});
