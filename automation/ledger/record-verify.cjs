#!/usr/bin/env node
'use strict';
// Run-time record of one green-gate run (roadmap milestone 1: verification
// evidence and attempts per run). scripts/verify.sh calls this once, from its
// exit handler, and it appends ONE "verify" line to the same local ledger the
// usage hook writes (automation/hooks/record-usage.cjs):
//
//   ${GYMCOACH_USAGE_LEDGER_PATH} if set, else
//   ${XDG_DATA_HOME:-~/.local/share}/gymcoach-runs/ledger.jsonl
//
// GYMCOACH_USAGE_LEDGER=off disables it, like the hook.
//
//   node automation/ledger/record-verify.cjs --root <repo> --tier default|full \
//     --exit <code> --started <epoch ms> --steps "<name>|<outcome>|<ms>;..."
//
// Privacy: the line holds numbers, step names from a fixed list, commit and
// tree SHAs, and 16-hex SHA-256 prefixes of the branch name and of the Claude
// Code session id; never the branch name, paths, command output or text.
//
// The tree SHA is what makes the record useful: verify.sh usually runs on an
// uncommitted change, so HEAD alone does not say what was checked. For a dirty
// tree the tree SHA is computed with a temporary index (read-tree HEAD, add
// -A, write-tree): it writes blob and tree objects to the object store, which
// git gc collects if nothing references them, and changes no ref and not the
// real index. It is the tree a commit of the checked files would have, so a
// PR head with the same tree had exactly that content verified.
//
// Failure policy: fail open. Any error ends with exit 0 and no line; this
// script never changes the gate's outcome (verify.sh ignores its exit code
// anyway). Written for old Node too (no optional chaining or ??).

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const VERIFY_LINE_VERSION = 1;
const STEP_NAMES = [
  'slot',
  'prisma',
  'lint',
  'typecheck',
  'unit',
  'script-tests',
  'build',
  'infra-lock',
  'test-db',
  'integration',
  'e2e',
];
const OUTCOMES = ['passed', 'failed', 'interrupted'];
const SHA = /^[0-9a-f]{40}$/;
const GIT_TIMEOUT_MS = 20000;

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

// "name|outcome|ms;..." -> [{ name, outcome, ms }]. Anything outside the fixed
// step list or outcome list makes the whole field invalid, so a caller cannot
// smuggle text into the ledger through it.
function parseSteps(raw) {
  if (typeof raw !== 'string' || raw === '') return [];
  return raw
    .split(';')
    .filter(Boolean)
    .map(function (part) {
      const f = part.split('|');
      const ms = Number(f[2]);
      if (
        f.length !== 3 ||
        STEP_NAMES.indexOf(f[0]) === -1 ||
        OUTCOMES.indexOf(f[1]) === -1 ||
        !/^[0-9]+$/.test(f[2]) ||
        !isFinite(ms)
      ) {
        throw new Error('invalid step');
      }
      return { name: f[0], outcome: f[1], ms: ms };
    });
}

function makeGit(root) {
  return function git(args, env) {
    return childProcess
      .execFileSync('git', ['-C', root].concat(args), {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GIT_TIMEOUT_MS,
        env: env || process.env,
      })
      .trim();
  };
}

function orNull(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

// What was checked: HEAD, branch, dirty or not, and the tree of the checked
// files. Each value is null when git cannot tell.
function gitState(git) {
  const headSha = orNull(function () {
    const s = git(['rev-parse', '--verify', '-q', 'HEAD']);
    return SHA.test(s) ? s : null;
  });
  const branch = orNull(function () {
    return git(['symbolic-ref', '-q', '--short', 'HEAD']) || null;
  });
  const dirty = orNull(function () {
    return git(['status', '--porcelain', '--untracked-files=normal']) !== '';
  });
  let treeSha = null;
  if (headSha !== null && dirty === false) {
    treeSha = orNull(function () {
      return git(['rev-parse', 'HEAD^{tree}']);
    });
  } else if (headSha !== null && dirty === true) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gymcoach-verify-index-'));
    try {
      const env = Object.assign({}, process.env, { GIT_INDEX_FILE: path.join(dir, 'index') });
      treeSha = orNull(function () {
        git(['read-tree', 'HEAD'], env);
        git(['add', '-A'], env);
        return git(['write-tree'], env);
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return {
    headSha: headSha,
    branchHash: branch === null ? null : hash(branch),
    dirty: dirty,
    treeSha: treeSha !== null && SHA.test(treeSha) ? treeSha : null,
  };
}

// Pure apart from the injected git state: options in, the ledger line out.
function buildLine(opts, state, env, nowIso) {
  if (opts.tier !== 'default' && opts.tier !== 'full') throw new Error('invalid tier');
  const exit = Number(opts.exit);
  if (!/^[0-9]+$/.test(String(opts.exit)) || exit > 255) throw new Error('invalid exit');
  const started = Number(opts.started);
  const startedAt =
    /^[0-9]+$/.test(String(opts.started)) && isFinite(started)
      ? new Date(started).toISOString()
      : null;
  const session = env.CLAUDE_CODE_SESSION_ID;
  return {
    v: VERIFY_LINE_VERSION,
    kind: 'verify',
    at: nowIso,
    startedAt: startedAt,
    // Same 16-hex prefix the usage hook records for this session id.
    sessionKey: typeof session === 'string' && session ? hash(session) : null,
    inClaudeCode: env.CLAUDECODE === '1',
    tier: opts.tier,
    exit: exit,
    steps: parseSteps(opts.steps),
    headSha: state.headSha,
    treeSha: state.treeSha,
    dirty: state.dirty,
    branchHash: state.branchHash,
  };
}

function ledgerPath(env) {
  if (env.GYMCOACH_USAGE_LEDGER_PATH) return env.GYMCOACH_USAGE_LEDGER_PATH;
  const base = env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'gymcoach-runs', 'ledger.jsonl');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!/^--[a-z]+$/.test(key) || i + 1 >= argv.length) throw new Error('invalid arguments');
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

function main() {
  try {
    if ((process.env.GYMCOACH_USAGE_LEDGER || '').toLowerCase() === 'off') return;
    const opts = parseArgs(process.argv.slice(2));
    if (!opts.root) throw new Error('no root');
    const line = buildLine(
      opts,
      gitState(makeGit(opts.root)),
      process.env,
      new Date().toISOString(),
    );
    const file = ledgerPath(process.env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(line) + '\n');
  } catch (e) {
    // The error code only: a message could name a path.
    process.stderr.write('record-verify: skipped (' + ((e && e.code) || 'error') + ')\n');
  }
}

module.exports = {
  parseSteps,
  gitState,
  makeGit,
  buildLine,
  ledgerPath,
  parseArgs,
  hash,
  STEP_NAMES,
  VERIFY_LINE_VERSION,
};

if (require.main === module) main();
