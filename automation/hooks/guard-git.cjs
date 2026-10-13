#!/usr/bin/env node
'use strict';
// PreToolUse hook for the Bash tool (lessons L15, L38): blocks git commands that
// move HEAD or clobber the tree of a checkout the agent does not own, and the
// shared-stash commands that can take another session's entry.
//
// "Own" checkout: the linked worktree that contains the session's cwd (the
// `cwd` field of the hook input). A command is refused when its effective
// directory (after `cd`, `pushd`, `git -C`) resolves to:
//   - a primary checkout (a directory whose `.git` is a directory), such as
//     the main checkout every session and the operator share; or
//   - a linked worktree other than the one the session's cwd is in.
// Everything else is allowed, including read-only git, fetch, merge, commit,
// push, `git worktree add`, and `git checkout -- <path>`.
//
// Failure policy: an internal error in this script allows the command (exit
// 0) so a broken guard cannot brick every Bash call; a git command this
// script cannot parse, or whose target directory it cannot resolve, is
// refused (exit 2). The operator can switch the guard off for a session by
// starting Claude Code with GYMCOACH_GIT_GUARD=off in its environment; an
// assignment inside the command itself has no effect.
//
// Written for old Node too (no optional chaining): the hook may run under
// whatever `node` is first on PATH. CommonJS for the same reason: it runs with
// plain `node`, without a loader or a build step.

/* eslint-disable @typescript-eslint/no-require-imports */
var fs = require('fs');
var path = require('path');
var os = require('os');

var GUARDED = { checkout: true, switch: true, reset: true, clean: true };
var SAFE_STASH = { list: true, show: true, apply: true, create: true, store: true, branch: false };

// --- Tokenizer -------------------------------------------------------------

// Splits a shell command into tokens. Operators (&&, ||, ;, |, &, newline,
// parentheses, `$(`) become separate operator tokens. Returns null when the
// quoting is unbalanced.
function tokenize(input) {
  var tokens = [];
  var cur = '';
  var has = false; // a word is in progress (even an empty quoted one)
  var dynamic = false; // the word contains $ or ` (expansion we cannot resolve)
  var i = 0;
  function push() {
    if (has) tokens.push({ t: 'w', v: cur, dyn: dynamic });
    cur = '';
    has = false;
    dynamic = false;
  }
  while (i < input.length) {
    var c = input[i];
    if (c === '\\') {
      if (i + 1 < input.length) {
        if (input[i + 1] !== '\n') {
          cur += input[i + 1];
          has = true;
        }
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (c === "'") {
      var end = input.indexOf("'", i + 1);
      if (end < 0) return null;
      cur += input.slice(i + 1, end);
      has = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      var j = i + 1;
      var buf = '';
      var closed = false;
      while (j < input.length) {
        var d = input[j];
        if (d === '\\' && j + 1 < input.length && '"\\$`'.indexOf(input[j + 1]) >= 0) {
          buf += input[j + 1];
          j += 2;
          continue;
        }
        if (d === '"') {
          closed = true;
          break;
        }
        if (d === '$' || d === '`') dynamic = true;
        buf += d;
        j++;
      }
      if (!closed) return null;
      cur += buf;
      has = true;
      i = j + 1;
      continue;
    }
    if (c === '$' && input[i + 1] === '(') {
      push();
      tokens.push({ t: 'op', v: '(' });
      i += 2;
      continue;
    }
    if (c === '$' || c === '`') {
      dynamic = true;
      cur += c;
      has = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t') {
      push();
      i++;
      continue;
    }
    if (c === '#' && !has) {
      // Comment to end of line.
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }
    if (c === '\n' || c === ';' || c === '(' || c === ')') {
      push();
      tokens.push({ t: 'op', v: c === '\n' ? ';' : c });
      i++;
      continue;
    }
    if (c === '&' || c === '|') {
      push();
      if (input[i + 1] === c) {
        tokens.push({ t: 'op', v: c + c });
        i += 2;
      } else {
        // `2>&1` style redirections: a lone & right after > is part of a redirect.
        tokens.push({ t: 'op', v: c });
        i++;
      }
      continue;
    }
    if (c === '<' && input[i + 1] === '<' && input[i + 2] !== '<') {
      // Here-document: skip the delimiter and the body, which is data.
      if (/^[0-9]+$/.test(cur)) {
        cur = '';
        has = false;
      }
      push();
      i += 2;
      var strip = false;
      if (input[i] === '-') {
        strip = true;
        i++;
      }
      while (input[i] === ' ' || input[i] === '\t') i++;
      var delim = '';
      while (i < input.length && ' \t\n;&|()<>'.indexOf(input[i]) < 0) {
        if (input[i] !== "'" && input[i] !== '"' && input[i] !== '\\') delim += input[i];
        i++;
      }
      if (!delim) return null;
      // The rest of this line is still commands; the body starts after it.
      var nl = input.indexOf('\n', i);
      var lineRest = nl < 0 ? input.slice(i) : input.slice(i, nl);
      var restTokens = tokenize(lineRest);
      if (restTokens === null) return null;
      for (var r = 0; r < restTokens.length; r++) tokens.push(restTokens[r]);
      if (nl < 0) return tokens;
      var pos = nl + 1;
      var found = false;
      while (pos <= input.length) {
        var eol = input.indexOf('\n', pos);
        var line = eol < 0 ? input.slice(pos) : input.slice(pos, eol);
        if ((strip ? line.replace(/^\t+/, '') : line) === delim) {
          found = true;
          pos = eol < 0 ? input.length : eol;
          break;
        }
        if (eol < 0) break;
        pos = eol + 1;
      }
      if (!found) return null;
      i = pos;
      continue;
    }
    if (c === '>' || c === '<') {
      // Redirection: drop the operator, its fd number and its target word.
      if (/^[0-9]+$/.test(cur)) {
        cur = '';
        has = false;
      }
      push();
      i++;
      if (input[i] === c || input[i] === '&') i++;
      while (input[i] === ' ') i++;
      while (i < input.length && ' \t\n;&|()'.indexOf(input[i]) < 0) i++;
      continue;
    }
    cur += c;
    has = true;
    i++;
  }
  push();
  return tokens;
}

// Groups tokens into simple commands, each with the directory in effect.
// Returns null if a directory change could not be resolved statically and a
// later git command depends on it (signalled by dir === null).
function commandsOf(tokens, cwd, home) {
  var out = [];
  var stack = [];
  var dir = cwd;
  var words = [];
  function flush() {
    if (words.length) handle(words);
    words = [];
  }
  function handle(ws) {
    var k = 0;
    // Skip env assignments and wrappers.
    while (k < ws.length) {
      var w = ws[k].v;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
        k++;
        continue;
      }
      if (
        w === 'env' ||
        w === 'command' ||
        w === 'time' ||
        w === 'nohup' ||
        w === 'sudo' ||
        w === 'exec'
      ) {
        k++;
        continue;
      }
      break;
    }
    var rest = ws.slice(k);
    if (!rest.length) return;
    var name = path.basename(rest[0].v);
    if (name === 'cd' || name === 'pushd') {
      var arg = rest[1];
      if (!arg) dir = home;
      else if (
        arg.dyn ||
        arg.v === '-' ||
        (arg.v.charAt(0) === '~' && arg.v !== '~' && arg.v.indexOf('~/') !== 0)
      )
        dir = null;
      else if (arg.v === '~') dir = home;
      else if (arg.v.indexOf('~/') === 0) dir = path.join(home, arg.v.slice(2));
      else dir = dir === null ? null : path.resolve(dir, arg.v);
      return;
    }
    if (
      (name === 'bash' || name === 'sh' || name === 'zsh') &&
      rest[1] &&
      rest[1].v === '-c' &&
      rest[2]
    ) {
      var inner = tokenize(rest[2].v);
      if (inner === null) {
        out.push({ unparsable: true, text: rest[2].v, dir: dir });
        return;
      }
      var nested = commandsOf(inner, dir === null ? cwd : dir, home);
      for (var n = 0; n < nested.length; n++) {
        if (dir === null) nested[n].dir = null;
        out.push(nested[n]);
      }
      return;
    }
    if (name === 'git') out.push({ argv: rest.slice(1), dir: dir });
  }
  for (var i = 0; i < tokens.length; i++) {
    var tk = tokens[i];
    if (tk.t === 'w') {
      words.push(tk);
      continue;
    }
    flush();
    if (tk.v === '(') stack.push(dir);
    else if (tk.v === ')') dir = stack.length ? stack.pop() : dir;
    else if (tk.v === '|' || tk.v === '&') {
      // A pipeline member or background job runs in a subshell for cd purposes
      // only when grouped; keep dir as is (conservative).
    }
  }
  flush();
  return out;
}

// --- Git command classification --------------------------------------------

// Parses git's global options; returns { sub, args, dirs, unknownTarget }.
function parseGit(argv) {
  var dirs = [];
  var unknownTarget = false;
  var i = 0;
  while (i < argv.length) {
    var w = argv[i];
    if (w.v === '-C') {
      if (!argv[i + 1]) return { sub: null, args: [], dirs: dirs, unknownTarget: true };
      if (argv[i + 1].dyn) unknownTarget = true;
      dirs.push(argv[i + 1].v);
      i += 2;
      continue;
    }
    if (w.v === '-c') {
      i += 2;
      continue;
    }
    if (/^--(git-dir|work-tree)(=|$)/.test(w.v)) {
      unknownTarget = true;
      i += w.v.indexOf('=') >= 0 ? 1 : 2;
      continue;
    }
    if (/^--(namespace|exec-path|super-prefix|config-env)(=|$)/.test(w.v)) {
      i += w.v.indexOf('=') >= 0 ? 1 : 2;
      continue;
    }
    if (w.v.charAt(0) === '-') {
      i++;
      continue;
    }
    break;
  }
  return {
    sub: i < argv.length ? argv[i].v : null,
    args: argv.slice(i + 1).map(function (a) {
      return a.v;
    }),
    dirs: dirs,
    unknownTarget: unknownTarget,
  };
}

// Returns a reason string when the subcommand moves HEAD or clobbers the tree
// (location-dependent), or { stash: reason } for the shared stash stack
// (refused everywhere), or null when harmless.
function classify(sub, args) {
  if (sub === 'stash') {
    var action = args[0];
    if (
      action === undefined ||
      (action.charAt(0) === '-' && action !== '-m' && action !== '--message')
    ) {
      if (args.indexOf('-m') >= 0 || args.indexOf('--message') >= 0) return null;
      return { stash: 'a bare `git stash`' };
    }
    if (action === 'push' || action === 'save') {
      if (action === 'push' && (args.indexOf('-m') >= 0 || args.indexOf('--message') >= 0))
        return null;
      if (action === 'save' && args.length > 1) return null;
      return { stash: '`git stash ' + action + '` without a message' };
    }
    if (action === '-m' || action === '--message') return null;
    if (action === 'pop' || action === 'drop' || action === 'clear') {
      return { stash: '`git stash ' + action + '`' };
    }
    if (SAFE_STASH[action]) return null;
    return null;
  }
  if (!GUARDED[sub]) return null;
  if (args.indexOf('-h') >= 0 || args.indexOf('--help') >= 0) return null;
  if (sub === 'checkout') {
    if (args.length === 0) return null;
    // Pathspec mode: `git checkout [<tree-ish>] -- <paths>` only touches files.
    if (args.indexOf('--') >= 0 && args.indexOf('-b') < 0 && args.indexOf('-B') < 0) return null;
    return '`git checkout` moves HEAD (use `git restore <path>` or `git checkout -- <path>` for files)';
  }
  if (sub === 'switch') return '`git switch` moves HEAD';
  if (sub === 'reset') {
    var flags = args.filter(function (a) {
      return a.charAt(0) === '-';
    });
    var dashdash = args.indexOf('--');
    var positional = args.filter(function (a, idx) {
      return a.charAt(0) !== '-' && (dashdash < 0 || idx < dashdash);
    });
    var moving = flags.some(function (f) {
      return f === '--hard' || f === '--keep' || f === '--merge' || f === '--soft';
    });
    if (moving) return '`git reset ' + flags.join(' ') + '` moves the branch or clobbers the tree';
    if (dashdash >= 0) return null; // `git reset [HEAD] -- <paths>` unstages files
    if (positional.length === 0) return null;
    return '`git reset <commit>` moves the branch (use `git restore --staged <path>` to unstage)';
  }
  if (sub === 'clean') {
    var force = args.some(function (a) {
      return a === '--force' || /^-[a-zA-Z]*f/.test(a);
    });
    return force ? '`git clean -f` deletes untracked files' : null;
  }
  return null;
}

// --- Checkout ownership ----------------------------------------------------

// Walks up from dir to the nearest `.git`; returns { top, kind } where kind
// is 'primary' (`.git` is a directory) or 'linked' (`.git` is a file), or
// null outside any repository.
function findTop(dir) {
  var d = dir;
  // Start from the nearest existing ancestor.
  while (d && !exists(d)) {
    var parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  while (d) {
    var g = path.join(d, '.git');
    var st = statOrNull(g);
    if (st) return { top: d, kind: st.isDirectory() ? 'primary' : 'linked' };
    var up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}

function exists(p) {
  return statOrNull(p) !== null;
}
function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

// --- Decision --------------------------------------------------------------

var ADVICE =
  'Work in your own worktree instead: `git worktree add <scratch-path> <ref>` (or the Agent ' +
  'isolation worktree), and to read a PR use `git show <sha>:<path>`, `git diff`, or ' +
  '`bash automation/review/snapshot.sh <pr>` (lessons L15, L38).';

function decide(input, opts) {
  opts = opts || {};
  var top = opts.findTop || findTop;
  var home = opts.home || os.homedir();
  var command =
    input && input.tool_input && typeof input.tool_input.command === 'string'
      ? input.tool_input.command
      : '';
  var cwd = input && typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  if (!/\bgit\b/.test(command)) return { allow: true };

  var tokens = tokenize(command);
  if (tokens === null) {
    return {
      deny:
        'the command has unbalanced quotes around a git call, so the guard cannot check it. ' +
        ADVICE,
    };
  }
  var cmds = commandsOf(tokens, cwd, home);
  var own = top(cwd);
  for (var i = 0; i < cmds.length; i++) {
    var c = cmds[i];
    if (c.unparsable) {
      if (/\bgit\b/.test(c.text)) {
        return { deny: 'a nested shell command around git could not be parsed. ' + ADVICE };
      }
      continue;
    }
    var g = parseGit(c.argv);
    var verdict = classify(g.sub, g.args);
    if (!verdict) continue;
    if (typeof verdict === 'object' && verdict.stash) {
      return {
        deny:
          verdict.stash +
          ' acts on the stash stack that every worktree and session shares, so it can take or drop ' +
          "another session's entry. Use a WIP commit, or `git stash push -m <unique-tag>` then " +
          '`git stash apply <sha>`.',
      };
    }
    if (c.dir === null || g.unknownTarget) {
      return {
        deny: verdict + ', and the guard cannot tell which checkout it would run in. ' + ADVICE,
      };
    }
    var target = c.dir;
    for (var k = 0; k < g.dirs.length; k++) target = path.resolve(target, g.dirs[k]);
    var t = top(target);
    if (!t) continue; // not a repository: git will fail on its own
    if (t.kind === 'primary') {
      return {
        deny:
          verdict +
          ' in ' +
          t.top +
          ', a primary checkout shared by every session and the operator. ' +
          ADVICE,
      };
    }
    if (!own || own.top !== t.top) {
      return {
        deny:
          verdict +
          ' in the worktree ' +
          t.top +
          ', which is not the worktree this session works in' +
          (own ? ' (' + own.top + ')' : '') +
          '. ' +
          ADVICE,
      };
    }
  }
  return { allow: true };
}

function main() {
  if ((process.env.GYMCOACH_GIT_GUARD || '').toLowerCase() === 'off') process.exit(0);
  var raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (d) {
    raw += d;
  });
  process.stdin.on('end', function () {
    try {
      var input = JSON.parse(raw || '{}');
      if (input.tool_name && input.tool_name !== 'Bash') process.exit(0);
      var res = decide(input);
      if (res.deny) {
        process.stderr.write('Blocked by the git guard: ' + res.deny + '\n');
        process.exit(2);
      }
      process.exit(0);
    } catch (e) {
      // Fail open on a bug in the guard itself, never on a git command it
      // could parse but judged unsafe.
      process.stderr.write('git guard error (command allowed): ' + (e && e.message) + '\n');
      process.exit(0);
    }
  });
}

module.exports = {
  tokenize: tokenize,
  commandsOf: commandsOf,
  parseGit: parseGit,
  classify: classify,
  decide: decide,
  findTop: findTop,
};

if (require.main === module) main();
