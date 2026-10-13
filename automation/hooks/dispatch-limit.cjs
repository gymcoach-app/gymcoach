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
//   SubagentStop        mark it as finished
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
// under ${GYMCOACH_DISPATCH_STATE_DIR:-${XDG_STATE_HOME:-~/.local/state}/gymcoach-runs/agents}/<session key>/;
// a running entry older than GYMCOACH_SUBAGENT_STALE_HOURS (default 12) is
// ignored, so a session that crashed before SubagentStop cannot block later
// dispatches forever.
//
// Budget: tokens the session's finished subagents were billed for at full
// or write rates (input + output + cache writes; cache reads, billed at a
// tenth, are not counted), read from the run-time usage ledger (#451). An
// unrecorded count is unknown, not zero; when part of the spend is unknown
// the known part still counts, and the refusal says so. Subagents already
// running when the budget is crossed are not stopped: the overrun is bounded
// by the concurrency limit.
//
// Failure policy: fail open. Any error in the hook exits 0 and lets the call
// through, with a one-line note on stderr; a broken hook must not freeze the
// session. Disable with GYMCOACH_MAX_SUBAGENTS=off (the budget still applies
// when set).
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
  return (Number.isFinite(h) && h > 0 ? h : 12) * 3600 * 1000;
}

// A tiny cross-process lock: mkdir is atomic. A lock older than
// LOCK_STALE_MS belongs to a hook that died and is taken over.
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
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
          fs.rmdirSync(lock);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) throw new Error('lock timeout');
      const until = Date.now() + 20;
      while (Date.now() < until) {
        // brief spin: hooks are short-lived and Atomics.wait is not on old Node
      }
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

function entries(dir) {
  try {
    return fs.readdirSync(dir).filter(function (f) {
      return f !== '.lock';
    });
  } catch {
    return [];
  }
}

function startedAt(dir, name) {
  const t = Number(fs.readFileSync(path.join(dir, name), 'utf8'));
  return Number.isFinite(t) ? t : 0;
}

// Live running entries and reservations of one session, as names.
function census(dir, env, now) {
  const running = [];
  const pending = [];
  entries(dir).forEach(function (f) {
    let t = 0;
    try {
      t = startedAt(dir, f);
    } catch {
      return;
    }
    if (f.indexOf('running-') === 0 && now - t < staleMs(env)) running.push(f);
    if (f.indexOf('pending-') === 0 && now - t < RESERVATION_MS) pending.push(f);
  });
  return { running: running, pending: pending };
}

const SPENT_KINDS = ['input', 'output', 'cacheCreation5m', 'cacheCreation1h'];

// Tokens billed at full or write rates by this session's finished subagents.
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

// Hook input in, decision out: { deny: string } or { allow: true }. Writes
// the session's state as a side effect. `now` is injectable for tests.
function handle(input, env, now) {
  const at = now || Date.now();
  const event = input && input.hook_event_name;
  if (!input || typeof input.session_id !== 'string') return { allow: true };
  const dir = sessionDir(env, input.session_id);

  if (event === 'PreToolUse') {
    if (AGENT_TOOLS.indexOf(input.tool_name) === -1) return { allow: true };
    const max = maxSubagents(env);
    const budget = tokenBudget(env);
    return withLock(dir, function () {
      if (max !== null) {
        const c = census(dir, env, at);
        const busy = c.running.length + c.pending.length;
        if (busy >= max)
          return {
            deny:
              'dispatch-limit: this session already has ' +
              busy +
              ' subagent(s) running or starting (limit ' +
              max +
              ', GYMCOACH_MAX_SUBAGENTS). Do not retry now: wait for a running ' +
              "subagent's completion notification, then dispatch again. Heavy " +
              'local work is also capped machine-wide (scripts/heavy-slot.sh).',
          };
      }
      if (budget !== null) {
        const spend = sessionSpend(usage.ledgerPath(env), usage.hash(input.session_id));
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
      fs.writeFileSync(path.join(dir, key), String(at));
      return { allow: true };
    });
  }

  if (event === 'SubagentStart') {
    if (typeof input.agent_id !== 'string') return { allow: true };
    return withLock(dir, function () {
      const c = census(dir, env, at);
      if (c.pending.length) {
        const oldest = c.pending
          .map(function (f) {
            return { f: f, t: startedAt(dir, f) };
          })
          .sort(function (a, b) {
            return a.t - b.t;
          })[0];
        fs.unlinkSync(path.join(dir, oldest.f));
      }
      fs.writeFileSync(path.join(dir, 'running-' + usage.hash(input.agent_id)), String(at));
      return { allow: true };
    });
  }

  if (event === 'SubagentStop') {
    if (typeof input.agent_id !== 'string') return { allow: true };
    return withLock(dir, function () {
      try {
        fs.unlinkSync(path.join(dir, 'running-' + usage.hash(input.agent_id)));
      } catch {
        // a stop without a start (hook added mid-session): nothing to clear
      }
      return { allow: true };
    });
  }

  if (event === 'SessionEnd') {
    entries(dir).forEach(function (f) {
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

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (d) {
    raw += d;
  });
  process.stdin.on('error', function () {
    process.exit(0);
  });
  process.stdin.on('end', function () {
    let decision = { allow: true };
    try {
      decision = handle(JSON.parse(raw), process.env);
    } catch (e) {
      // Fail open; the error code only (a message could name a path).
      process.stderr.write('dispatch-limit: skipped (' + ((e && e.code) || 'error') + ')\n');
      process.exit(0);
    }
    if (decision.deny) {
      process.stderr.write(decision.deny + '\n');
      process.exit(2);
    }
    process.exit(0);
  });
}

module.exports = { handle, census, sessionSpend, maxSubagents, tokenBudget, stateRoot, sessionDir };

if (require.main === module) main();
