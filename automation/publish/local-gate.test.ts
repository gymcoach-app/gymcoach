import { describe, expect, it } from 'vitest';
import {
  type LocalGateInput,
  type LocalGateRefusalCode,
  describeRun,
  evaluateLocalGate,
  isGreenRun,
  isLocalGateDocsPath,
  isRedRun,
  requiredTier,
} from './local-gate';
import {
  LEDGER_PATH,
  failedSteps,
  ledgerEvidence,
  matchedRun,
  passedSteps,
  redRun,
} from './local-gate.fixtures';

const HEAD = 'a'.repeat(40);
const OLD = 'd'.repeat(40);
const OTHER = 'b'.repeat(40);

function input(over: Partial<LocalGateInput> = {}): LocalGateInput {
  return {
    evidence: ledgerEvidence([matchedRun(HEAD)]),
    approvedSha: HEAD,
    carriedHeads: [],
    changedPaths: ['lib/a.ts'],
    authorTier: 'maintainer',
    ...over,
  };
}

function refusal(over: Partial<LocalGateInput>): { code: LocalGateRefusalCode; detail: string } {
  const result = evaluateLocalGate(input(over));
  if (result.ok) throw new Error('expected a refusal');
  return { code: result.code, detail: result.detail };
}

function accepted(over: Partial<LocalGateInput> = {}) {
  const result = evaluateLocalGate(input(over));
  if (!result.ok) throw new Error(`expected an accepted run, got ${result.code}: ${result.detail}`);
  if (result.report.required === 'none') throw new Error('expected a required run');
  return result.report;
}

describe('docs-only rule', () => {
  it('counts docs/ and Markdown outside the application directories', () => {
    for (const path of [
      'docs/loops/04-ship-loop.md',
      'docs/screenshots/home.png',
      'docs/loops/baseline/2026-10-13/records.jsonl',
      'README.md',
      'CLAUDE.md',
      'CHANGELOG.md',
      'changelog.d/596-gate.md',
      '.claude/skills/ship-pr/SKILL.md',
      '.github/ISSUE_TEMPLATE/bug.md',
      'automation/README.md',
      'evals/maintainer/README.md',
    ]) {
      expect(isLocalGateDocsPath(path), path).toBe(true);
    }
  });

  it('never counts code, configuration, or Markdown where the app is built or served from', () => {
    for (const path of [
      'lib/a.ts',
      'automation/publish/gate.ts',
      'scripts/verify.sh',
      'package.json',
      '.github/workflows/ci.yml',
      '.claude/settings.json',
      'LICENSE',
      'lib/prompts/coach.md',
      'app/help/page.md',
      'public/exercise-media/free-exercise-db/README.md',
      'prisma/README.md',
      'messages/en/README.md',
      'tests/README.md',
      'new-directory/notes.md',
      'documentation/x.md',
    ]) {
      expect(isLocalGateDocsPath(path), path).toBe(false);
    }
  });

  it('asks for the default tier only when every path is documentation', () => {
    expect(requiredTier(['README.md', 'docs/faq.md'])).toBe('default');
    expect(requiredTier(['README.md', 'lib/a.ts'])).toBe('full');
    // A rename out of a code directory lists the old path too (changed-paths.ts).
    expect(requiredTier(['docs/a.md', 'lib/a.md'])).toBe('full');
  });

  it('asks for the full tier when the paths are unknown or the diff is empty', () => {
    expect(requiredTier(null)).toBe('full');
    expect(requiredTier([])).toBe('full');
  });
});

describe('which runs are verdicts', () => {
  it('takes a run as green only with exit 0, every step passed and none missing', () => {
    expect(isGreenRun(matchedRun(HEAD))).toBe(true);
    expect(isGreenRun(matchedRun(HEAD, { tier: 'default' }))).toBe(true);
    expect(isGreenRun(matchedRun(HEAD, { exit: 1 }))).toBe(false);
    expect(isGreenRun(matchedRun(HEAD, { exit: null }))).toBe(false);
    // Exit 0 claimed by a full-tier line that never reached E2E.
    expect(isGreenRun(matchedRun(HEAD, { steps: passedSteps('default') }))).toBe(false);
    expect(
      isGreenRun(
        matchedRun(HEAD, {
          steps: passedSteps('full').map((s) =>
            s.name === 'integration' ? { ...s, outcome: 'interrupted' } : s,
          ),
        }),
      ),
    ).toBe(false);
  });

  it('takes a run as red only when a step other than a lock wait failed', () => {
    expect(isRedRun(redRun(HEAD))).toBe(true);
    expect(isRedRun(redRun(HEAD, { tier: 'default' }))).toBe(true);
    expect(isRedRun(matchedRun(HEAD))).toBe(false);
    // No free heavy-work slot, or the test-infra lock timed out: no code ran.
    expect(isRedRun(redRun(HEAD, { steps: failedSteps('full', 'slot') }))).toBe(false);
    expect(isRedRun(redRun(HEAD, { steps: failedSteps('full', 'infra-lock') }))).toBe(false);
    // The test database bootstrap applies the change's migrations: a verdict.
    expect(isRedRun(redRun(HEAD, { steps: failedSteps('full', 'test-db') }))).toBe(true);
    // Killed: no exit code, or a signal status with the step left open.
    expect(isRedRun(matchedRun(HEAD, { exit: null }))).toBe(false);
    expect(
      isRedRun(
        matchedRun(HEAD, { exit: 130, steps: [{ name: 'lint', outcome: 'interrupted' }] }),
      ),
    ).toBe(false);
  });
});

describe('local green gate', () => {
  it('accepts a green full run on the approved head and names the ledger line', () => {
    const report = accepted();
    expect(report).toMatchObject({
      required: 'full',
      ledgerPath: LEDGER_PATH,
      accepted: { line: 10, tier: 'full', exit: 0, head: HEAD, match: 'tree' },
    });
    expect(describeRun(report.accepted)).toBe(
      `line 10 (verify, tier full, exit 0, at 2026-11-20T10:00:00.000Z, HEAD ${HEAD.slice(0, 12)}, tree 777777777777, checked the content of ${HEAD.slice(0, 12)}: the same tree)`,
    );
  });

  it('accepts a run made before the commit: the tree decides, not HEAD', () => {
    const report = accepted({
      evidence: ledgerEvidence([matchedRun(HEAD, { headSha: OTHER, dirty: true })]),
    });
    expect(report.accepted.headSha).toBe(OTHER);
  });

  it('accepts a dirty run git proved to differ by the node_modules symlink only', () => {
    const run = matchedRun(HEAD, { dirty: true, match: 'tree-plus-node-modules-symlink' });
    const report = accepted({ evidence: ledgerEvidence([run]) });
    expect(describeRun(report.accepted)).toContain(
      'the same tree plus an untracked node_modules symlink',
    );
  });

  it('refuses when the ledger holds no run on that content', () => {
    const { code, detail } = refusal({
      evidence: ledgerEvidence([], {
        ledger: { status: 'ok', path: LEDGER_PATH, verifyLines: 180, skippedLines: 0 },
      }),
    });
    expect(code).toBe('local-gate-missing');
    expect(detail).toContain(LEDGER_PATH);
    expect(detail).toContain('180 verify line(s)');
    expect(detail).toContain(HEAD.slice(0, 12));
    expect(detail).toContain('bash scripts/verify.sh --full');
    expect(detail).toContain('no flag waives this');
  });

  it('ignores a run the collector matched to a head that is not accepted', () => {
    expect(refusal({ evidence: ledgerEvidence([matchedRun(OTHER)]) }).code).toBe(
      'local-gate-missing',
    );
  });

  it('refuses a green default-tier run when the diff changes code, and says so', () => {
    const { code, detail } = refusal({
      evidence: ledgerEvidence([matchedRun(HEAD, { tier: 'default', line: 4 })]),
    });
    expect(code).toBe('local-gate-missing');
    expect(detail).toContain('ledger line 4 is a green default-tier run');
  });

  it('refuses when the only runs on that content failed (#587)', () => {
    const reds = [1, 2, 3, 4, 5, 6].map((line) =>
      redRun(HEAD, { line, at: `2026-11-18T15:${10 + line}:00.000Z` }),
    );
    const { code, detail } = refusal({ evidence: ledgerEvidence(reds) });
    expect(code).toBe('local-gate-missing');
    expect(detail).toContain('6 failed run(s) on that content (line 1, 2, 3, 4, 5, 6)');
  });

  it('refuses a full-tier line with exit 0 whose steps stop before E2E', () => {
    expect(
      refusal({ evidence: ledgerEvidence([matchedRun(HEAD, { steps: passedSteps('default') })]) })
        .code,
    ).toBe('local-gate-missing');
  });

  it('never counts a killed run as green', () => {
    expect(refusal({ evidence: ledgerEvidence([matchedRun(HEAD, { exit: null })]) }).code).toBe(
      'local-gate-missing',
    );
  });

  it('names the near misses the collector counted', () => {
    const { detail } = refusal({
      evidence: ledgerEvidence([], { changedDuringRun: 2, treeAbsent: 1 }),
    });
    expect(detail).toContain('2 run(s) started at one of these commits had files change');
    expect(detail).toContain('1 run(s) at one of these commits checked a dirty tree');
  });

  describe('a red run and a green run on the same content', () => {
    const green = matchedRun(HEAD, { line: 10, at: '2026-11-20T10:00:00.000Z' });

    it('accepts a green run that came after the red one (the fix round reran the gate)', () => {
      const red = redRun(HEAD, { line: 9, at: '2026-11-20T09:00:00.000Z' });
      expect(accepted({ evidence: ledgerEvidence([red, green]) }).accepted.line).toBe(10);
    });

    it('refuses a red run newer than the green one: the latest verdict decides', () => {
      const red = redRun(HEAD, { line: 11, at: '2026-11-20T11:00:00.000Z' });
      const { code, detail } = refusal({ evidence: ledgerEvidence([green, red]) });
      expect(code).toBe('local-gate-red');
      expect(detail).toContain('ledger line 10 (verify, tier full, exit 0');
      expect(detail).toContain('line 11 (verify, tier full, exit 1, failed at e2e');
      expect(detail).toContain('failed after it');
      expect(detail).toContain('lesson L61');
    });

    it('accepts again once a later run is green', () => {
      const red = redRun(HEAD, { line: 11, at: '2026-11-20T11:00:00.000Z' });
      const again = matchedRun(HEAD, { line: 12, at: '2026-11-20T12:00:00.000Z' });
      expect(accepted({ evidence: ledgerEvidence([green, red, again]) }).accepted.line).toBe(12);
    });

    it('lets a newer red default-tier run override a green full one (same content, a tier it contains)', () => {
      const red = redRun(HEAD, { tier: 'default', line: 11, at: '2026-11-20T11:00:00.000Z' });
      expect(refusal({ evidence: ledgerEvidence([green, red]) }).code).toBe('local-gate-red');
    });

    it('never lets a newer green default-tier run clear a red full one', () => {
      const red = redRun(HEAD, { line: 11, at: '2026-11-20T11:00:00.000Z' });
      const lower = matchedRun(HEAD, {
        tier: 'default',
        line: 12,
        at: '2026-11-20T12:00:00.000Z',
      });
      expect(refusal({ evidence: ledgerEvidence([green, red, lower]) }).code).toBe(
        'local-gate-red',
      );
    });

    it('orders two lines of the same instant by their place in the ledger', () => {
      const red = redRun(HEAD, { line: 11, at: green.at });
      expect(refusal({ evidence: ledgerEvidence([green, red]) }).code).toBe('local-gate-red');
      const before = redRun(HEAD, { line: 9, at: green.at });
      expect(accepted({ evidence: ledgerEvidence([before, green]) }).accepted.line).toBe(10);
    });

    it('ignores a newer run that only failed waiting for a lock, or was killed', () => {
      const slot = redRun(HEAD, {
        line: 11,
        at: '2026-11-20T11:00:00.000Z',
        steps: failedSteps('full', 'slot'),
      });
      const killed = matchedRun(HEAD, {
        line: 12,
        at: '2026-11-20T12:00:00.000Z',
        exit: null,
        steps: [{ name: 'e2e', outcome: 'interrupted' }],
      });
      expect(accepted({ evidence: ledgerEvidence([green, slot, killed]) }).accepted.line).toBe(10);
    });
  });

  describe('heads the review records are carried from', () => {
    it('accepts a green run on a carried head', () => {
      const report = accepted({
        evidence: ledgerEvidence([matchedRun(OLD)]),
        carriedHeads: [OLD],
      });
      expect(report.accepted.head).toBe(OLD);
    });

    it('refuses the same run when that head is not carried', () => {
      const { code, detail } = refusal({ evidence: ledgerEvidence([matchedRun(OLD)]) });
      expect(code).toBe('local-gate-missing');
      expect(detail).not.toContain(OLD.slice(0, 12));
    });

    it('names the carried heads in a refusal', () => {
      const { detail } = refusal({ evidence: ledgerEvidence([]), carriedHeads: [OLD] });
      expect(detail).toContain(`carried from [${OLD.slice(0, 12)}]`);
    });

    it('prefers the newest green run, whichever head it is on', () => {
      const older = matchedRun(OLD, { line: 3, at: '2026-11-19T10:00:00.000Z' });
      const newer = matchedRun(HEAD, { line: 8, at: '2026-11-20T10:00:00.000Z' });
      expect(
        accepted({ evidence: ledgerEvidence([older, newer]), carriedHeads: [OLD] }).accepted.line,
      ).toBe(8);
    });

    it('lets a red run on the approved head override a green run on a carried head, whatever their times', () => {
      // The old head was gated again after the merge of main was found red.
      const red = redRun(HEAD, { line: 5, at: '2026-11-20T09:00:00.000Z' });
      const green = matchedRun(OLD, { line: 6, at: '2026-11-20T10:00:00.000Z' });
      const { code, detail } = refusal({
        evidence: ledgerEvidence([red, green]),
        carriedHeads: [OLD],
      });
      expect(code).toBe('local-gate-red');
      expect(detail).toContain('on the approved head itself');
    });

    it('accepts a green run on the approved head after a red one on a carried head', () => {
      const red = redRun(OLD, { line: 5, at: '2026-11-20T09:00:00.000Z' });
      const green = matchedRun(HEAD, { line: 6, at: '2026-11-20T10:00:00.000Z' });
      expect(
        accepted({ evidence: ledgerEvidence([red, green]), carriedHeads: [OLD] }).accepted.line,
      ).toBe(6);
    });

    it('refuses a green run on the approved head when a carried head failed after it', () => {
      const green = matchedRun(HEAD, { line: 5, at: '2026-11-20T09:00:00.000Z' });
      const red = redRun(OLD, { line: 6, at: '2026-11-20T10:00:00.000Z' });
      expect(
        refusal({ evidence: ledgerEvidence([green, red]), carriedHeads: [OLD] }).code,
      ).toBe('local-gate-red');
    });
  });

  describe('docs-only diffs', () => {
    const docs = { changedPaths: ['README.md', 'docs/loops/04-ship-loop.md'] };

    it('accepts a green default-tier run', () => {
      const report = accepted({
        ...docs,
        evidence: ledgerEvidence([matchedRun(HEAD, { tier: 'default' })]),
      });
      expect(report.required).toBe('default');
      expect(report.reason).toContain('docs-only');
    });

    it('accepts a green full run too', () => {
      expect(accepted(docs).accepted.tier).toBe('full');
    });

    it('still refuses with no run at all, and asks for the default tier', () => {
      const { code, detail } = refusal({ ...docs, evidence: ledgerEvidence([]) });
      expect(code).toBe('local-gate-missing');
      expect(detail).toContain('`bash scripts/verify.sh`');
      expect(detail).not.toContain('--full');
    });

    it('still refuses a newer red run', () => {
      const green = matchedRun(HEAD, { tier: 'default', line: 1 });
      const red = redRun(HEAD, { tier: 'default', line: 2, at: '2026-11-20T11:00:00.000Z' });
      expect(refusal({ ...docs, evidence: ledgerEvidence([green, red]) }).code).toBe(
        'local-gate-red',
      );
    });

    it('needs the full tier as soon as one path is not documentation', () => {
      expect(
        refusal({
          changedPaths: ['README.md', 'lib/a.ts'],
          evidence: ledgerEvidence([matchedRun(HEAD, { tier: 'default' })]),
        }).code,
      ).toBe('local-gate-missing');
    });

    it('needs the full tier when the changed paths could not be read', () => {
      expect(
        refusal({
          changedPaths: null,
          evidence: ledgerEvidence([matchedRun(HEAD, { tier: 'default' })]),
        }).code,
      ).toBe('local-gate-missing');
      expect(accepted({ changedPaths: null }).reason).toContain('could not be read');
    });
  });

  describe('ledger disabled, missing or unreadable', () => {
    const none = { heads: [], runs: [], changedDuringRun: 0, treeAbsent: 0, error: null };

    it('refuses when the ledger is switched off, and says how to proceed', () => {
      const { code, detail } = refusal({ evidence: { ledger: { status: 'disabled' }, ...none } });
      expect(code).toBe('local-gate-ledger-disabled');
      expect(detail).toContain('GYMCOACH_USAGE_LEDGER=off');
      expect(detail).toContain('unset it');
      expect(detail).toContain('bash scripts/verify.sh --full');
    });

    it('refuses when there is no ledger file, and names the path and its sources', () => {
      const { code, detail } = refusal({
        evidence: { ledger: { status: 'missing', path: LEDGER_PATH }, ...none },
      });
      expect(code).toBe('local-gate-ledger-missing');
      expect(detail).toContain(LEDGER_PATH);
      expect(detail).toContain('XDG_DATA_HOME');
      expect(detail).toContain('GYMCOACH_USAGE_LEDGER_PATH');
    });

    it('refuses when the ledger cannot be read', () => {
      const { code, detail } = refusal({
        evidence: {
          ledger: { status: 'unreadable', path: LEDGER_PATH, error: 'EACCES' },
          ...none,
        },
      });
      expect(code).toBe('local-gate-ledger-unreadable');
      expect(detail).toContain('EACCES');
    });

    it('refuses when git could not compare the trees', () => {
      const { code, detail } = refusal({
        evidence: ledgerEvidence([matchedRun(HEAD)], { error: 'git rev-parse: bad object' }),
      });
      expect(code).toBe('local-gate-unverified');
      expect(detail).toContain('bad object');
    });
  });

  describe('external authors', () => {
    const none = { heads: [], runs: [], changedDuringRun: 0, treeAbsent: 0, error: null };

    it.each(['vetted', 'unvetted'] as const)(
      'requires no local run of a %s author, and says why',
      (authorTier) => {
        const result = evaluateLocalGate(
          input({ authorTier, evidence: { ledger: { status: 'disabled' }, ...none } }),
        );
        expect(result).toMatchObject({ ok: true, report: { required: 'none' } });
        if (result.ok) expect(result.report.reason).toContain('CI is its only executor');
      },
    );
  });
});
