import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildUsageRecords, parseTranscript, type RunTarget } from '@/automation/usage/build';
import { ledgerLineSchema, type LedgerLine } from '@/automation/ledger/schema';
import {
  countPrompts,
  hash16,
  hashRunBranches,
  ledgerToSessions,
  parseLedger,
} from '@/automation/ledger/attribute';

const require = createRequire(import.meta.url);
const hook = require('../hooks/record-usage.cjs') as {
  lineFor: (input: Record<string, unknown>, now?: string) => Record<string, unknown> | null;
  hash: (v: string) => string;
};

const BRANCH = 'feat/issue-7-thing';
const WT = '/repo/.claude/worktrees/agent-1';
const runs: RunTarget[] = [
  {
    runId: 'o/r#7@aaaaaaaaaaaa',
    prNumber: 7,
    headBranch: BRANCH,
    createdAt: '2026-10-13T09:00:00Z',
    closedAt: null,
  },
  {
    runId: 'o/r#8@bbbbbbbbbbbb',
    prNumber: 8,
    headBranch: 'fix/issue-8-other',
    createdAt: '2026-10-13T09:00:00Z',
    closedAt: null,
  },
];

function transcript(branch: string, model = 'claude-opus-5-5'): string[] {
  const rec = (id: string, input: number, output: number, at: string) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: at,
      cwd: WT,
      gitBranch: branch,
      message: {
        id,
        model,
        usage: {
          input_tokens: input,
          output_tokens: output,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 200,
          cache_creation: { ephemeral_5m_input_tokens: 150, ephemeral_1h_input_tokens: 50 },
        },
        content: [],
      },
    });
  return [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-10-13T10:00:00Z',
      cwd: WT,
      gitBranch: branch,
      message: { content: 'go' },
    }),
    rec('m1', 10, 100, '2026-10-13T10:00:01Z'),
    rec('m2', 20, 200, '2026-10-13T10:05:00Z'),
  ];
}

// The hook reads the transcript from disk: feed it a temp file.
function ledgerLine(lines: string[], agentId: string, at = '2026-10-13T10:06:00.000Z'): LedgerLine {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-attr-'));
  const f = join(dir, 'a.jsonl');
  writeFileSync(f, lines.join('\n'));
  const raw = hook.lineFor(
    {
      hook_event_name: 'SubagentStop',
      session_id: 'sess',
      agent_id: agentId,
      agent_type: 'general-purpose',
      agent_transcript_path: f,
      transcript_path: join(dir, 'missing.jsonl'),
    },
    at,
  );
  return ledgerLineSchema.parse(raw);
}

const noSkill = () => null;

describe('ledger attribution', () => {
  it('gives the same per-run usage as the transcript scan of #443', () => {
    const lines = transcript(BRANCH);
    const fromTranscript = buildUsageRecords({
      sessions: [parseTranscript('t', 'subagent', lines)],
      runs,
      skillVersionAt: noSkill,
    });
    const fromLedger = buildUsageRecords({
      sessions: ledgerToSessions([ledgerLine(lines, 'a1')]).sessions,
      runs: hashRunBranches(runs),
      skillVersionAt: noSkill,
    });
    const a = fromTranscript.records.find((r) => r.prNumber === 7)!;
    const b = fromLedger.records.find((r) => r.prNumber === 7)!;
    expect(b.tokens).toEqual(a.tokens);
    expect(b.estimatedCostUsd).toEqual(a.estimatedCostUsd);
    expect(b.estimatedCostUsd.status).toBe('known');
    expect(b.agentDuration).toEqual(a.agentDuration);
    expect(b.sessionsByRule['head-branch']).toBe(1);
    // Same response count on the side totals too.
    expect(fromLedger.subagentsAttributed).toBe(1);
  });

  it('keeps an agent on another branch unattributed, and run 8 unknown', () => {
    const result = buildUsageRecords({
      sessions: ledgerToSessions([ledgerLine(transcript('feat/elsewhere'), 'a2')]).sessions,
      runs: hashRunBranches(runs),
      skillVersionAt: noSkill,
    });
    expect(result.subagentsUnattributed).toBe(1);
    expect(result.records.every((r) => r.tokens.output.status === 'unknown')).toBe(true);
  });

  it('keeps the latest line for an agent that stopped twice', () => {
    const first = ledgerLine(transcript(BRANCH).slice(0, 2), 'a3', '2026-10-13T10:01:00.000Z');
    const second = ledgerLine(transcript(BRANCH), 'a3', '2026-10-13T10:06:00.000Z');
    // Whatever the order in the file, the line written later wins.
    for (const order of [
      [first, second],
      [second, first],
    ]) {
      const ledger = ledgerToSessions(order);
      expect(ledger.sessions).toHaveLength(1);
      expect(ledger.superseded).toBe(1);
      expect(ledger.sessions[0]!.responses.size).toBe(2);
    }
  });

  it('hashes branches the way the hook does', () => {
    expect(hash16(BRANCH)).toBe(hook.hash(BRANCH));
  });

  it('counts prompts per session and invalid ledger lines', () => {
    const text = [
      JSON.stringify({
        v: 1,
        kind: 'prompt',
        at: '2026-10-13T10:00:00.000Z',
        sessionKey: 'a'.repeat(16),
        source: 'other',
      }),
      JSON.stringify({
        v: 1,
        kind: 'prompt',
        at: '2026-10-13T10:01:00.000Z',
        sessionKey: 'a'.repeat(16),
        source: 'notification',
      }),
      JSON.stringify({
        v: 1,
        kind: 'prompt',
        at: '2026-10-13T10:02:00.000Z',
        sessionKey: 'b'.repeat(16),
        source: 'other',
      }),
      '{broken',
      JSON.stringify({ v: 2, kind: 'prompt' }),
    ].join('\n');
    const { lines, invalid } = parseLedger(text, (raw) => ledgerLineSchema.parse(raw));
    expect(invalid).toBe(2);
    expect(countPrompts(lines)).toEqual({ sessions: 2, other: 2, notifications: 1 });
  });
});
