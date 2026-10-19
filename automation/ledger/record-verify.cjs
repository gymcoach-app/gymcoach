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
//     --exit <code>|none --started <epoch ms> --steps "<name>|<outcome>|<ms>;..." \
//     --start-tree <sha>|none
//   node automation/ledger/record-verify.cjs --tree-only <repo>
//
// --tree-only prints the tree of the files as they are now (or nothing) and
// writes no line: verify.sh calls it once before the first step, and passes the
// result back as --start-tree at exit. --exit none means the exit status is not
// known: the shell died from a signal while a step was running (its EXIT trap
// sees the last command's status, not the signal).
//
// Privacy: the line holds numbers, step names from a fixed list, commit and
// tree SHAs, and 16-hex SHA-256 prefixes of the branch name and of the Claude
// Code session id; never the branch name, paths, command output or text.
//
// The tree SHA is what makes the record useful: verify.sh usually runs on an
// uncommitted change, so HEAD alone does not say what was checked. For a dirty
// tree the tree SHA is computed with a temporary index (a copy of the real
// index, else read-tree HEAD; then add -A and write-tree): it writes blob and
// tree objects to the object store, which git gc collects if nothing
// references them, and changes no ref and not the real index (the dirty check
// runs with --no-optional-locks, so it takes no index.lock either). It is the
// tree a commit of the files would have. The tree is taken twice, before the
// first step and at exit, and recorded only when both are equal: an edit made
// while the gate ran (agents often keep editing while it runs in the
// background) leaves treeSha null and treeChanged true, because the start and
// exit trees differ. Equal trees do not prove that nothing
// changed in between: an edit reverted before exit (or a stash or checkout
// round trip) leaves them equal although some steps saw other content. With
// that caveat, a PR head with a recorded tree had that content verified, at
// the steps the line lists.
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
  const git = function (args, env) {
    return childProcess
      .execFileSync('git', ['-C', root].concat(args), {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GIT_TIMEOUT_MS,
        env: env || process.env,
      })
      .trim();
  };
  git.root = root;
  return git;
}

// The repository root a git runner works in (rev-parse --git-path is relative
// to it); the current directory for an injected test runner without one.
function repoRoot(git) {
  return git.root || process.cwd();
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
    return git(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=normal']) !== '';
  });
  let treeSha = null;
  if (headSha !== null && dirty === false) {
    treeSha = orNull(function () {
      return git(['rev-parse', 'HEAD^{tree}']);
    });
  } else if (headSha !== null && dirty === true) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gymcoach-verify-index-'));
    try {
      const index = path.join(dir, 'index');
      const env = Object.assign({}, process.env, { GIT_INDEX_FILE: index });
      treeSha = orNull(function () {
        // Seeding the temporary index with a copy of the real one keeps its
        // stat data, so add -A rehashes only the changed files. git replaces
        // the real index by rename, so the copy is never a half-written file.
        const seeded = orNull(function () {
          const real = path.resolve(repoRoot(git), git(['rev-parse', '--git-path', 'index']));
          fs.copyFileSync(real, index);
          return true;
        });
        if (seeded !== true) git(['read-tree', 'HEAD'], env);
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

// The start tree as passed back by verify.sh: a SHA, or null for "none".
function parseStartTree(raw) {
  if (raw === undefined || raw === 'none') return null;
  if (!SHA.test(String(raw))) throw new Error('invalid start tree');
  return raw;
}

// Pure apart from the injected git state: options in, the ledger line out.
// state.treeSha is the tree at exit; it is recorded only when it equals the
// tree taken before the first step.
function buildLine(opts, state, env, nowIso) {
  if (opts.tier !== 'default' && opts.tier !== 'full') throw new Error('invalid tier');
  let exit = null;
  if (opts.exit !== 'none') {
    exit = Number(opts.exit);
    if (!/^[0-9]+$/.test(String(opts.exit)) || exit > 255) throw new Error('invalid exit');
  }
  const startTree = parseStartTree(opts['start-tree']);
  const endTree = state.treeSha;
  const treeChanged = startTree === null || endTree === null ? null : startTree !== endTree;
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
    treeSha: treeChanged === false ? endTree : null,
    treeChanged: treeChanged,
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
    if (!/^--[a-z]+(-[a-z]+)*$/.test(key) || i + 1 >= argv.length) {
      throw new Error('invalid arguments');
    }
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

function main() {
  try {
    if ((process.env.GYMCOACH_USAGE_LEDGER || '').toLowerCase() === 'off') return;
    const argv = process.argv.slice(2);
    if (argv[0] === '--tree-only') {
      if (argv.length !== 2) throw new Error('invalid arguments');
      const tree = gitState(makeGit(argv[1])).treeSha;
      if (tree !== null) process.stdout.write(tree + '\n');
      return;
    }
    const opts = parseArgs(argv);
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
  parseStartTree,
  hash,
  STEP_NAMES,
  VERIFY_LINE_VERSION,
};

if (require.main === module) main();
