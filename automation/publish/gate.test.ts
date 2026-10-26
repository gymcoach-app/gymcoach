import { describe, expect, it } from 'vitest';
import { CI_APP_ID, REQUIRED_CHECKS } from './checks';
import { type CheckRun, type GateInput, type RefusalCode, evaluateMergeGate } from './gate';
import type { ReviewEvidence } from '../review/comment';
import type { StructuredReview } from '../review/schema';

const SHA = 'a'.repeat(40);
const paths = (...p: string[]) => ({ paths: p, error: null });
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
    invalidReviews: [],
    baseTipSha: BASE,
    baseUpdates: { hops: [], basesOnMain: [], error: null },
    changedFiles: paths('lib/a.ts'),
    authorTier: 'maintainer',
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
        reviews: [{ commentId: 900, author: 'JulienAu', reviewer: 'claude-opus-5-5' }],
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

    it('lets a reviewer replace its own earlier verdict on the same commits', () => {
      const ready = evidence({}, 900);
      const later = evidence({ verdict: 'needs-changes' }, 901);
      expect(codes({ reviews: [ready, later] })).toEqual(['review-not-ready']);
      // Same reviewer and lens set: the later ready record retracts the stop.
      expect(evaluateMergeGate(input({ reviews: [later, evidence({}, 902)] })).mergeable).toBe(
        true,
      );
    });

    it('refuses when a maintainer review comment was edited or did not parse', () => {
      // An edit must not erase a stop by turning the record invalid.
      expect(
        codes({
          invalidReviews: [{ commentId: 950, reason: 'the comment was edited after posting' }],
        }),
      ).toEqual(['review-comment-invalid']);
    });

    it('keeps reviewer identities apart even when a lens contains a separator', () => {
      const comma = evidence({ lenses: ['a,b'], verdict: 'needs-changes', findings: [] }, 960);
      const split = evidence({ lenses: ['a', 'b'] }, 961);
      expect(codes({ reviews: [comma, split] })).toEqual(['review-not-ready']);
    });

    it('never lets one lens override another lens that stopped the merge', () => {
      const security = (over: Partial<StructuredReview>, id: number) =>
        evidence({ lenses: ['security', 'egress'], ...over }, id);
      const stop = security(
        {
          verdict: 'needs-changes',
          findings: [{ severity: 'blocking', file: 'lib/a.ts', line: 1, claim: 'leak' }],
        },
        900,
      );
      // A later ready record from the correctness lens does not clear it.
      expect(codes({ reviews: [stop, evidence({}, 901)] })).toEqual(['review-not-ready']);
      // Both lenses ready: mergeable, with one entry per reviewer.
      const both = evaluateMergeGate(input({ reviews: [security({}, 902), evidence({}, 903)] }));
      expect(both.mergeable).toBe(true);
      if (both.mergeable) expect(both.reviews.map((r) => r.commentId)).toEqual([902, 903]);
      // The security lens re-reviews and says ready: the stop is retracted.
      expect(
        evaluateMergeGate(input({ reviews: [stop, evidence({}, 901), security({}, 904)] }))
          .mergeable,
      ).toBe(true);
    });

    it('orders records by comment id itself, whatever the caller passed', () => {
      const ready = evidence({}, 902);
      const earlierStop = evidence({ verdict: 'needs-changes' }, 901);
      // Passed newest first: the gate still treats 902 as the latest word.
      expect(evaluateMergeGate(input({ reviews: [ready, earlierStop] })).mergeable).toBe(true);
      const laterStop = evidence({ verdict: 'needs-changes' }, 903);
      expect(codes({ reviews: [laterStop, ready] })).toEqual(['review-not-ready']);
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

  // Lesson L39: the pulls API base only moves on a push, so the gate compares
  // it with the live tip of main, and records cross a pure base update only.
  describe('base freshness and pure base updates', () => {
    const OLD_HEAD = 'd'.repeat(40);
    const TIP = 'e'.repeat(40);
    const OLDER_HEAD = 'f'.repeat(40);
    // The PR after `origin/main` (TIP) was merged into OLD_HEAD, giving SHA.
    const updated = (over: Partial<GateInput> = {}): Partial<GateInput> => ({
      pull: { ...pull, baseSha: TIP },
      baseTipSha: TIP,
      reviews: [evidence({ headSha: OLD_HEAD, baseSha: BASE })],
      baseUpdates: {
        hops: [{ head: SHA, reviewedHead: OLD_HEAD, base: TIP }],
        basesOnMain: [BASE],
        error: null,
      },
      ...over,
    });

    it('refuses when main moved after the PR was last pushed', () => {
      const decision = evaluateMergeGate(input({ baseTipSha: TIP }));
      expect(decision.mergeable).toBe(false);
      if (!decision.mergeable) {
        expect(decision.refusals.map((r) => r.code)).toEqual(['base-stale']);
        expect(decision.refusals[0]!.detail).toContain(TIP);
        expect(decision.refusals[0]!.detail).toContain('merge origin/main');
      }
    });

    it('accepts a PR whose base is the live tip', () => {
      expect(evaluateMergeGate(input()).mergeable).toBe(true);
    });

    it('carries a ready record across a verified pure base update', () => {
      const decision = evaluateMergeGate(input(updated()));
      expect(decision).toMatchObject({
        mergeable: true,
        reviews: [{ commentId: 900, carriedFrom: OLD_HEAD }],
      });
    });

    it('carries nothing when the merge was not proven pure (hand edit, conflict, extra commit)', () => {
      // base-update.ts lists no hop for such a head; the old record is stale.
      expect(
        codes(updated({ baseUpdates: { hops: [], basesOnMain: [BASE], error: null } })),
      ).toEqual(['review-for-other-head']);
    });

    it('carries nothing when the newest hop merged in something other than the live tip', () => {
      const hops = [{ head: SHA, reviewedHead: OLD_HEAD, base: OTHER }];
      expect(codes(updated({ baseUpdates: { hops, basesOnMain: [BASE], error: null } }))).toEqual([
        'review-for-other-head',
      ]);
    });

    it('ignores hops that do not start at the approved head', () => {
      const hops = [{ head: OTHER, reviewedHead: OLD_HEAD, base: TIP }];
      expect(codes(updated({ baseUpdates: { hops, basesOnMain: [BASE], error: null } }))).toEqual([
        'review-for-other-head',
      ]);
    });

    it('refuses when git could not verify the base updates', () => {
      expect(
        codes(updated({ baseUpdates: { hops: [], basesOnMain: [], error: 'git fetch failed' } })),
      ).toEqual(['base-update-unverified', 'review-for-other-head']);
      // Even with hops listed, an error carries nothing and refuses.
      const decision = evaluateMergeGate(
        input(updated({ baseUpdates: { ...updated().baseUpdates!, error: 'boom' } })),
      );
      expect(decision.mergeable).toBe(false);
    });

    it('carries a stop too, so merging main can never erase one', () => {
      const stop = evidence(
        {
          headSha: OLD_HEAD,
          lenses: ['security'],
          verdict: 'needs-changes',
          findings: [{ severity: 'major', file: 'lib/a.ts', line: 1, claim: 'x' }],
        },
        901,
      );
      // Another lens's ready record on the new head does not clear it.
      const freshReady = evidence({ baseSha: TIP }, 902);
      expect(
        codes(updated({ reviews: [evidence({ headSha: OLD_HEAD }), stop, freshReady] })),
      ).toEqual(['review-not-ready']);
      // The same lens re-reviewing the new head retracts it.
      const securityReady = evidence({ baseSha: TIP, lenses: ['security'] }, 903);
      expect(
        evaluateMergeGate(input(updated({ reviews: [stop, freshReady, securityReady] }))).mergeable,
      ).toBe(true);
    });

    it('follows a chain of pure updates and stops at the first broken link', () => {
      const older = evidence({ headSha: OLDER_HEAD }, 900);
      const chain = [
        { head: SHA, reviewedHead: OLD_HEAD, base: TIP },
        { head: OLD_HEAD, reviewedHead: OLDER_HEAD, base: BASE },
      ];
      expect(
        evaluateMergeGate(
          input(
            updated({
              reviews: [older],
              baseUpdates: { hops: chain, basesOnMain: [BASE], error: null },
            }),
          ),
        ).mergeable,
      ).toBe(true);
      const broken = [chain[0]!, { head: OTHER, reviewedHead: OLDER_HEAD, base: BASE }];
      expect(
        codes(
          updated({
            reviews: [older],
            baseUpdates: { hops: broken, basesOnMain: [BASE], error: null },
          }),
        ),
      ).toEqual(['review-for-other-head']);
    });

    it('never carries a ready record made on a base that is not on main (retargeted stack)', () => {
      // Reviewed while stacked on branch A (base = A's tip), then retargeted to
      // main and updated with a pure merge: A's own commits were never reviewed
      // against main, so the record must not carry.
      const A_TIP = '1'.repeat(40);
      const stacked = evidence({ headSha: OLD_HEAD, baseSha: A_TIP });
      expect(codes(updated({ reviews: [stacked] }))).toEqual(['review-for-other-base']);
      // The same record carries once git proves its base is on main.
      const proven = updated({
        reviews: [stacked],
        baseUpdates: { ...updated().baseUpdates!, basesOnMain: [A_TIP] },
      });
      expect(evaluateMergeGate(input(proven)).mergeable).toBe(true);
    });

    it('merges on a fresh record when an old record base was never fetched', () => {
      // git reports a base absent locally as not on main (basesOnMain omits it,
      // no error): the old record does not carry, the current one decides.
      const ABSENT = '1'.repeat(40);
      // Both records carry a correctness lens so lens routing's base rule is
      // met and the test isolates the carry decision.
      const lenses = ['security', 'correctness'];
      const old = evidence({ headSha: OLD_HEAD, baseSha: ABSENT, lenses }, 901);
      const fresh = evidence({ headSha: SHA, baseSha: TIP, lenses }, 902);
      expect(evaluateMergeGate(input(updated({ reviews: [old, fresh] }))).mergeable).toBe(true);
      // Alone, the old record on that base still does not carry.
      expect(codes(updated({ reviews: [old] }))).toEqual(['review-for-other-base']);
    });

    it('still carries a stop made on a base that is not on main', () => {
      const A_TIP = '1'.repeat(40);
      const stop = evidence(
        { headSha: OLD_HEAD, baseSha: A_TIP, lenses: ['security'], verdict: 'needs-changes' },
        901,
      );
      expect(codes(updated({ reviews: [evidence({ headSha: OLD_HEAD }), stop] }))).toEqual([
        'review-not-ready',
      ]);
    });

    it('still needs a record on the current base for the approved head itself', () => {
      // A record for the new head but an old base is not carried: only older
      // heads cross a hop.
      expect(codes(updated({ reviews: [evidence({ baseSha: BASE })] }))).toEqual([
        'review-for-other-base',
      ]);
    });
  });

  describe('review lens routing', () => {
    const lenses = (ls: string[], id: number, over: Partial<StructuredReview> = {}) =>
      evidence({ lenses: ls, ...over }, id);

    it('refuses when no ready record covers the base correctness-or-tests rule', () => {
      const decision = evaluateMergeGate(input({ reviews: [lenses(['security'], 900)] }));
      expect(decision.mergeable).toBe(false);
      if (!decision.mergeable) {
        expect(decision.refusals.map((r) => r.code)).toEqual(['review-lens-missing']);
        expect(decision.refusals[0]!.detail).toContain('rule base');
      }
      expect(evaluateMergeGate(input({ reviews: [lenses(['tests'], 900)] })).mergeable).toBe(true);
    });

    it('refuses an external group A PR whose records lack threat-model', () => {
      const over: Partial<GateInput> = {
        changedFiles: paths('lib/mcp/server.ts'),
        authorTier: 'unvetted',
        reviews: [lenses(['security'], 900), lenses(['correctness', 'tests'], 901)],
      };
      const decision = evaluateMergeGate(input(over));
      expect(decision.mergeable).toBe(false);
      if (!decision.mergeable) {
        expect(decision.refusals.map((r) => r.code)).toEqual(['review-lens-missing']);
        expect(decision.refusals[0]!.detail).toContain('group-a-threat-model');
        expect(decision.refusals[0]!.detail).toContain('lib/mcp/server.ts');
      }
    });

    it('accepts #513: an external es catalog with every required lens', () => {
      const decision = evaluateMergeGate(
        input({
          changedFiles: paths(
            'messages/es/common.ts',
            'i18n/config.ts',
            'components/history/x.tsx',
          ),
          authorTier: 'unvetted',
          reviews: [
            lenses(['security', 'threat-model'], 900),
            lenses(['tests', 'correctness'], 901),
            lenses(['translation-quality'], 902),
          ],
        }),
      );
      expect(decision).toMatchObject({ mergeable: true, advisories: [] });
    });

    it('refuses an external catalog without a translation review', () => {
      expect(
        codes({
          changedFiles: paths('messages/es/common.ts'),
          authorTier: 'vetted',
          reviews: [lenses(['security', 'threat-model'], 900), lenses(['correctness'], 901)],
        }),
      ).toEqual(['review-lens-missing']);
    });

    it('only advises a translation review on a maintainer catalog change', () => {
      const decision = evaluateMergeGate(
        input({
          changedFiles: paths('messages/es/common.ts'),
          reviews: [lenses(['security', 'threat-model', 'correctness'], 900)],
        }),
      );
      expect(decision.mergeable).toBe(true);
      if (decision.mergeable) expect(decision.advisories[0]).toContain('translation-quality');
    });

    it('accepts #512: a maintainer docs PR with docs-accuracy and correctness', () => {
      const files = ['CHANGELOG.md', 'docs/loops/lessons.md', '.claude/skills/ship-pr/SKILL.md'];
      expect(
        evaluateMergeGate(
          input({
            changedFiles: paths(...files),
            reviews: [lenses(['docs-accuracy', 'correctness'], 900)],
          }),
        ).mergeable,
      ).toBe(true);
      expect(
        codes({ changedFiles: paths(...files), reviews: [lenses(['correctness'], 900)] }),
      ).toEqual(['review-lens-missing']);
    });

    it('takes the union over reviewers and accepts past spellings of a lens', () => {
      expect(
        evaluateMergeGate(
          input({
            changedFiles: paths('lib/auth.ts'),
            authorTier: 'unvetted',
            reviews: [
              lenses(['Backdoor-Egress'], 900),
              lenses(['threat-model'], 901),
              lenses(['correctness'], 902),
            ],
          }),
        ).mergeable,
      ).toBe(true);
    });

    it('only advises the group A lenses on a maintainer PR', () => {
      // #515 (maintainer es wording, reviewed for translation and correctness)
      // and #474 (maintainer migration, reviewed by security without a
      // threat-model lens) merged under the charter, not the external policy.
      const decision = evaluateMergeGate(
        input({
          changedFiles: paths('messages/es/session.ts', 'prisma/migrations/1_x/migration.sql'),
          reviews: [lenses(['translation-quality', 'correctness'], 900)],
        }),
      );
      expect(decision.mergeable).toBe(true);
      if (decision.mergeable) {
        expect(decision.advisories.map((a) => a.split(':')[0])).toEqual([
          'group-a-security',
          'group-a-threat-model',
        ]);
      }
    });

    it.each(['vetted', 'unvetted'] as const)(
      'requires both group A lenses for a %s author',
      (authorTier) => {
        const decision = evaluateMergeGate(
          input({
            changedFiles: paths('prisma/schema.prisma'),
            authorTier,
            reviews: [lenses(['correctness'], 900)],
          }),
        );
        expect(decision.mergeable).toBe(false);
        if (!decision.mergeable) {
          expect(decision.refusals.map((r) => r.detail.split(' needs')[0])).toEqual([
            'rule group-a-security',
            'rule group-a-threat-model',
            'rule external-security',
          ]);
        }
      },
    );

    it('takes lenses only from the records that count for the approved head', () => {
      // A ready threat-model record of an older head (not carried) adds no lens.
      const stale = lenses(['threat-model'], 900, { headSha: OTHER });
      expect(
        codes({
          changedFiles: paths('lib/mcp/server.ts'),
          authorTier: 'unvetted',
          reviews: [stale, lenses(['correctness', 'security'], 901)],
        }),
      ).toEqual(['review-lens-missing']);
    });

    it('refuses when the changed files could not be read in full', () => {
      expect(codes({ changedFiles: { paths: null, error: 'fetch failed' } })).toEqual([
        'changed-files-unreadable',
      ]);
    });
  });
});
