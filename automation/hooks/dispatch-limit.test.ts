import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
type Decision = { allow?: true; deny?: string; notes?: { code: string; text: string }[] };
const hook = require('./dispatch-limit.cjs') as {
  handle: (input: Record<string, unknown>, env: Record<string, string>, now?: number) => Decision;
  sessionSpend: (
    file: string,
    key: string,
  ) => { known: number; unknownParts: number; agents: number };
  maxSubagents: (env: Record<string, string>) => number | null;
  sessionDir: (env: Record<string, string>, sessionId: string) => string;
  withLock: <T>(dir: string, fn: () => T) => T;
  agentTranscript: (input: Record<string, unknown>) => string | null;
  LOCK_WAIT_MS: number;
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

// How often the hook waits for its lock, counted instead of timed: every wait
// is one Atomics.wait of SPIN_MS (`spin` in the hook). "It did not wait" used
// to be asserted as "it took under 1000 ms", which a busy machine can break
// with no wait at all and which let up to 49 waits through (#593). Returns a
// function that gives the count so far and stops counting.
function countLockWaits(): () => number {
  const spy = vi.spyOn(Atomics, 'wait');
  return () => {
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    return calls;
  };
}

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

  it('derives the subagent transcript from the session transcript path', () => {
    expect(
      hook.agentTranscript({
        transcript_path: '/p/proj/sess-1.jsonl',
        session_id: 'sess-1',
        agent_id: 'abc123',
      }),
    ).toBe('/p/proj/sess-1/subagents/agent-abc123.jsonl');
    expect(hook.agentTranscript({ session_id: 'sess-1', agent_id: 'abc' })).toBeNull();
    expect(
      hook.agentTranscript({ transcript_path: '/p/x.jsonl', session_id: 's', agent_id: '../x' }),
    ).toBeNull();
  });

  it('stops counting a subagent whose transcript went idle (TaskStop, no SubagentStop)', () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '1' });
    const root = tmp();
    const transcript = join(root, SESSION, 'subagents', 'agent-idle1.jsonl');
    mkdirSync(join(root, SESSION, 'subagents'), { recursive: true });
    writeFileSync(transcript, '{}\n');
    const now = Date.now();
    // Started 90 minutes ago.
    hook.handle(
      { ...start('idle1'), transcript_path: join(root, `${SESSION}.jsonl`) },
      e,
      now - 90 * 60_000,
    );
    // Written a minute ago: alive, so a second subagent is refused, with a
    // recovery hint.
    const recent = new Date(now - 60_000);
    utimesSync(transcript, recent, recent);
    const refused = hook.handle(pre('next'), e, now);
    expect(refused.deny).toMatch(/idle for 60 minutes/);
    expect(refused.deny).toMatch(/GYMCOACH_MAX_SUBAGENTS=N\|off/);
    // Silent for 46 minutes (one long tool call, as observed here): still counted.
    const silent = new Date(now - 46 * 60_000);
    utimesSync(transcript, silent, silent);
    expect(hook.handle(pre('next'), e, now).deny).toBeTruthy();
    // Idle for 70 minutes: no longer counted, although SubagentStop never came.
    const idle = new Date(now - 70 * 60_000);
    utimesSync(transcript, idle, idle);
    expect(hook.handle(pre('next'), e, now).allow).toBe(true);
  });

  it('clears a finished subagent on SubagentStop even while the lock is held', () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '1' });
    const t = 4_000_000;
    hook.handle(start('busy'), e, t);
    const dir = hook.sessionDir(e, SESSION);
    mkdirSync(join(dir, '.lock'));
    const waits = countLockWaits();
    expect(hook.handle(stop('busy'), e, t + 1).allow).toBe(true);
    expect(waits()).toBe(0);
    expect(readdirSync(dir).filter((f) => f.startsWith('running-'))).toHaveLength(0);
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
    // The first call must have been counted, not let through by a skipped
    // check: that would make the second one pass too. The stderr in the
    // message names the cause if this ever goes wrong again (issue #593: it
    // exited 0 once under load, with nothing kept to say why).
    const first = run(pre('one'), e);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stderr).toBe('');
    expect(first.stdout).toBe('');
    const res = run(pre('two'), e);
    expect(res.status, res.stderr).toBe(2);
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

  it('removes a .lock that is a regular file instead of spinning on it', () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '5' });
    const dir = hook.sessionDir(e, SESSION);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.lock'), 'debris');
    const waits = countLockWaits();
    expect(hook.withLock(dir, () => 'ran')).toBe('ran');
    expect(waits()).toBe(0);
  });

  it('warns once when a budget is set but the ledger is off, and lets dispatches through', () => {
    const e = env({ GYMCOACH_SESSION_TOKEN_BUDGET: '1', GYMCOACH_USAGE_LEDGER: 'off' });
    const first = run(pre('w1'), e);
    expect(first.status).toBe(0);
    expect(first.stderr).toMatch(/budget cannot be measured/);
    const second = run(pre('w2'), e);
    expect(second.status).toBe(0);
    expect(second.stderr).toBe('');
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

// Issue #593: the hook's test exited 0 instead of 2 once at load ~30. Each case
// below is a way the limit used to stop applying without a refusal, replayed
// with synthetic input: a lock somebody else holds, state that cannot be read.
describe('dispatch limit: a busy lock or unreadable state does not lift the limit silently', () => {
  function run(input: unknown, e: Record<string, string>) {
    return spawnSync(process.execPath, [SCRIPT], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { ...process.env, GYMCOACH_MAX_SUBAGENTS: '', GYMCOACH_SESSION_TOKEN_BUDGET: '', ...e },
    });
  }
  // A lock held by another hook for the whole call. Its mtime is in the
  // future, so a slow machine cannot make it look abandoned (15 s) mid-test.
  function holdLock(dir: string) {
    const lock = join(dir, '.lock');
    mkdirSync(lock, { recursive: true });
    const later = new Date(Date.now() + 10 * 60_000);
    utimesSync(lock, later, later);
    return lock;
  }
  const names = (dir: string, prefix: string) =>
    readdirSync(dir).filter((f) => f.startsWith(prefix));
  const skipLog = (e: Record<string, string>) =>
    readFileSync(join(e.GYMCOACH_DISPATCH_STATE_DIR!, 'skipped.log'), 'utf8');

  it('still refuses at the limit while the lock is held', { timeout: 30_000 }, () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '1' });
    expect(run(pre('one'), e).status).toBe(0);
    const dir = hook.sessionDir(e, SESSION);
    const lock = holdLock(dir);
    const began = Date.now();
    const res = run(pre('two'), e);
    // It waited for the lock first, then counted without it.
    expect(Date.now() - began).toBeGreaterThanOrEqual(hook.LOCK_WAIT_MS);
    expect(res.status, res.stderr).toBe(2);
    expect(res.stderr).toMatch(/already has 1 subagent\(s\) running or starting \(limit 1/);
    expect(res.stderr).toMatch(/lock was skipped and this call was counted without it/);
    // A refusal keeps stdout empty; the holder's lock is not taken from it.
    expect(res.stdout).toBe('');
    expect(existsSync(lock)).toBe(true);
    expect(skipLog(e)).toMatch(new RegExp(`^\\S+ PreToolUse lock-busy ${usage.hash(SESSION)}\\n$`));
  });

  it('under the limit, counts the call without the lock and says so', { timeout: 30_000 }, () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '2' });
    expect(run(pre('one'), e).status).toBe(0);
    const dir = hook.sessionDir(e, SESSION);
    holdLock(dir);
    const res = run(pre('two'), e);
    expect(res.status, res.stderr).toBe(0);
    // Visible three ways: stderr, a hook systemMessage, the skip log.
    expect(res.stderr).toMatch(/^dispatch-limit: the state lock stayed busy for 3 s/);
    expect(JSON.parse(res.stdout)).toEqual({
      systemMessage: expect.stringMatching(/^dispatch-limit: .*counted without it/),
    });
    expect(skipLog(e)).toContain(' PreToolUse lock-busy ');
    // The reservation is there, so the next call is refused: before #593
    // this call left none and the limit was lifted for it.
    expect(names(dir, 'pending-')).toHaveLength(2);
    expect(readdirSync(dir).filter((f) => f.startsWith('.tmp-'))).toHaveLength(0);
    expect(hook.handle(pre('three'), e, Date.now()).deny).toMatch(/limit 2/);
  });

  it('counts a subagent whose SubagentStart found the lock held', { timeout: 30_000 }, () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '1' });
    const t = Date.now();
    expect(hook.handle(pre('one'), e, t).allow).toBe(true);
    const dir = hook.sessionDir(e, SESSION);
    holdLock(dir);
    const started = hook.handle(start('late'), e, t + 1);
    expect(started.allow).toBe(true);
    expect(started.notes?.map((n) => n.code)).toEqual(['lock-busy']);
    // Its reservation became a running entry: one in flight, not zero, not two.
    expect(names(dir, 'running-')).toEqual([`running-${usage.hash('late')}`]);
    expect(names(dir, 'pending-')).toHaveLength(0);
    rmSync(join(dir, '.lock'), { recursive: true });
    expect(hook.handle(pre('two'), e, t + 2).deny).toMatch(/limit 1/);
    hook.handle(stop('late'), e, t + 3);
    expect(hook.handle(pre('two'), e, t + 4)).toEqual({ allow: true });
  });

  // root lists a directory whatever its mode.
  it.skipIf(process.getuid?.() === 0)(
    'says so when the state directory cannot be listed, instead of counting zero',
    () => {
      const e = env({ GYMCOACH_MAX_SUBAGENTS: '1' });
      expect(run(pre('one'), e).status).toBe(0);
      const dir = hook.sessionDir(e, SESSION);
      chmodSync(dir, 0o300); // write and search, no read: the lock works, the listing fails
      try {
        const res = run(pre('two'), e);
        // An internal error still lets the call through (never a refusal)...
        expect(res.status).toBe(0);
        // ...but no longer without a word (before #593: exit 0, empty stderr).
        expect(res.stderr).toMatch(/^dispatch-limit: skipped \(EACCES\): .*not checked/);
        expect(JSON.parse(res.stdout).systemMessage).toMatch(/skipped \(EACCES\)/);
        expect(skipLog(e)).toContain(' PreToolUse skipped-EACCES ');
      } finally {
        chmodSync(dir, 0o700);
      }
    },
  );

  it('does not count an entry it cannot read, and says so', () => {
    const e = env({ GYMCOACH_MAX_SUBAGENTS: '2' });
    const dir = hook.sessionDir(e, SESSION);
    mkdirSync(join(dir, 'pending-is-a-directory'), { recursive: true });
    writeFileSync(join(dir, 'running-cut-short'), '');
    const t = Date.now();
    const res = hook.handle(pre('one'), e, t);
    expect(res.allow).toBe(true);
    expect(res.notes).toEqual([
      {
        code: 'unreadable-entry',
        text: expect.stringMatching(/^2 state entries could not be read/),
      },
    ]);
    // Readable state says nothing.
    rmSync(join(dir, 'pending-is-a-directory'), { recursive: true });
    rmSync(join(dir, 'running-cut-short'));
    expect(hook.handle(pre('two'), e, t)).toEqual({ allow: true });
    expect(hook.handle(pre('three'), e, t).deny).toMatch(/limit 2/);
  });

  it('keeps the error out of a refusal: bad input names its reason and exits 0', () => {
    const e = env();
    const res = spawnSync(process.execPath, [SCRIPT], {
      input: 'not json',
      encoding: 'utf8',
      env: { ...process.env, ...e },
    });
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/^dispatch-limit: skipped \(error\)/);
    expect(skipLog(e)).toMatch(/ - skipped-error -\n$/);
  });
});
