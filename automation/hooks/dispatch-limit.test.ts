import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
type Decision = { allow?: true; deny?: string };
const hook = require('./dispatch-limit.cjs') as {
  handle: (input: Record<string, unknown>, env: Record<string, string>, now?: number) => Decision;
  sessionSpend: (
    file: string,
    key: string,
  ) => { known: number; unknownParts: number; agents: number };
  maxSubagents: (env: Record<string, string>) => number | null;
  sessionDir: (env: Record<string, string>, sessionId: string) => string;
};
const usage = require('./record-usage.cjs') as { hash: (v: string) => string };

const SCRIPT = join(__dirname, 'dispatch-limit.cjs');
const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'dispatch-limit-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SESSION = 'session-1';
function env(over: Record<string, string> = {}): Record<string, string> {
  const root = tmp();
  return {
    GYMCOACH_DISPATCH_STATE_DIR: join(root, 'state'),
    GYMCOACH_USAGE_LEDGER_PATH: join(root, 'ledger.jsonl'),
    ...over,
  };
}
const pre = (id: string) => ({
  hook_event_name: 'PreToolUse',
  session_id: SESSION,
  tool_name: 'Agent',
  tool_use_id: id,
});
const start = (id: string) => ({
  hook_event_name: 'SubagentStart',
  session_id: SESSION,
  agent_id: id,
  agent_type: 'general-purpose',
});
const stop = (id: string) => ({
  hook_event_name: 'SubagentStop',
  session_id: SESSION,
  agent_id: id,
});

describe('dispatch limit: concurrency', () => {
  it('refuses the fourth running subagent and allows it once one finishes', () => {
    const e = env();
    const t = 1_000_000;
    for (const n of ['a', 'b', 'c']) {
      expect(hook.handle(pre(`tu-${n}`), e, t).allow).toBe(true);
      hook.handle(start(n), e, t + 1);
    }
    const refused = hook.handle(pre('tu-d'), e, t + 2);
    expect(refused.deny).toMatch(/already has 3 subagent\(s\) running.*limit 3/);
    hook.handle(stop('b'), e, t + 3);
    expect(hook.handle(pre('tu-d'), e, t + 4).allow).toBe(true);
  });

  it('counts reservations, so several Agent calls in one turn cannot overshoot', () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '2' });
    const t = 2_000_000;
    expect(hook.handle(pre('x'), e, t).allow).toBe(true);
    expect(hook.handle(pre('y'), e, t).allow).toBe(true);
    // Neither has reached SubagentStart yet.
    expect(hook.handle(pre('z'), e, t).deny).toMatch(/limit 2/);
    // A start converts a reservation: still two in flight.
    hook.handle(start('x1'), e, t + 1);
    expect(hook.handle(pre('z'), e, t + 2).deny).toMatch(/limit 2/);
    const files = readdirSync(hook.sessionDir(e, SESSION)).sort();
    expect(files).toEqual([expect.stringMatching(/^pending-/), `running-${usage.hash('x1')}`]);
  });

  it('lets a reservation that never started, and a running entry left by a crash, expire', () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '1', GYMCOACH_SUBAGENT_STALE_HOURS: '1' });
    const t = 3_000_000;
    expect(hook.handle(pre('p'), e, t).allow).toBe(true);
    expect(hook.handle(pre('q'), e, t + 1000).deny).toBeDefined();
    // The reservation lapses after two minutes (a denied or abandoned call).
    expect(hook.handle(pre('q'), e, t + 121_000).allow).toBe(true);
    hook.handle(start('crashed'), e, t + 121_001);
    expect(hook.handle(pre('r'), e, t + 122_000 + 121_000).deny).toBeDefined();
    // A running entry older than the stale bound no longer counts.
    expect(hook.handle(pre('r'), e, t + 3_700_000 + 121_000).allow).toBe(true);
  });

  it('never refuses another tool, and is off with GYMCOACH_MAX_SUBAGENTS=off', () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '1' });
    hook.handle(pre('one'), e, 10);
    expect(hook.handle({ ...pre('bash'), tool_name: 'Bash' }, e, 11).allow).toBe(true);
    expect(hook.handle(pre('two'), { ...e, GYMCOACH_MAX_SUBAGENTS: 'off' }, 12).allow).toBe(true);
    expect(hook.maxSubagents({})).toBe(3);
    expect(hook.maxSubagents({ GYMCOACH_MAX_SUBAGENTS: 'nonsense' })).toBe(3);
  });

  it('keeps sessions apart and forgets a session at SessionEnd', () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '1' });
    hook.handle(pre('mine'), e, 5);
    expect(hook.handle({ ...pre('other'), session_id: 'session-2' }, e, 6).allow).toBe(true);
    hook.handle({ hook_event_name: 'SessionEnd', session_id: SESSION }, e, 7);
    expect(hook.handle(pre('again'), e, 8).allow).toBe(true);
  });
});

describe('dispatch limit: session token budget', () => {
  function agentLine(session: string, by: Record<string, number | null>[]) {
    return JSON.stringify({
      v: 1,
      kind: 'agent',
      sessionKey: usage.hash(session),
      byModel: by.map((g) => ({ model: 'claude-opus-5-5', speed: null, responses: 1, ...g })),
    });
  }

  it('refuses a new subagent once finished subagents spent more than the budget', () => {
    const e = env({ GYMCOACH_SESSION_TOKEN_BUDGET: '1000' });
    writeFileSync(
      e.GYMCOACH_USAGE_LEDGER_PATH!,
      [
        agentLine(SESSION, [
          { input: 10, output: 400, cacheRead: 999_999, cacheCreation5m: 100, cacheCreation1h: 0 },
        ]),
        agentLine('someone-else', [
          { input: 0, output: 50_000, cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: 0 },
        ]),
      ].join('\n') + '\n',
    );
    // 510 spent, cache reads not counted, the other session ignored.
    expect(hook.handle(pre('a'), e, 1).allow).toBe(true);
    writeFileSync(
      e.GYMCOACH_USAGE_LEDGER_PATH!,
      agentLine(SESSION, [
        { input: 10, output: 900, cacheRead: 0, cacheCreation5m: 200, cacheCreation1h: null },
      ]) + '\n',
      { flag: 'a' },
    );
    const refused = hook.handle(pre('b'), e, 2);
    expect(refused.deny).toMatch(
      /budget is spent.*1620 tokens.*2 subagent\(s\), plus 1 unrecorded count/,
    );
  });

  it('counts unknown parts as unknown, not zero', () => {
    const root = tmp();
    const file = join(root, 'l.jsonl');
    writeFileSync(
      file,
      agentLine(SESSION, [
        { input: null, output: 5, cacheRead: 0, cacheCreation5m: null, cacheCreation1h: 1 },
      ]) + '\n',
    );
    expect(hook.sessionSpend(file, usage.hash(SESSION))).toEqual({
      known: 6,
      unknownParts: 2,
      agents: 1,
    });
  });

  it('has no budget unless GYMCOACH_SESSION_TOKEN_BUDGET is set', () => {
    const e = env();
    writeFileSync(
      e.GYMCOACH_USAGE_LEDGER_PATH!,
      agentLine(SESSION, [
        { input: 0, output: 10_000_000, cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: 0 },
      ]) + '\n',
    );
    expect(hook.handle(pre('a'), e, 1).allow).toBe(true);
  });
});

describe('dispatch limit: the hook process', () => {
  function run(input: unknown, e: Record<string, string>) {
    return spawnSync(process.execPath, [SCRIPT], {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      encoding: 'utf8',
      env: { ...process.env, GYMCOACH_MAX_SUBAGENTS: '', GYMCOACH_SESSION_TOKEN_BUDGET: '', ...e },
    });
  }

  it('exits 2 with the reason on stderr when it refuses, 0 otherwise', () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '1' });
    expect(run(pre('one'), e).status).toBe(0);
    const res = run(pre('two'), e);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/dispatch-limit: .*limit 1/);
    expect(res.stdout).toBe('');
  });

  it('fails open on bad input and on an unwritable state directory', () => {
    const e = env();
    expect(run('not json', e).status).toBe(0);
    const blocked = join(tmp(), 'file-not-dir');
    writeFileSync(blocked, 'x');
    const res = run(pre('a'), { ...e, GYMCOACH_DISPATCH_STATE_DIR: join(blocked, 'sub') });
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/dispatch-limit: skipped/);
  });

  it('takes over a lock left by a hook that died, and fails open on a live one', () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '5' });
    const dir = hook.sessionDir(e, SESSION);
    mkdirSync(join(dir, '.lock'), { recursive: true });
    // A lock older than 15 s is taken over: the call is counted.
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(dir, '.lock'), old, old);
    expect(run(pre('a'), e).status).toBe(0);
    expect(readdirSync(dir).filter((f) => f.startsWith('pending-'))).toHaveLength(1);
    // A fresh lock: the hook waits up to 3 s, then lets the call through.
    mkdirSync(join(dir, '.lock'));
    const res = run(pre('b'), e);
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/skipped/);
  });
});
