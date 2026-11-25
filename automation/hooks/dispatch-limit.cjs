#!/usr/bin/env node
'use strict';
// Dispatch limit for subagents (roadmap milestone 2: concurrency and spending
// limits that stop dispatching before the budget is exhausted). Claude Code
// runs this hook on four events:
//
//   PreToolUse (Agent)  refuse a new subagent when this session already has
//                       GYMCOACH_MAX_SUBAGENTS running (default 3), or when
//                       GYMCOACH_SESSION_TOKEN_BUDGET is set and the session's
//                       finished subagents already spent more than it
//   SubagentStart       mark the subagent as running
//   SubagentStop        mark it as finished (no lock: it only removes its own
//                       entry, which is atomic and idempotent)
//   SessionEnd          forget the session's state
//
// Only the Agent tool is ever refused: the session keeps every other tool, so
// a refusal means "wait for a running subagent's completion, then dispatch".
//
// Counting: a subagent is running from SubagentStart to SubagentStop (by
// default subagents run in the background, so the Agent tool call itself
// returns long before). Several Agent calls in one turn reach PreToolUse
// before any SubagentStart, so an accepted call leaves a short-lived
// reservation that SubagentStart converts into a running entry. Entries live
// under ${GYMCOACH_DISPATCH_STATE_DIR:-${XDG_STATE_HOME:-~/.local/state}/gymcoach-runs/agents}/<session key>/.
//
// Liveness: SubagentStop does not always fire. On Claude Code 2.1.296 a
// background subagent stopped with TaskStop produced no SubagentStop (probe in
// a throwaway repo), and a crash can skip it too. So a running entry counts
// only while its subagent looks alive: its transcript (derived from the
// session's transcript path: <dir>/<session id>/subagents/agent-<id>.jsonl,
// since SubagentStart carries no agent_transcript_path) was written within the
// last GYMCOACH_SUBAGENT_IDLE_MINUTES (default 60: real subagent transcripts
// here stay silent for up to 46 minutes during one long tool call, such as a
// wait on a heavy-work slot or the --full lock). An entry whose transcript is
// unknown counts for GYMCOACH_SUBAGENT_STALE_HOURS (default 2) after its
// start. A subagent that runs one silent command longer than the idle window
// stops counting early: the limit is then loose, never stuck.
//
// Budget: a TOKEN budget, not a cost budget: tokens the session's finished
// subagents were billed for at full or write rates (input + output + cache
// writes, each counted once; cache reads, billed at a tenth of input, are not
// counted), read from the run-time usage ledger (#451). The ledger read is
// cached per session by the ledger's size and mtime. With the ledger off
// (GYMCOACH_USAGE_LEDGER=off) the budget cannot be measured: the hook says so
// once on stderr and lets dispatches through. An
// unrecorded count is unknown, not zero; when part of the spend is unknown
// the known part still counts, and the refusal says so. Subagents already
// running when the budget is crossed are not stopped: the overrun is bounded
// by the concurrency limit.
//
// Failure policy: fail open, and say so. Any error in the hook exits 0 and
// lets the call through; a broken hook must not freeze the session, and an
// error is never turned into a refusal. A refusal only ever comes from a count
// or a spend that was actually read. Disable with GYMCOACH_MAX_SUBAGENTS=off
// (the budget still applies when set).
//
// A busy state lock is not an error (issue #593). When the lock cannot be
// taken within LOCK_WAIT_MS (a saturated machine, or a lock left by a hook
// that died less than LOCK_STALE_MS ago), the hook does its work WITHOUT the
// lock instead of letting the call through uncounted: it still counts, still
// refuses at the limit and still leaves its reservation. Every state file is
// written whole under its own name (temp file, then rename), so the only thing
// lost without the lock is exactness between calls that race: N calls deciding
// in the same instant can overshoot the limit by N-1, where the old behaviour
// lifted the limit for all of them and left no reservation. A lock that can
// never be taken therefore cannot lock anybody out either.
//
// Visibility: whenever a check was skipped or weakened (an internal error, a
// lock-free count, a state entry that could not be read and was not counted),
// the hook prints one `dispatch-limit: ...` line on stderr, returns the same
// text as a hook `systemMessage` on stdout (exit 0 only; Claude Code shows it
// in the session, where stderr of a passing hook is only in the debug log) and
// appends a line (time, event, reason code, session key; no path, no text) to
// <state root>/skipped.log, so a limit that did not apply leaves a trace.
// Not covered: a hook killed by Claude Code's own hook timeout (10 s in
// .claude/settings.json) never gets to say anything; the call goes through.
//
// Written for old Node too (no optional chaining or ??), like the other hooks.

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const usage = require('./record-usage.cjs');

const DEFAULT_MAX = 3;
const RESERVATION_MS = 120 * 1000;
const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 15 * 1000;
const SPIN_MS = 20;
const LOCK_TIMEOUT = 'ELOCKTIMEOUT';
const SKIP_LOG = 'skipped.log';
const SKIP_LOG_MAX_BYTES = 1024 * 1024;
const AGENT_TOOLS = ['Agent', 'Task'];

function stateRoot(env) {
  if (env.GYMCOACH_DISPATCH_STATE_DIR) return env.GYMCOACH_DISPATCH_STATE_DIR;
  const base = env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'gymcoach-runs', 'agents');
}

function sessionDir(env, sessionId) {
  return path.join(stateRoot(env), usage.hash(sessionId));
}

// null: no limit. A malformed value fails open to the default, with a note.
function maxSubagents(env) {
  const raw = env.GYMCOACH_MAX_SUBAGENTS;
  if (raw === undefined || raw === '') return DEFAULT_MAX;
  if (String(raw).toLowerCase() === 'off') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX;
}

function tokenBudget(env) {
  const raw = env.GYMCOACH_SESSION_TOKEN_BUDGET;
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function staleMs(env) {
  const h = Number(env.GYMCOACH_SUBAGENT_STALE_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 2) * 3600 * 1000;
}

function idleMs(env) {
  const m = Number(env.GYMCOACH_SUBAGENT_IDLE_MINUTES);
  return (Number.isFinite(m) && m > 0 ? m : 60) * 60 * 1000;
}

// Where Claude Code keeps a subagent's transcript, from the session's
// transcript path (checked on 2.1.296). null when it cannot be derived.
function agentTranscript(input) {
  if (typeof input.transcript_path !== 'string' || typeof input.agent_id !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.agent_id)) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(input.session_id))) return null;
  return path.join(
    path.dirname(input.transcript_path),
    input.session_id,
    'subagents',
    'agent-' + input.agent_id + '.jsonl',
  );
}

// Waits SPIN_MS without burning a core where the runtime can sleep: a hook
// that waits for the lock on a saturated machine must not add to the load
// that made it wait. The busy loop is the fallback for a Node without
// SharedArrayBuffer.
function spin() {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SPIN_MS);
    return;
  } catch {
    // no SharedArrayBuffer or Atomics here: spin instead
  }
  const until = Date.now() + SPIN_MS;
  while (Date.now() < until) {
    // brief spin: hooks are short-lived
  }
}

// A tiny cross-process lock: mkdir is atomic. A lock older than
// LOCK_STALE_MS belongs to a hook that died and is taken over.
// Every path through the loop checks the deadline, so a lock that cannot be
// taken or cleared ends in a 'lock timeout' error (code ELOCKTIMEOUT, thrown
// before fn runs; handle() then works without the lock), never in a spin. A
// .lock that is not a directory is debris: it is removed.
function withLock(dir, fn) {
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
    }
    if (Date.now() > deadline) {
      const timeout = new Error('lock timeout');
      timeout.code = LOCK_TIMEOUT;
      throw timeout;
    }
    try {
      const st = fs.statSync(lock);
      if (!st.isDirectory()) fs.unlinkSync(lock);
      else if (Date.now() - st.mtimeMs > LOCK_STALE_MS) fs.rmdirSync(lock);
      else spin();
    } catch {
      // gone in between, or not removable: wait and try again
      spin();
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.rmdirSync(lock);
    } catch {
      // already gone
    }
  }
}

// withLock, or fn without the lock when the lock stays busy (see the header).
// The note makes the weaker count visible.
function lockedOrNot(dir, notes, fn) {
  try {
    return withLock(dir, fn);
  } catch (e) {
    if (!e || e.code !== LOCK_TIMEOUT) throw e;
  }
  notes.push({
    code: 'lock-busy',
    text:
      'the state lock stayed busy for ' +
      LOCK_WAIT_MS / 1000 +
      ' s, so the lock was skipped and this call was counted without it (calls that race ' +
      'each other can overshoot GYMCOACH_MAX_SUBAGENTS by one each)',
  });
  return fn();
}

// A state file appears whole or not at all: a reader without the lock never
// sees a half-written entry. The temp name starts with a dot, so entries()
// ignores it.
function writeEntry(dir, name, content) {
  const tmp = path.join(dir, '.tmp-' + process.pid + '-' + name);
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, path.join(dir, name));
}

// No state directory yet means no entries. Any other failure to list it
// (EACCES, EMFILE, ENFILE, EIO) is thrown: counting zero there would lift the
// limit without a word, so the caller fails open visibly instead.
function entries(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  return names.filter(function (f) {
    return f.charAt(0) !== '.';
  });
}

// An entry is { t: start time, transcript: path or null }; a bare number (the
// first version of this hook) reads as a start time with no transcript.
function readEntry(dir, name) {
  const raw = fs.readFileSync(path.join(dir, name), 'utf8');
  if (!raw.trim()) throw new Error('empty entry'); // Number('') would read as 0
  const n = Number(raw);
  if (Number.isFinite(n)) return { t: n, transcript: null };
  const j = JSON.parse(raw);
  return {
    t: Number.isFinite(Number(j.t)) ? Number(j.t) : 0,
    transcript: typeof j.transcript === 'string' ? j.transcript : null,
  };
}

function startedAt(dir, name) {
  return readEntry(dir, name).t;
}

// Whether a running entry still counts at `now` (see Liveness above).
function alive(entry, env, now) {
  if (entry.transcript) {
    let last = entry.t;
    try {
      last = fs.statSync(entry.transcript).mtimeMs;
    } catch {
      // not written yet: the start time stands in for the last write
    }
    return now - last < idleMs(env);
  }
  return now - entry.t < staleMs(env);
}

// Live running entries and reservations of one session, as names.
// `unreadable` counts entries that exist but could not be read: they are not
// counted (an error is never turned into a refusal), and the caller says so.
// An entry removed between the listing and the read (SubagentStop takes no
// lock) is simply gone.
function census(dir, env, now) {
  const running = [];
  const pending = [];
  let unreadable = 0;
  entries(dir).forEach(function (f) {
    if (f.indexOf('running-') !== 0 && f.indexOf('pending-') !== 0) return;
    let e;
    try {
      e = readEntry(dir, f);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') unreadable += 1;
      return;
    }
    if (f.indexOf('running-') === 0 && alive(e, env, now)) running.push(f);
    if (f.indexOf('pending-') === 0 && now - e.t < RESERVATION_MS) pending.push(f);
  });
  return { running: running, pending: pending, unreadable: unreadable };
}

function noteUnreadable(notes, c) {
  if (!c.unreadable) return;
  notes.push({
    code: 'unreadable-entry',
    text:
      c.unreadable +
      (c.unreadable === 1 ? ' state entry' : ' state entries') +
      ' could not be read and ' +
      (c.unreadable === 1 ? 'was' : 'were') +
      ' not counted (the limit may be looser than set)',
  });
}

const SPENT_KINDS = ['input', 'output', 'cacheCreation5m', 'cacheCreation1h'];

// Tokens billed at full or write rates by this session's finished subagents,
// cached in <dir>/.spend-cache.json by the ledger's size and mtime.
function cachedSpend(dir, ledgerFile, sessionKey) {
  let st;
  try {
    st = fs.statSync(ledgerFile);
  } catch {
    return { known: 0, unknownParts: 0, agents: 0 };
  }
  const cacheFile = path.join(dir, '.spend-cache.json');
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.size === st.size && c.mtimeMs === st.mtimeMs && c.key === sessionKey) return c.spend;
  } catch {
    // no cache yet
  }
  const spend = sessionSpend(ledgerFile, sessionKey);
  try {
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({ size: st.size, mtimeMs: st.mtimeMs, key: sessionKey, spend: spend }),
    );
  } catch {
    // a cache is an optimisation only
  }
  return spend;
}

function sessionSpend(ledgerFile, sessionKey) {
  let known = 0;
  let unknownParts = 0;
  let agents = 0;
  let text = '';
  try {
    text = fs.readFileSync(ledgerFile, 'utf8');
  } catch {
    return { known: 0, unknownParts: 0, agents: 0 };
  }
  text.split('\n').forEach(function (line) {
    if (line.indexOf(sessionKey) === -1) return;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      return;
    }
    if (!rec || rec.kind !== 'agent' || rec.sessionKey !== sessionKey) return;
    agents += 1;
    (rec.byModel || []).forEach(function (g) {
      SPENT_KINDS.forEach(function (k) {
        if (typeof g[k] === 'number' && isFinite(g[k])) known += g[k];
        else unknownParts += 1;
      });
    });
  });
  return { known: known, unknownParts: unknownParts, agents: agents };
}

// Hook input in, decision out: { deny: string } or { allow: true }, either
// with `notes` ({ code, text }) when a check was skipped or weakened. Writes
// the session's state as a side effect. `now` is injectable for tests.
function handle(input, env, now) {
  const notes = [];
  const decision = decide(input, env, now || Date.now(), notes);
  if (notes.length) decision.notes = notes;
  return decision;
}

function decide(input, env, at, notes) {
  const event = input && input.hook_event_name;
  if (!input || typeof input.session_id !== 'string') return { allow: true };
  const dir = sessionDir(env, input.session_id);

  if (event === 'PreToolUse') {
    if (AGENT_TOOLS.indexOf(input.tool_name) === -1) return { allow: true };
    const max = maxSubagents(env);
    const budget = tokenBudget(env);
    return lockedOrNot(dir, notes, function () {
      if (max !== null) {
        const c = census(dir, env, at);
        noteUnreadable(notes, c);
        const busy = c.running.length + c.pending.length;
        if (busy >= max)
          return {
            deny:
              'dispatch-limit: this session already has ' +
              busy +
              ' subagent(s) running or starting (limit ' +
              max +
              ', GYMCOACH_MAX_SUBAGENTS). Do not retry now: wait for a running ' +
              "subagent's completion notification, then dispatch again. A subagent " +
              'stopped without a completion (TaskStop, crash) stops counting once its ' +
              'transcript has been idle for ' +
              idleMs(env) / 60000 +
              ' minutes (GYMCOACH_SUBAGENT_IDLE_MINUTES); the operator can also raise ' +
              'or disable the limit (GYMCOACH_MAX_SUBAGENTS=N|off). Heavy local work ' +
              'is also capped machine-wide (scripts/heavy-slot.sh).',
          };
      }
      if (budget !== null && String(env.GYMCOACH_USAGE_LEDGER || '').toLowerCase() === 'off') {
        const marker = path.join(dir, '.budget-unmeasured');
        if (!fs.existsSync(marker)) {
          fs.writeFileSync(marker, String(at));
          process.stderr.write(
            'dispatch-limit: GYMCOACH_SESSION_TOKEN_BUDGET is set but the usage ledger is off ' +
              '(GYMCOACH_USAGE_LEDGER=off): the budget cannot be measured and is not enforced\n',
          );
        }
      } else if (budget !== null) {
        const spend = cachedSpend(dir, usage.ledgerPath(env), usage.hash(input.session_id));
        if (spend.known > budget)
          return {
            deny:
              'dispatch-limit: the session token budget is spent: finished subagents used ' +
              spend.known +
              ' tokens at full or write rates (input, output, cache writes; ' +
              spend.agents +
              ' subagent(s)' +
              (spend.unknownParts ? ', plus ' + spend.unknownParts + ' unrecorded count(s)' : '') +
              ') against GYMCOACH_SESSION_TOKEN_BUDGET=' +
              budget +
              '. Do not dispatch more subagents in this session; finish with ' +
              'what is running and report.',
          };
      }
      const key = 'pending-' + usage.hash(String(input.tool_use_id || at + Math.random()));
      writeEntry(dir, key, String(at));
      return { allow: true };
    });
  }

  if (event === 'SubagentStart') {
    if (typeof input.agent_id !== 'string') return { allow: true };
    return lockedOrNot(dir, notes, function () {
      // The running entry first: whatever happens next, this subagent counts.
      writeEntry(
        dir,
        'running-' + usage.hash(input.agent_id),
        JSON.stringify({ t: at, transcript: agentTranscript(input) }),
      );
      // Then convert one reservation, oldest first. Without the lock another
      // start may take the same one: try the next, so two starts never clear
      // a single reservation between them and leave the other standing.
      const c = census(dir, env, at);
      noteUnreadable(notes, c);
      const oldestFirst = c.pending
        .map(function (f) {
          let t = 0;
          try {
            t = startedAt(dir, f);
          } catch {
            // gone in between: the unlink below fails the same way and moves on
          }
          return { f: f, t: t };
        })
        .sort(function (a, b) {
          return a.t - b.t;
        });
      for (let i = 0; i < oldestFirst.length; i++) {
        try {
          fs.unlinkSync(path.join(dir, oldestFirst[i].f));
          break;
        } catch (e) {
          if (!e || e.code !== 'ENOENT') throw e;
        }
      }
      return { allow: true };
    });
  }

  if (event === 'SubagentStop') {
    // No lock: removing this agent's own entry is atomic and idempotent, so a
    // busy or broken lock can never leave a finished subagent counted.
    if (typeof input.agent_id !== 'string') return { allow: true };
    try {
      fs.unlinkSync(path.join(dir, 'running-' + usage.hash(input.agent_id)));
    } catch {
      // a stop without a start (hook added mid-session): nothing to clear
    }
    return { allow: true };
  }

  if (event === 'SessionEnd') {
    let all = [];
    try {
      all = fs.readdirSync(dir).filter(function (f) {
        return f !== '.lock';
      });
    } catch {
      all = [];
    }
    all.forEach(function (f) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {
        // gone
      }
    });
    try {
      fs.rmdirSync(dir);
    } catch {
      // not empty (a lock) or absent
    }
    return { allow: true };
  }
  return { allow: true };
}

// One line per skipped or weakened check: time, event, reason code, session
// key. Never a path or a message. Best effort, and bounded.
function logSkips(env, input, codes) {
  try {
    const root = stateRoot(env);
    const file = path.join(root, SKIP_LOG);
    fs.mkdirSync(root, { recursive: true });
    try {
      if (fs.statSync(file).size > SKIP_LOG_MAX_BYTES) return;
    } catch {
      // no log yet
    }
    const event = input && typeof input.hook_event_name === 'string' ? input.hook_event_name : '-';
    const key = input && typeof input.session_id === 'string' ? usage.hash(input.session_id) : '-';
    fs.appendFileSync(
      file,
      codes
        .map(function (code) {
          return [
            new Date().toISOString(),
            event.replace(/[^A-Za-z]/g, '') || '-',
            String(code).replace(/[^A-Za-z0-9_-]/g, ''),
            key,
          ].join(' ');
        })
        .join('\n') + '\n',
    );
  } catch {
    // the trace is a convenience: never a reason to fail
  }
}

// Says that a check was skipped or weakened: stderr always, the skip log, and
// (when the call is let through) a hook systemMessage on stdout.
function report(env, input, notes, allowed) {
  if (!notes.length) return;
  const lines = notes.map(function (n) {
    return 'dispatch-limit: ' + n.text;
  });
  process.stderr.write(lines.join('\n') + '\n');
  logSkips(
    env,
    input,
    notes.map(function (n) {
      return n.code;
    }),
  );
  if (allowed) process.stdout.write(JSON.stringify({ systemMessage: lines.join(' ') }) + '\n');
}

// The error code only (a message could name a path).
function skipped(code) {
  return {
    code: 'skipped-' + code,
    text:
      'skipped (' +
      code +
      '): the subagent limit and the token budget were not checked for this event, ' +
      'which was let through',
  };
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (d) {
    raw += d;
  });
  process.stdin.on('error', function () {
    report(process.env, null, [skipped('stdin')], true);
    process.exit(0);
  });
  process.stdin.on('end', function () {
    let input = null;
    let decision = { allow: true };
    try {
      input = JSON.parse(raw);
      decision = handle(input, process.env);
    } catch (e) {
      // Fail open, visibly.
      report(process.env, input, [skipped(String((e && e.code) || 'error'))], true);
      process.exit(0);
    }
    if (decision.deny) {
      process.stderr.write(decision.deny + '\n');
      report(process.env, input, decision.notes || [], false);
      process.exit(2);
    }
    report(process.env, input, decision.notes || [], true);
    process.exit(0);
  });
}

module.exports = {
  handle,
  census,
  sessionSpend,
  maxSubagents,
  tokenBudget,
  stateRoot,
  sessionDir,
  withLock,
  agentTranscript,
  LOCK_WAIT_MS,
};

if (require.main === module) main();
