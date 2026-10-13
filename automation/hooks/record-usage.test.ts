import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseTranscript } from '@/automation/usage/build';
import { ledgerLineSchema } from '@/automation/ledger/schema';

const require = createRequire(import.meta.url);
const hook = require('./record-usage.cjs') as {
  settled: (previousSize: number, size: number, responses: number) => boolean;
  summarize: (
    lines: string[],
    kind: 'main' | 'subagent',
    exclude: Set<string> | null,
  ) => {
    responses: Map<string, Record<string, number | string | null>>;
    branches: Set<string>;
    pullRefs: Set<number>;
    prRefs: Set<number>;
    skills: Set<string>;
    dropped: number;
    inherited: number;
    firstAt: string | null;
    lastAt: string | null;
  };
  lineFor: (input: Record<string, unknown>, now?: string) => Record<string, unknown> | null;
  promptSource: (prompt: unknown) => string;
  hash: (v: string) => string;
};

const SCRIPT = join(__dirname, 'record-usage.cjs');
const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'record-usage-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const WT = '/repo/.claude/worktrees/agent-abc';
const BRANCH = 'feat/issue-9-secret-name';
const PROMPT_TEXT = 'Review PR #42 carefully, the private note says hunter2';

function assistant(
  id: string,
  usage: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  model = 'claude-opus-5-5',
) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-13T10:00:05.000Z',
    cwd: WT,
    gitBranch: BRANCH,
    version: '2.1.296',
    message: { id, model, usage, content: [] },
    ...extra,
  });
}

const usage = (input: number, output: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 30,
  cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 0 },
});

function subagentTranscript(): string[] {
  return [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-10-13T10:00:00.000Z',
      cwd: WT,
      gitBranch: BRANCH,
      message: { content: PROMPT_TEXT },
    }),
    // Streamed twice: the final block wins.
    assistant('msg_1', usage(10, 5)),
    assistant('msg_1', usage(10, 50)),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-10-13T10:00:07.000Z',
      cwd: WT,
      gitBranch: BRANCH,
      message: {
        id: 'msg_2',
        model: 'claude-opus-5-5',
        usage: usage(3, 7),
        content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'ship-pr' } }],
      },
    }),
    // A response without usage is dropped and counted.
    JSON.stringify({ type: 'assistant', message: { id: 'msg_x', content: [] } }),
    // A model id outside the allowlist becomes "other".
    assistant('msg_3', usage(1, 1), {}, 'gpt-something'),
  ];
}

describe('record-usage summarize (parity with automation/usage/build.ts)', () => {
  it('counts the same responses, tokens, skills, branches and refs as parseTranscript', () => {
    const lines = subagentTranscript();
    const cjs = hook.summarize(lines, 'subagent', null);
    const ts = parseTranscript('s', 'subagent', lines);
    expect(cjs.responses.size).toBe(ts.responses.size);
    for (const [id, t] of ts.responses) expect(cjs.responses.get(id)).toEqual(t);
    expect([...cjs.skills]).toEqual([...ts.skills]);
    expect([...cjs.branches]).toEqual([...ts.branches]);
    expect([...cjs.prRefs]).toEqual([...ts.prRefs]);
    expect(cjs.dropped).toBe(ts.droppedResponses);
    expect(cjs.firstAt).toBe(ts.firstAt);
    expect(cjs.lastAt).toBe(ts.lastAt);
  });

  it('keeps an unrecorded count unknown, never 0', () => {
    const lines = [
      assistant('msg_u', {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 9,
      }),
    ];
    const t = hook.summarize(lines, 'subagent', null).responses.get('msg_u')!;
    expect(Number.isNaN(t.cacheCreation5m)).toBe(true);
    expect(parseTranscript('s', 'subagent', lines).responses.get('msg_u')).toEqual(t);
  });

  it('leaves out responses copied from the parent and counts them', () => {
    const s = hook.summarize(subagentTranscript(), 'subagent', new Set(['msg_1']));
    expect(s.responses.has('msg_1')).toBe(false);
    expect(s.inherited).toBe(1);
  });
});

function run(input: unknown, env: Record<string, string> = {}) {
  const ledger = join(tmp(), 'ledger.jsonl');
  const res = spawnSync(process.execPath, [SCRIPT], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, GYMCOACH_USAGE_LEDGER_PATH: ledger, GYMCOACH_USAGE_LEDGER: '', ...env },
    encoding: 'utf8',
  });
  const lines = existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean) : [];
  return { status: res.status, stdout: res.stdout, lines };
}

function transcriptFile(lines: string[]): string {
  const f = join(tmp(), 'agent.jsonl');
  writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

const SESSION_ID = '5f0e9a52-1111-2222-3333-444455556666';

describe('record-usage hook process', () => {
  it('waits for a subagent transcript that is written after SubagentStop fires', async () => {
    // Claude Code 2.1.296 writes the subagent's last records ~40 ms after the
    // hook starts; the hook must not record zero responses for it.
    const all = subagentTranscript();
    const firstAssistant = all.findIndex((l) => l.includes('"assistant"'));
    const f = transcriptFile(all.slice(0, firstAssistant));
    const ledger = join(tmp(), 'ledger.jsonl');
    const child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, GYMCOACH_USAGE_LEDGER_PATH: ledger, GYMCOACH_USAGE_LEDGER: '' },
    });
    child.stdin.end(
      JSON.stringify({
        hook_event_name: 'SubagentStop',
        session_id: SESSION_ID,
        agent_id: 'late1',
        agent_type: 'general-purpose',
        agent_transcript_path: f,
        transcript_path: '/nonexistent/parent.jsonl',
        cwd: WT,
      }),
    );
    await new Promise((r) => setTimeout(r, 300));
    appendFileSync(f, all.slice(firstAssistant).join('\n') + '\n');
    const code = await new Promise<number | null>((r) => child.on('exit', r));
    expect(code).toBe(0);
    const line = JSON.parse(readFileSync(ledger, 'utf8').trim());
    expect(line.responses).toBe(3);
  });

  it('waits for the last response of a multi-turn subagent written after SubagentStop', async () => {
    // A first read already sees a response, but more records land later: the
    // hook must wait until the transcript stops growing, not only when it is empty.
    const all = subagentTranscript();
    const assistants = all
      .map((l, i) => (l.includes('"assistant"') ? i : -1))
      .filter((i) => i >= 0);
    const cut = assistants[1]!;
    const f = transcriptFile(all.slice(0, cut));
    const ledger = join(tmp(), 'ledger.jsonl');
    const child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, GYMCOACH_USAGE_LEDGER_PATH: ledger, GYMCOACH_USAGE_LEDGER: '' },
    });
    child.stdin.end(
      JSON.stringify({
        hook_event_name: 'SubagentStop',
        session_id: SESSION_ID,
        agent_id: 'late2',
        agent_type: 'general-purpose',
        agent_transcript_path: f,
        transcript_path: '/nonexistent/parent.jsonl',
        cwd: WT,
      }),
    );
    await new Promise((r) => setTimeout(r, 60));
    appendFileSync(f, all.slice(cut).join('\n') + '\n');
    const code = await new Promise<number | null>((r) => child.on('exit', r));
    expect(code).toBe(0);
    const line = JSON.parse(readFileSync(ledger, 'utf8').trim());
    expect(line.responses).toBe(3);
  });

  it('settles only after two equal sizes with at least one response', () => {
    expect(hook.settled(-1, 100, 3)).toBe(false);
    expect(hook.settled(80, 100, 3)).toBe(false);
    expect(hook.settled(100, 100, 0)).toBe(false);
    expect(hook.settled(100, 100, 1)).toBe(true);
  });

  it('appends exactly one schema-valid agent line on SubagentStop, with no text or path', () => {
    const r = run({
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      agent_id: 'a1b2c3d4e5f6a7b8c',
      agent_type: 'general-purpose',
      agent_transcript_path: transcriptFile(subagentTranscript()),
      transcript_path: '/nonexistent/parent.jsonl',
      cwd: WT,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.lines).toHaveLength(1);
    const line = ledgerLineSchema.parse(JSON.parse(r.lines[0]!));
    expect(line.kind).toBe('agent');
    if (line.kind !== 'agent') return;
    expect(line.responses).toBe(3);
    expect(line.droppedResponses).toBe(1);
    expect(line.branchHashes).toEqual([hook.hash(BRANCH)]);
    expect(line.prRefs).toEqual([42]);
    expect(line.skills).toEqual(['ship-pr']);
    expect(line.inheritedResponses).toBe(0);
    const opus = line.byModel.find((g) => g.model === 'claude-opus-5-5')!;
    expect(opus).toMatchObject({ responses: 2, input: 13, output: 57, cacheRead: 200 });
    expect(line.byModel.map((g) => g.model)).toContain('other');
    // Privacy: no prompt text, branch name, raw session id or path.
    for (const secret of ['hunter2', 'Review PR', BRANCH, SESSION_ID, '/repo', '.jsonl'])
      expect(r.lines[0]).not.toContain(secret);
  });

  it('marks a fork whose parent transcript cannot be read', () => {
    const lines = [JSON.stringify({ type: 'fork-context-ref' }), ...subagentTranscript()];
    const r = run({
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      agent_id: 'f0f0',
      agent_type: 'fork',
      agent_transcript_path: transcriptFile(lines),
      transcript_path: '/nonexistent/parent.jsonl',
    });
    expect(JSON.parse(r.lines[0]!).inheritedResponses).toBeNull();
  });

  it('excludes the turn a fork copied from a readable parent', () => {
    const parent = join(tmp(), 'parent.jsonl');
    writeFileSync(parent, assistant('msg_1', usage(10, 50)) + '\n');
    const lines = [JSON.stringify({ type: 'fork-context-ref' }), ...subagentTranscript()];
    const r = run({
      hook_event_name: 'SubagentStop',
      session_id: SESSION_ID,
      agent_id: 'f0f1',
      agent_type: 'fork',
      agent_transcript_path: transcriptFile(lines),
      transcript_path: parent,
    });
    const line = JSON.parse(r.lines[0]!);
    expect(line.inheritedResponses).toBe(1);
    expect(line.responses).toBe(2);
  });

  it('records a prompt line without its text, telling notifications apart', () => {
    const op = run({
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      prompt: 'secret plan',
    });
    expect(op.stdout).toBe('');
    expect(JSON.parse(op.lines[0]!)).toMatchObject({ kind: 'prompt', source: 'other' });
    expect(op.lines[0]).not.toContain('secret');
    const note = run({
      hook_event_name: 'UserPromptSubmit',
      session_id: SESSION_ID,
      prompt: '<task-notification>\n<task-id>x</task-id>',
    });
    expect(JSON.parse(note.lines[0]!).source).toBe('notification');
  });

  it('writes a session line on SessionEnd', () => {
    const r = run({
      hook_event_name: 'SessionEnd',
      session_id: SESSION_ID,
      transcript_path: transcriptFile([
        JSON.stringify({ type: 'pr-link', prNumber: 77 }),
        assistant('msg_m', usage(2, 2)),
      ]),
    });
    const line = ledgerLineSchema.parse(JSON.parse(r.lines[0]!));
    expect(line).toMatchObject({ kind: 'session', prLinks: [77], responses: 1 });
  });

  it('fails open: bad JSON, a missing transcript, or an unknown event write nothing and exit 0', () => {
    for (const input of [
      'not json',
      {
        hook_event_name: 'SubagentStop',
        session_id: 'x',
        agent_id: 'a',
        agent_transcript_path: '/no/such/file',
      },
      { hook_event_name: 'PreToolUse', session_id: 'x' },
    ]) {
      const r = run(input);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.lines).toHaveLength(0);
    }
  });

  it('is switched off by GYMCOACH_USAGE_LEDGER=off', () => {
    const r = run(
      { hook_event_name: 'UserPromptSubmit', session_id: SESSION_ID, prompt: 'x' },
      { GYMCOACH_USAGE_LEDGER: 'off' },
    );
    expect(r.status).toBe(0);
    expect(r.lines).toHaveLength(0);
  });
});
