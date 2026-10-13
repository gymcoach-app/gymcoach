#!/usr/bin/env node
'use strict';
// Run-time usage ledger (roadmap milestone 1). Claude Code runs this hook on
// three events and it appends at most ONE line per event to a local ledger
// that lives OUTSIDE the repository:
//
//   SubagentStop      one "agent" line: the finished subagent's usage, read
//                     from its own transcript (agent_transcript_path)
//   SessionEnd        one "session" line: the main session's own usage
//   UserPromptSubmit  one "prompt" line: that a prompt arrived, and whether it
//                     was a harness notification or anything else
//
// Ledger: ${GYMCOACH_USAGE_LEDGER_PATH} if set, else
// ${XDG_DATA_HOME:-~/.local/share}/gymcoach-runs/ledger.jsonl. Starting Claude
// Code with GYMCOACH_USAGE_LEDGER=off disables it.
//
// Privacy: transcripts and prompts are read in memory only. A line holds
// numbers, model ids (allowlisted), skill names, public PR numbers, random
// agent ids, and SHA-256 prefixes of the session id and of worktree branch
// names. Never prompt or message text, tool output, paths or branch names.
//
// Failure policy: fail open. Any error ends the hook with exit 0 and no line;
// it never blocks or alters the agent, and it prints nothing on stdout
// (UserPromptSubmit stdout would be added to the conversation). The line is
// written with one appendFileSync call (O_APPEND), so concurrent hooks do not
// interleave within a line.
//
// The token rules mirror automation/usage/build.ts (parseTranscript), and a
// test asserts parity: one entry per API response id at its final usage, an
// unrecorded count is unknown (null here), never 0, and only `claude-*` model
// ids are kept (anything else is "other", which has no price).
//
// Written for old Node too (no optional chaining or ??): the hook runs with
// whatever `node` is first on PATH.

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LEDGER_VERSION = 1;
const NEUTRAL_BRANCH = /^(main|master|HEAD|worktree-agent-[0-9a-f]+)$/;
const WORKTREE_DIR = '/.claude/worktrees/';
const MODEL_ID = /^claude-[a-z0-9.-]+$/;
const SKILL_NAME = /^[a-z0-9][a-z0-9:-]*$/;
const VERSION = /^[0-9][0-9A-Za-z.+-]*$/;
const KINDS = ['input', 'output', 'cacheRead', 'cacheCreation5m', 'cacheCreation1h'];
// How long an agent line waits for the subagent transcript's final write.
const FLUSH_WAIT_MS = 2000;
const SETTLE_MS = 150;

function transcriptSize(file) {
  if (typeof file !== 'string') return -1;
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
}

// The transcript is done when it held at least one response and did not grow
// between two reads SETTLE_MS apart. A first read (no previous size) is never
// settled, so the hook always looks twice.
function settled(previousSize, size, responses) {
  return responses > 0 && previousSize >= 0 && size === previousSize;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function count(value) {
  return typeof value === 'number' && isFinite(value) ? value : NaN;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(function (b) {
      return b && b.type === 'text' ? b.text || '' : '';
    })
    .join('\n');
}

function numbers(text, pattern) {
  const out = new Set();
  let m;
  const re = new RegExp(pattern.source, 'g');
  while ((m = re.exec(text)) !== null) out.add(Number(m[1]));
  return out;
}

// Response ids of the assistant records in a transcript, without parsing the
// lines that cannot hold one (a parent transcript can be large).
function responseIds(lines) {
  const ids = new Set();
  for (const line of lines) {
    if (line.indexOf('"assistant"') === -1) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r && r.type === 'assistant' && r.message && typeof r.message.id === 'string')
      ids.add(r.message.id);
  }
  return ids;
}

// Pure: transcript lines in, a summary out. `exclude` holds response ids to
// leave out (a fork's transcript starts with a copy of its parent's turn,
// which the parent's transcript already counts).
function summarize(lines, kind, exclude) {
  const s = {
    responses: new Map(),
    firstAt: null,
    lastAt: null,
    branches: new Set(),
    pullRefs: new Set(),
    prRefs: new Set(),
    skills: new Set(),
    prLinks: new Set(),
    dropped: 0,
    inherited: 0,
    forked: false,
    version: null,
  };
  let promptSeen = false;
  // A copied response can be logged once per streamed block: count it once.
  const inheritedIds = new Set();
  for (const line of lines) {
    if (!line || !line.trim()) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (!r || typeof r !== 'object') continue;
    if (r.type === 'fork-context-ref') s.forked = true;
    if (typeof r.version === 'string' && VERSION.test(r.version)) s.version = r.version;
    const at = typeof r.timestamp === 'string' ? r.timestamp : null;
    if (at) {
      if (!s.firstAt || at < s.firstAt) s.firstAt = at;
      if (!s.lastAt || at > s.lastAt) s.lastAt = at;
    }
    const inWorktree = typeof r.cwd === 'string' && r.cwd.indexOf(WORKTREE_DIR) !== -1;
    if (
      inWorktree &&
      typeof r.gitBranch === 'string' &&
      r.gitBranch &&
      !NEUTRAL_BRANCH.test(r.gitBranch)
    )
      s.branches.add(r.gitBranch);
    if (r.type === 'pr-link' && typeof r.prNumber === 'number') s.prLinks.add(r.prNumber);
    const message = r.message && typeof r.message === 'object' ? r.message : null;
    if (r.type === 'user' && kind === 'subagent' && !promptSeen && !r.isMeta) {
      // The first user turn of a subagent is its task prompt: PR numbers only.
      promptSeen = true;
      const text = textOf(message ? message.content : null);
      s.pullRefs = numbers(text, /\bpull\/(\d+)\/head\b/);
      s.prRefs = numbers(text, /\bPR #(\d+)\b/);
    }
    if (r.type !== 'assistant' || !message) continue;
    if (!message.id || !message.usage || !message.model) {
      s.dropped += 1;
      continue;
    }
    if (exclude && exclude.has(message.id)) {
      inheritedIds.add(message.id);
      s.inherited = inheritedIds.size;
      continue;
    }
    if (Array.isArray(message.content))
      for (const b of message.content)
        if (
          b &&
          b.type === 'tool_use' &&
          b.name === 'Skill' &&
          b.input &&
          typeof b.input.skill === 'string'
        )
          if (SKILL_NAME.test(b.input.skill)) s.skills.add(b.input.skill);
    const u = message.usage;
    const split = u.cache_creation;
    const noWrite = !split && u.cache_creation_input_tokens === 0;
    const t = {
      model: MODEL_ID.test(message.model) ? message.model : 'other',
      speed: typeof u.speed === 'string' ? u.speed : null,
      input: count(u.input_tokens),
      output: count(u.output_tokens),
      cacheRead: count(u.cache_read_input_tokens),
      cacheCreation5m: noWrite ? 0 : count(split ? split.ephemeral_5m_input_tokens : undefined),
      cacheCreation1h: noWrite ? 0 : count(split ? split.ephemeral_1h_input_tokens : undefined),
    };
    // A response is logged once per streamed block; keep its final usage.
    const prev = s.responses.get(message.id);
    if (!prev || !(t.output < prev.output)) s.responses.set(message.id, t);
  }
  return s;
}

// Token sums per (model, speed). A kind with any unrecorded count is null.
function byModel(responses) {
  const groups = new Map();
  for (const t of responses.values()) {
    const key = t.model + '|' + (t.speed === null ? '' : t.speed);
    let g = groups.get(key);
    if (!g) {
      g = { model: t.model, speed: t.speed, responses: 0 };
      for (const k of KINDS) g[k] = 0;
      groups.set(key, g);
    }
    g.responses += 1;
    for (const k of KINDS) {
      if (g[k] === null) continue;
      g[k] = isNaN(t[k]) ? null : g[k] + t[k];
    }
  }
  return Array.from(groups.values()).sort(function (a, b) {
    return a.model < b.model ? -1 : a.model > b.model ? 1 : 0;
  });
}

function sorted(set) {
  return Array.from(set).sort(function (a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function usageFields(s) {
  return {
    claudeVersion: s.version,
    firstAt: s.firstAt,
    lastAt: s.lastAt,
    responses: s.responses.size,
    droppedResponses: s.dropped,
    byModel: byModel(s.responses),
    skills: sorted(s.skills),
  };
}

function agentLine(input, s, inherited, at) {
  return Object.assign(
    {
      v: LEDGER_VERSION,
      kind: 'agent',
      at: at,
      sessionKey: hash(input.session_id),
      agentId:
        typeof input.agent_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(input.agent_id)
          ? input.agent_id
          : hash(input.agent_id),
      agentType:
        typeof input.agent_type === 'string' && /^[A-Za-z0-9:_-]{1,64}$/.test(input.agent_type)
          ? input.agent_type
          : null,
      branchHashes: sorted(s.branches).map(hash),
      pullRefs: sorted(s.pullRefs),
      prRefs: sorted(s.prRefs),
      // null: a fork whose parent transcript could not be read, so its copied
      // turn may also be counted on the parent's side.
      inheritedResponses: inherited,
    },
    usageFields(s),
  );
}

function sessionLine(input, s, at) {
  return Object.assign(
    {
      v: LEDGER_VERSION,
      kind: 'session',
      at: at,
      sessionKey: hash(input.session_id),
      prLinks: sorted(s.prLinks),
    },
    usageFields(s),
  );
}

// A prompt the harness generated (a background task finishing) versus any
// other prompt (the operator's, or a scripted `claude -p` prompt).
function promptSource(prompt) {
  return typeof prompt === 'string' && /^\s*<task-notification>/.test(prompt)
    ? 'notification'
    : 'other';
}

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n');
}

// Pure apart from reading the transcripts named in the input: hook input in,
// one ledger line (an object) or null out.
function lineFor(input, now) {
  const at = now || new Date().toISOString();
  const event = input && input.hook_event_name;
  if (event === 'UserPromptSubmit')
    return {
      v: LEDGER_VERSION,
      kind: 'prompt',
      at: at,
      sessionKey: hash(input.session_id),
      source: promptSource(input.prompt),
    };
  if (event === 'SubagentStop') {
    if (typeof input.agent_transcript_path !== 'string') return null;
    const lines = readLines(input.agent_transcript_path);
    const forked = lines.slice(0, 5).some(function (l) {
      return l.indexOf('"fork-context-ref"') !== -1;
    });
    let exclude = null;
    let inherited = 0;
    if (forked) {
      try {
        exclude = responseIds(readLines(input.transcript_path));
      } catch {
        inherited = null;
      }
    }
    const s = summarize(lines, 'subagent', exclude);
    return agentLine(input, s, inherited === null ? null : s.inherited, at);
  }
  if (event === 'SessionEnd') {
    if (typeof input.transcript_path !== 'string') return null;
    return sessionLine(input, summarize(readLines(input.transcript_path), 'main', null), at);
  }
  return null;
}

function ledgerPath(env) {
  if (env.GYMCOACH_USAGE_LEDGER_PATH) return env.GYMCOACH_USAGE_LEDGER_PATH;
  const base = env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'gymcoach-runs', 'ledger.jsonl');
}

function main() {
  try {
    if ((process.env.GYMCOACH_USAGE_LEDGER || '').toLowerCase() === 'off') process.exit(0);
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function (d) {
      raw += d;
    });
    process.stdin.on('end', function () {
      let input;
      try {
        input = JSON.parse(raw);
      } catch {
        process.exit(0);
      }
      // SubagentStop fires a few tens of milliseconds BEFORE Claude Code
      // writes the subagent's last records (observed on 2.1.296: the
      // transcript's final write lands ~40 ms after the hook starts), so a
      // first read can miss the last response, or see none at all. For an
      // agent line, wait until the transcript stops growing (two sizes
      // SETTLE_MS apart are equal) and holds at least one response, for at
      // most FLUSH_WAIT_MS, then record what is there.
      const deadline = Date.now() + FLUSH_WAIT_MS;
      const transcript =
        input && input.hook_event_name === 'SubagentStop' ? input.agent_transcript_path : null;
      let lastSize = -1;
      (function attempt() {
        try {
          const line = lineFor(input);
          const size = transcriptSize(transcript);
          const waiting =
            line &&
            line.kind === 'agent' &&
            !settled(lastSize, size, line.responses) &&
            Date.now() < deadline;
          lastSize = size;
          if (waiting) {
            setTimeout(attempt, SETTLE_MS);
            return;
          }
          if (line) {
            const file = ledgerPath(process.env);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.appendFileSync(file, JSON.stringify(line) + '\n');
          }
        } catch (e) {
          // The error code only: a message could name a path.
          process.stderr.write('record-usage: skipped (' + ((e && e.code) || 'error') + ')\n');
        }
        process.exit(0);
      })();
    });
  } catch {
    process.exit(0);
  }
}

module.exports = {
  summarize,
  byModel,
  lineFor,
  responseIds,
  promptSource,
  ledgerPath,
  hash,
  settled,
  LEDGER_VERSION,
};

if (require.main === module) main();
