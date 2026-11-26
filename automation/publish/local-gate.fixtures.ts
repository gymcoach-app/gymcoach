import type { LocalGateEvidence, MatchedRun, RunStep } from './local-gate';

// Synthetic ledger evidence for the gate tests: what local-gate-collect.ts
// would return after matching `verify` lines to heads.

export const LEDGER_PATH = '/home/test/.local/share/gymcoach-runs/ledger.jsonl';

const DEFAULT_STEPS = ['slot', 'prisma', 'lint', 'typecheck', 'unit', 'script-tests', 'build'];
const FULL_STEPS = [...DEFAULT_STEPS, 'infra-lock', 'test-db', 'integration', 'e2e'];

// Every step of the tier passed.
export function passedSteps(tier: 'default' | 'full'): RunStep[] {
  return (tier === 'full' ? FULL_STEPS : DEFAULT_STEPS).map((name) => ({
    name,
    outcome: 'passed',
  }));
}

// The steps of a run that failed at `failedAt`: the ones before it passed.
export function failedSteps(tier: 'default' | 'full', failedAt: string): RunStep[] {
  const names = tier === 'full' ? FULL_STEPS : DEFAULT_STEPS;
  const index = names.indexOf(failedAt);
  if (index < 0) throw new Error(`unknown step ${failedAt}`);
  return names
    .slice(0, index + 1)
    .map((name, i) => ({ name, outcome: i === index ? 'failed' : 'passed' }));
}

// A green full-tier run on the exact tree of `head`.
export function matchedRun(head: string, over: Partial<MatchedRun> = {}): MatchedRun {
  const tier = over.tier ?? 'full';
  return {
    line: 10,
    at: '2026-11-20T10:00:00.000Z',
    tier,
    exit: 0,
    steps: passedSteps(tier),
    headSha: head,
    treeSha: '7'.repeat(40),
    dirty: false,
    head,
    match: 'tree',
    ...over,
  };
}

export function redRun(head: string, over: Partial<MatchedRun> = {}): MatchedRun {
  const tier = over.tier ?? 'full';
  return matchedRun(head, {
    exit: 1,
    steps: failedSteps(tier, tier === 'full' ? 'e2e' : 'unit'),
    ...over,
  });
}

export function ledgerEvidence(
  runs: MatchedRun[],
  over: Partial<LocalGateEvidence> = {},
): LocalGateEvidence {
  return {
    ledger: { status: 'ok', path: LEDGER_PATH, verifyLines: runs.length, skippedLines: 0 },
    heads: [...new Set(runs.map((r) => r.head))].map((head) => ({ head, tree: '7'.repeat(40) })),
    runs,
    changedDuringRun: 0,
    treeAbsent: 0,
    error: null,
    ...over,
  };
}
