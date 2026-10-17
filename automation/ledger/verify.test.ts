import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ledgerLineSchema, type LedgerLine, type VerifyLine } from '@/automation/ledger/schema';
import { hash16, ledgerToSessions } from '@/automation/ledger/attribute';
import {
  localGateRecords,
  localGateRecordSchema,
  type GateRunTarget,
} from '@/automation/ledger/verify';

const require = createRequire(import.meta.url);
const recorder = require('./record-verify.cjs') as {
  parseSteps: (raw: string) => { name: string; outcome: string; ms: number }[];
  buildLine: (
    opts: Record<string, string>,
    state: {
      headSha: string | null;
      treeSha: string | null;
      dirty: boolean | null;
      branchHash: string | null;
    },
    env: Record<string, string | undefined>,
    nowIso: string,
  ) => Record<string, unknown>;
  hash: (v: string) => string;
  parseArgs: (argv: string[]) => Record<string, string>;
  parseStartTree: (raw: string | undefined) => string | null;
};

const sha = (c: string) => c.repeat(40);
const BRANCH = 'feat/issue-7-thing';
const state = { headSha: sha('a'), treeSha: sha('b'), dirty: true, branchHash: hash16(BRANCH) };

function line(over: Partial<VerifyLine> = {}): LedgerLine {
  return ledgerLineSchema.parse({
    v: 1,
    kind: 'verify',
    at: '2026-10-17T10:00:00.000Z',
    startedAt: '2026-10-17T09:58:00.000Z',
    sessionKey: hash16('s'),
    inClaudeCode: true,
    tier: 'default',
    exit: 0,
    steps: [{ name: 'lint', outcome: 'passed', ms: 1200 }],
    headSha: sha('a'),
    treeSha: sha('b'),
    dirty: true,
    branchHash: hash16(BRANCH),
    ...over,
  });
}

const run = (over: Partial<GateRunTarget> = {}): GateRunTarget => ({
  runId: 'o/r#7@aaaaaaaaaaaa',
  prNumber: 7,
  headBranch: hash16(BRANCH),
  headTreeSha: sha('c'),
  createdAt: '2026-10-17T11:00:00Z',
  closedAt: '2026-10-17T15:00:00Z',
  ...over,
});

describe('record-verify.cjs', () => {
  it('builds a line the ledger schema accepts, numbers and hashes only', () => {
    const raw = recorder.buildLine(
      {
        tier: 'full',
        exit: '1',
        started: '1760695200000',
        steps: 'slot|passed|5;lint|passed|1200;unit|failed|30000',
        'start-tree': sha('b'),
      },
      state,
      { CLAUDE_CODE_SESSION_ID: 'abc', CLAUDECODE: '1' },
      '2026-10-17T10:00:00.000Z',
    );
    const parsed = ledgerLineSchema.parse(raw);
    expect(parsed.kind).toBe('verify');
    expect(raw.sessionKey).toBe(hash16('abc'));
    expect(recorder.hash('abc')).toBe(hash16('abc'));
    expect(raw.startedAt).toBe('2025-10-17T10:00:00.000Z');
    expect(JSON.stringify(raw)).not.toContain(BRANCH);
    expect(raw.treeSha).toBe(sha('b'));
    expect(raw.treeChanged).toBe(false);
    expect(raw.steps).toEqual([
      { name: 'slot', outcome: 'passed', ms: 5 },
      { name: 'lint', outcome: 'passed', ms: 1200 },
      { name: 'unit', outcome: 'failed', ms: 30000 },
    ]);
  });

  it('refuses free text in the steps, the tier or the exit code', () => {
    expect(() => recorder.parseSteps('lint|passed|1;my secret|passed|1')).toThrow();
    expect(() => recorder.parseSteps('lint|ok|1')).toThrow();
    expect(() => recorder.parseSteps('lint|passed|-1')).toThrow();
    const good = { tier: 'default', exit: '0', started: '1', steps: '' };
    expect(() =>
      recorder.buildLine({ ...good, tier: 'x' }, state, {}, '2026-10-17T10:00:00.000Z'),
    ).toThrow();
    expect(() =>
      recorder.buildLine({ ...good, exit: '300' }, state, {}, '2026-10-17T10:00:00.000Z'),
    ).toThrow();
    expect(() =>
      recorder.buildLine({ ...good, exit: 'x' }, state, {}, '2026-10-17T10:00:00.000Z'),
    ).toThrow();
    expect(() => recorder.parseArgs(['--tier'])).toThrow();
  });

  it('keeps the tree only when the start and exit trees agree', () => {
    const opts = { tier: 'default', exit: '0', started: '1', steps: '' };
    const at = '2026-10-17T10:00:00.000Z';
    const changed = recorder.buildLine({ ...opts, 'start-tree': sha('9') }, state, {}, at);
    expect(changed).toMatchObject({ treeSha: null, treeChanged: true });
    const noStart = recorder.buildLine({ ...opts, 'start-tree': 'none' }, state, {}, at);
    expect(noStart).toMatchObject({ treeSha: null, treeChanged: null });
    const noEnd = recorder.buildLine(
      { ...opts, 'start-tree': sha('b') },
      { ...state, treeSha: null },
      {},
      at,
    );
    expect(noEnd).toMatchObject({ treeSha: null, treeChanged: null });
    expect(() => recorder.parseStartTree('not a sha')).toThrow();
    for (const raw of [changed, noStart, noEnd])
      expect(ledgerLineSchema.safeParse(raw).success).toBe(true);
  });

  it('records an unknown exit status as null, and accepts old lines without treeChanged', () => {
    const raw = recorder.buildLine(
      { tier: 'full', exit: 'none', started: '1', steps: 'build|interrupted|9' },
      state,
      {},
      '2026-10-17T10:00:00.000Z',
    );
    expect(raw.exit).toBeNull();
    expect(ledgerLineSchema.safeParse(raw).success).toBe(true);
    const old = { ...(line() as Record<string, unknown>) };
    delete old.treeChanged;
    expect(ledgerLineSchema.safeParse(old).success).toBe(true);
  });

  it('is outside Claude Code without a session id', () => {
    const raw = recorder.buildLine(
      { tier: 'default', exit: '0', started: 'x', steps: '' },
      state,
      {},
      '2026-10-17T10:00:00.000Z',
    );
    expect(raw.sessionKey).toBeNull();
    expect(raw.inClaudeCode).toBe(false);
    expect(raw.startedAt).toBeNull();
    expect(ledgerLineSchema.safeParse(raw).success).toBe(true);
  });

  it('does not disturb the usage attribution, which ignores verify lines', () => {
    expect(ledgerToSessions([line()]).sessions).toHaveLength(0);
  });
});

describe('local gate attribution', () => {
  it('counts gate runs by branch, finds the last green, and the final head', () => {
    const lines = [
      line({ at: '2026-10-17T10:00:00.000Z', exit: 1, treeSha: sha('d') }),
      line({ at: '2026-10-17T10:30:00.000Z', exit: 0, treeSha: sha('d') }),
      // A full run on the final head's tree, after a fixup commit.
      line({
        at: '2026-10-17T12:00:00.000Z',
        exit: 0,
        tier: 'full',
        treeSha: sha('c'),
        dirty: false,
      }),
    ];
    const r = localGateRecords(lines, [run()]);
    const rec = localGateRecordSchema.parse(r.records[0]);
    expect(rec.gateRuns).toEqual({ status: 'known', value: 3, unit: 'count' });
    expect(rec.greenGateRuns).toEqual({ status: 'known', value: 2, unit: 'count' });
    expect(rec.greenFullGateRuns).toEqual({ status: 'known', value: 1, unit: 'count' });
    expect(rec.lastGreen).toMatchObject({ status: 'known', tier: 'full', treeSha: sha('c') });
    expect(rec.finalHeadGreen).toEqual({ status: 'known', value: true, tier: 'full' });
    expect(r.attributed).toBe(3);
  });

  it('says the final head had no green gate when only another tree passed', () => {
    const r = localGateRecords([line({ exit: 0, treeSha: sha('d') })], [run()]);
    expect(r.records[0]!.finalHeadGreen).toEqual({ status: 'known', value: false, tier: null });
  });

  it('matches by tree when the branch differs (a gate on a detached checkout)', () => {
    const r = localGateRecords([line({ branchHash: null, treeSha: sha('c') })], [run()]);
    expect(r.records[0]!.gateRuns).toMatchObject({ value: 1 });
  });

  it('never reports a zero from absence: a run no gate line matches stays unknown', () => {
    // Recording is per checkout: this run's worktree may predate the recorder.
    const lines = [line({ branchHash: hash16('other'), treeSha: sha('e') })];
    const r = localGateRecords(lines, [run()]);
    expect(r.records[0]!.gateRuns.status).toBe('unknown');
    expect(r.records[0]!.lastGreen.status).toBe('unknown');
    expect(r.records[0]!.finalHeadGreen.status).toBe('unknown');
    expect(r.unattributed).toBe(1);
  });

  it('reports none when the matching gate runs were all red', () => {
    const r = localGateRecords([line({ exit: 1, treeSha: sha('d') })], [run()]);
    expect(r.records[0]!.gateRuns).toEqual({ status: 'known', value: 1, unit: 'count' });
    expect(r.records[0]!.lastGreen).toEqual({ status: 'none' });
    expect(r.records[0]!.finalHeadGreen).toEqual({ status: 'known', value: false, tier: null });
  });

  it('leaves the final head unknown, not false, when a matching green run recorded no tree', () => {
    const r = localGateRecords([line({ exit: 0, treeSha: null, treeChanged: true })], [run()]);
    expect(r.records[0]!.gateRuns).toMatchObject({ value: 1 });
    expect(r.records[0]!.finalHeadGreen.status).toBe('unknown');
  });

  it('does not count a reused branch name before an earlier run on it closed', () => {
    const first = run({
      runId: 'o/r#5@bbbbbbbbbbbb',
      prNumber: 5,
      headTreeSha: sha('5'),
      createdAt: '2026-10-16T08:00:00Z',
      closedAt: '2026-10-16T12:00:00Z',
    });
    const lines = [
      // Recording started before either run.
      line({ at: '2026-10-16T07:00:00.000Z', branchHash: hash16('other'), treeSha: sha('e') }),
      line({ at: '2026-10-16T09:00:00.000Z', treeSha: sha('d') }),
      line({ at: '2026-10-17T10:30:00.000Z', treeSha: sha('d') }),
    ];
    const r = localGateRecords(lines, [first, run()]);
    expect(r.ambiguous).toBe(0);
    expect(r.records.map((x) => x.gateRuns)).toEqual([
      { status: 'known', value: 1, unit: 'count' },
      { status: 'known', value: 1, unit: 'count' },
    ]);
  });

  it('keeps runs before the recording unknown, never 0', () => {
    const lines = [line({ at: '2026-10-17T10:00:00.000Z' })];
    const early = run({ createdAt: '2026-10-01T00:00:00Z', headBranch: hash16('old') });
    const r = localGateRecords(lines, [early]);
    expect(r.records[0]!.gateRuns.status).toBe('unknown');
    expect(r.records[0]!.finalHeadGreen.status).toBe('unknown');
    expect(r.recordingFrom).toBe('2026-10-17T10:00:00.000Z');
    const none = localGateRecords([], [run()]);
    expect(none.records[0]!.gateRuns.status).toBe('unknown');
  });

  it('ignores gate runs after the PR closed and leaves ambiguous ones out, as unknown', () => {
    const late = line({ at: '2026-10-17T16:00:00.000Z' });
    const twin = run({ runId: 'o/r#9@cccccccccccc', prNumber: 9 });
    const r = localGateRecords([line(), late], [run(), twin]);
    expect(r.ambiguous).toBe(1);
    expect(r.unattributed).toBe(1);
    expect(r.records.every((x) => x.gateRuns.status === 'unknown')).toBe(true);
    expect(r.records.every((x) => x.finalHeadGreen.status === 'unknown')).toBe(true);
  });

  it('proves the final head green by tree even when the gate run is ambiguous', () => {
    const onHead = line({ exit: 0, treeSha: sha('c'), branchHash: hash16('elsewhere') });
    const other = run({
      runId: 'o/r#9@cccccccccccc',
      prNumber: 9,
      headBranch: hash16('elsewhere'),
    });
    const r = localGateRecords([onHead], [run(), other]);
    expect(r.ambiguous).toBe(1);
    expect(r.records[0]!.finalHeadGreen).toEqual({ status: 'known', value: true, tier: 'default' });
  });

  it('leaves the final head unknown when its tree could not be read', () => {
    const r = localGateRecords([line()], [run({ headTreeSha: null })]);
    expect(r.records[0]!.finalHeadGreen.status).toBe('unknown');
    expect(r.records[0]!.gateRuns).toMatchObject({ value: 1 });
  });
});
