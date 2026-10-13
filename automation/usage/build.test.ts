import { describe, expect, it } from 'vitest';
import { type RawPullDetail, buildRunBundles } from '@/automation/baseline/build';
import { renderReport } from '@/automation/baseline/report';
import {
  type RunTarget,
  type SessionKind,
  attributeSession,
  buildUsageRecords,
  parseTranscript,
} from './build';
import { responseCostUsd } from './prices';
import { type UsageMeta, usageMetaSchema, usageRecordSchema } from './schema';

// Synthetic transcripts only: no real session content is used in tests.

interface Turn {
  id: string;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  write5m?: number;
  write1h?: number;
  at?: string;
  branch?: string;
  skill?: string;
  speed?: string;
}

function assistant(t: Turn): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: t.at ?? '2026-10-01T10:00:00.000Z',
    gitBranch: t.branch ?? 'main',
    message: {
      id: t.id,
      model: t.model ?? 'claude-opus-5-5',
      content: t.skill ? [{ type: 'tool_use', name: 'Skill', input: { skill: t.skill } }] : [],
      usage: {
        input_tokens: t.input ?? 0,
        output_tokens: t.output ?? 0,
        cache_read_input_tokens: t.cacheRead ?? 0,
        cache_creation_input_tokens: (t.write5m ?? 0) + (t.write1h ?? 0),
        cache_creation: {
          ephemeral_5m_input_tokens: t.write5m ?? 0,
          ephemeral_1h_input_tokens: t.write1h ?? 0,
        },
        ...(t.speed ? { speed: t.speed } : {}),
      },
    },
  });
}

function prompt(text: string, branch = 'main', at = '2026-10-01T09:59:00.000Z'): string {
  return JSON.stringify({
    type: 'user',
    timestamp: at,
    gitBranch: branch,
    message: { role: 'user', content: text },
  });
}

function session(id: string, kind: SessionKind, lines: string[]) {
  return parseTranscript(id, kind, lines);
}

const runs: RunTarget[] = [
  {
    runId: 'r/1',
    prNumber: 101,
    headBranch: 'feat/issue-1-thing',
    createdAt: '2026-10-01T09:00:00Z',
    closedAt: '2026-10-01T12:00:00Z',
  },
  {
    runId: 'r/2',
    prNumber: 102,
    headBranch: 'fix/issue-2-other',
    createdAt: '2026-10-01T09:00:00Z',
    closedAt: '2026-10-01T12:00:00Z',
  },
];

const noSkills = () => null;

describe('parseTranscript', () => {
  it('sums every token kind and counts a streamed response once, at its final usage', () => {
    const s = session('a', 'subagent', [
      prompt('Fix PR #101'),
      // The same response logged twice while streaming: keep the final one.
      assistant({ id: 'm1', input: 10, output: 1, cacheRead: 100, write5m: 20, write1h: 5 }),
      assistant({ id: 'm1', input: 10, output: 40, cacheRead: 100, write5m: 20, write1h: 5 }),
      assistant({ id: 'm2', input: 3, output: 7, cacheRead: 50, at: '2026-10-01T10:30:00.000Z' }),
      // A partial line logged after the final one does not replace it.
      assistant({ id: 'm2', input: 3, output: 2, cacheRead: 50, at: '2026-10-01T10:30:00.000Z' }),
    ]);
    const { records } = buildUsageRecords({ sessions: [s], runs, skillVersionAt: noSkills });
    const r = records.find((x) => x.prNumber === 101)!;
    expect(r.tokens).toEqual({
      input: { status: 'known', value: 13, unit: 'tokens' },
      output: { status: 'known', value: 47, unit: 'tokens' },
      cacheRead: { status: 'known', value: 150, unit: 'tokens' },
      cacheCreation5m: { status: 'known', value: 20, unit: 'tokens' },
      cacheCreation1h: { status: 'known', value: 5, unit: 'tokens' },
    });
    // From the prompt at 09:59 to the last response at 10:30.
    expect(r.agentDuration).toEqual({ status: 'known', value: 31 * 60, unit: 'seconds' });
    expect(usageRecordSchema.parse(r)).toEqual(r);
  });
});

describe('attribution', () => {
  it('attributes a subagent by its one head branch, and by a single PR reference', () => {
    const byBranch = session('b', 'subagent', [
      prompt('Implement issue 2', 'worktree-agent-abc123'),
      assistant({ id: 'x1', branch: 'fix/issue-2-other' }),
    ]);
    const byRef = session('c', 'subagent', [
      prompt('Review: git fetch origin pull/101/head:refs/pr/101'),
    ]);
    expect(attributeSession(byBranch, runs)).toEqual({
      status: 'attributed',
      prNumber: 102,
      rule: 'head-branch',
    });
    expect(attributeSession(byRef, runs)).toEqual({
      status: 'attributed',
      prNumber: 101,
      rule: 'pr-reference',
    });
  });

  it('leaves missing, ambiguous, conflicting or out-of-baseline evidence unattributed', () => {
    const none = session('d', 'subagent', [prompt('Survey the backlog')]);
    const two = session('e', 'subagent', [prompt('Compare PR #101 and PR #102')]);
    const conflict = session('f', 'subagent', [
      prompt('Review PR #101'),
      assistant({ id: 'y1', branch: 'fix/issue-2-other' }),
    ]);
    const outside = session('g', 'subagent', [prompt('Review PR #999')]);
    // Even on the PR's head branch, a main session is never attributed.
    const main = session('h', 'main', [
      prompt('Review PR #101'),
      assistant({ id: 'h1', branch: 'feat/issue-1-thing' }),
    ]);
    for (const s of [none, two, conflict, outside, main])
      expect(attributeSession(s, runs).status).toBe('unattributed');
  });

  it('attributes subagent usage to the run, never main-session usage, and never twice', () => {
    const sub = session('sub', 'subagent', [
      prompt('Fix PR #101'),
      assistant({ id: 's1', output: 5 }),
    ]);
    // A copy of the same response in another file (e.g. a fork that logged
    // its parent's turn) must not be counted again.
    const copy = session('copy', 'subagent', [
      prompt('Fix PR #102'),
      assistant({ id: 's1', output: 5 }),
    ]);
    const main = session('main', 'main', [
      prompt('orchestrate'),
      assistant({ id: 'o1', output: 1000 }),
      JSON.stringify({ type: 'pr-link', prNumber: 101, timestamp: '2026-10-01T10:00:00.000Z' }),
    ]);
    const result = buildUsageRecords({
      sessions: [sub, copy, main],
      runs,
      skillVersionAt: noSkills,
    });
    const r101 = result.records.find((r) => r.prNumber === 101)!;
    const r102 = result.records.find((r) => r.prNumber === 102)!;
    expect(r101.tokens.output).toEqual({ status: 'known', value: 5, unit: 'tokens' });
    expect(r101.orchestratorSessionsLinked).toEqual({ status: 'known', value: 1, unit: 'count' });
    // The copy is attributed to #102 but holds no response of its own.
    expect(r102.tokens.output).toEqual({ status: 'known', value: 0, unit: 'tokens' });
    expect(result.duplicateResponses).toBe(1);
    expect(result.orchestration.tokens.output).toBe(1000);
  });
});

describe('cost', () => {
  it('estimates cost from the price table, and keeps it unknown for an unpriced model', () => {
    expect(
      responseCostUsd({
        model: 'claude-opus-5-5',
        speed: 'standard',
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
        cacheCreation5m: 1_000_000,
        cacheCreation1h: 1_000_000,
      }),
    ).toBeCloseTo(4 + 20 + 0.2 + 5 + 8);
    const priced = session('p', 'subagent', [
      prompt('PR #101'),
      assistant({ id: 'p1', output: 1000 }),
    ]);
    const unpriced = session('q', 'subagent', [
      prompt('PR #102'),
      assistant({ id: 'q1', output: 1000, model: 'claude-future-9' }),
    ]);
    const fast = session('f', 'subagent', [
      prompt('PR #101'),
      assistant({ id: 'f1', output: 10, speed: 'fast' }),
    ]);
    const cost = (sessions: ReturnType<typeof session>[]) =>
      buildUsageRecords({ sessions, runs, skillVersionAt: noSkills }).records;
    const [r101, r102] = cost([priced, unpriced]);
    expect(r101!.estimatedCostUsd).toEqual({ status: 'known', value: 0.02, unit: 'usd' });
    // An unpriced model keeps the cost unknown while its tokens stay known.
    expect(r102!.estimatedCostUsd.status).toBe('unknown');
    expect(r102!.tokens.output).toEqual({ status: 'known', value: 1000, unit: 'tokens' });
    // So does a response served at a speed the table does not price.
    expect(cost([priced, fast])[0]!.estimatedCostUsd.status).toBe('unknown');
  });
});

describe('unknown runs', () => {
  it('keeps a run without an attributed session unknown, never 0, and says why', () => {
    const before = session('old', 'subagent', [
      prompt('PR #101', 'main', '2026-11-01T00:00:00.000Z'),
      assistant({ id: 'z1', output: 3, at: '2026-11-01T00:01:00.000Z' }),
    ]);
    const { records } = buildUsageRecords({ sessions: [before], runs, skillVersionAt: noSkills });
    const r102 = records.find((r) => r.prNumber === 102)!;
    expect(r102.tokens.output.status).toBe('unknown');
    expect(r102.estimatedCostUsd.status).toBe('unknown');
    expect(r102.subagentSessions.status).toBe('unknown');
    // #102 closed before the first retained transcript.
    expect(r102.tokens.output).toMatchObject({
      reason: 'no session transcript retained for this period',
    });
  });

  it('records a skill version only for a skill invoked through the Skill tool', () => {
    const s = session('w', 'subagent', [
      prompt('PR #101'),
      assistant({ id: 'k1', skill: 'write-up', at: '2026-10-01T10:00:00.000Z' }),
    ]);
    const { records } = buildUsageRecords({
      sessions: [s],
      runs,
      skillVersionAt: (skill) => `${skill}@0123456789ab`,
    });
    expect(records[0]!.skillVersion).toMatchObject({
      status: 'known',
      value: 'write-up@0123456789ab',
    });
    expect(records[1]!.skillVersion.status).toBe('unknown');
  });
});

describe('report', () => {
  const pull = (number: number, sha: string): RawPullDetail => ({
    pull: {
      number,
      user: { login: 'JulienAu' },
      title: 'feat: x',
      body: null,
      created_at: '2026-10-01T09:00:00Z',
      closed_at: '2026-10-01T12:00:00Z',
      merged_at: '2026-10-01T12:00:00Z',
      head: { sha: sha.repeat(40) },
      base: { sha: 'b'.repeat(40) },
      merge_commit_sha: 'c'.repeat(40),
    },
    commitMessages: ['feat: x'],
    commitShas: [sha.repeat(40)],
    workflowRuns: [],
    checkRuns: [],
    reviews: [],
    comments: [],
  });

  it('counts unknown usage as unknown in the table and never folds it into totals as 0', () => {
    const bundles = buildRunBundles({
      repo: 'o/r',
      now: '2026-10-02T00:00:00Z',
      windowDays: 14,
      maintainers: ['JulienAu'],
      vetted: [],
      pulls: [pull(101, 'a'), pull(102, 'd')],
      items: [],
      revertCommits: [],
    });
    const targets = bundles.map((b) => ({
      runId: b.run.runId,
      prNumber: b.run.prNumber,
      headBranch: null,
      createdAt: b.run.timestamps.createdAt,
      closedAt: b.run.timestamps.closedAt,
    }));
    const result = buildUsageRecords({
      sessions: [
        session('s', 'subagent', [prompt('PR #101'), assistant({ id: 'u1', output: 500 })]),
      ],
      runs: targets,
      skillVersionAt: noSkills,
    });
    const meta: UsageMeta = usageMetaSchema.parse({
      schemaVersion: 1,
      generatedAt: '2026-10-02T00:00:00.000Z',
      sourceCommit: 'e'.repeat(40),
      transcriptCoverage: result.coverage,
      sessionsScanned: { main: 0, subagent: 1 },
      subagentsAttributed: result.subagentsAttributed,
      subagentsUnattributed: result.subagentsUnattributed,
      duplicateResponses: result.duplicateResponses,
      orchestration: result.orchestration,
      unattributedSubagents: result.unattributedSubagents,
      priceTable: { checkedAt: '2026-10-13', source: 'test' },
    });
    const report = renderReport(
      bundles,
      { repo: 'o/r', collectedAt: 'now', sourceCommit: 'x', since: 'then', windowDays: 14 },
      { records: result.records, meta },
    );
    expect(report).toContain('| Output tokens | 1 of 2 | 1 of 2');
    expect(report).toContain('| Estimated cost (USD) | 1 of 2 | 1 of 2');
    expect(report).toContain('Runs with known usage: 1 of 2 (#101)');
    expect(report).toContain('over 1 runs with a known estimate');
    expect(report).toContain('Not extrapolated to the 1 runs whose cost is unknown');
  });
});
