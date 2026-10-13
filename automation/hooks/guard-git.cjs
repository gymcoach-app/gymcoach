#!/usr/bin/env node
'use strict';
// PreToolUse hook for the Bash tool (lessons L15, L38): blocks git commands that
// move HEAD or clobber the tree of a checkout the agent does not own, and the
// shared-stash commands that can take another session's entry.
//
// Who is checked: Claude Code puts `agent_id` in the hook input of a
// SUBAGENT's tool call and leaves it out for the main session (checked live on
// Claude Code 2.1.296, the minimum version this guard assumes). `agent_type`
// is NOT used: Claude Code also sets it for a main session started with
// `claude --agent`. If a Claude Code version ever omits `agent_id` for a
// subagent, that subagent passes as a main session (fail open): the
// orchestrator's session-start canary (`--self-test` below, and the subagent
// probe in docs/loops/06-orchestration.md) is how that is caught. Every
// incident behind L15 and L38 was a subagent working in a checkout it did not
// own, so:
//   - a subagent may not move HEAD or clobber files in a primary checkout (a
//     directory whose `.git` is a directory, such as the main checkout every
//     session and the operator share), nor in a linked worktree other than
//     the one its cwd is in; nor remove another worktree or delete or force
//     a branch;
//   - the main session (the operator's, or the orchestrator's) may do so in a
//     primary checkout, but not in another session's linked worktree;
//   - nobody may pop, drop or take an untagged entry of the shared stash.
// "Own" checkout: the worktree that contains the `cwd` of the hook input.
// A subagent may also not pull, merge or amend a commit in a primary checkout.
// Everything else is allowed, including read-only git, fetch, commit, push,
// `git worktree add -b`, and restoring a single file.
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

var GUARDED = {
  checkout: true,
  switch: true,
  reset: true,
  clean: true,
  restore: true,
  rebase: true,
  'cherry-pick': true,
  am: true,
  revert: true,
  'update-ref': true,
  'symbolic-ref': true,
  'read-tree': true,
};
var SAFE_STASH = { list: true, show: true, create: true, store: true };
var SHELLS = { bash: true, sh: true, zsh: true, dash: true, ksh: true };
// Shell words that only open or close a compound command: the command that
// follows them still runs.
var KEYWORDS = {
  if: true,
  then: true,
  else: true,
  elif: true,
  fi: true,
  do: true,
  done: true,
  while: true,
  until: true,
  '{': true,
  '}': true,
  '!': true,
};
// Wrappers that run the command after their own options: name -> options that
// take a value (as separate words).
var WRAPPERS = {
  env: { '-u': true, '--unset': true, '-C': true, '--chdir': true, '-S': true },
  command: {},
  time: { '-f': true, '-o': true },
  nohup: {},
  exec: { '-a': true },
  sudo: { '-u': true, '-g': true, '-C': true, '-h': true, '-p': true, '-U': true, '-D': true },
  nice: { '-n': true, '--adjustment': true },
  ionice: { '-c': true, '-n': true, '-p': true },
  stdbuf: { '-i': true, '-o': true, '-e': true },
  timeout: { '-s': true, '--signal': true, '-k': true, '--kill-after': true },
  xargs: {
    '-I': true,
    '-n': true,
    '-L': true,
    '-P': true,
    '-d': true,
    '-a': true,
    '-E': true,
    '-s': true,
    '--max-args': true,
    '--max-procs': true,
    '--delimiter': true,
    '--arg-file': true,
  },
};
// Wrappers that take one positional argument before the command.
var WRAPPER_POSITIONAL = { timeout: 1 };
var GIT_ENV = /^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_COMMON_DIR)=/;

// --- Tokenizer -------------------------------------------------------------

// Splits a shell command into tokens. Operators (&&, ||, ;, |, &, newline,
// parentheses, `$(`) become separate operator tokens. Returns null when the
// quoting is unbalanced.
function tokenize(input, lenient) {
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
      if (end < 0) {
        if (!lenient) return null;
        end = input.length;
      }
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
      if (!closed && !lenient) return null;
      cur += buf;
      has = true;
      i = j + 1;
      continue;
    }
    if (c === '$' && input[i + 1] === '(') {
      push();
      tokens.push({ t: 'op', v: '(', sub: true });
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
      var restTokens = tokenize(lineRest, lenient);
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
      if (!found) {
        if (!lenient) return null;
        return tokens;
      }
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

// For `bash -c script`, `sh -ec script`, `bash -l -c script`: the script word,
// or null when the shell is not given a -c script.
function shellScript(rest) {
  var hasC = false;
  for (var i = 1; i < rest.length; i++) {
    var v = rest[i].v;
    if (v === '--') return null;
    if (/^-[A-Za-z]+$/.test(v)) {
      if (v.indexOf('c') >= 0) hasC = true;
      continue;
    }
    if (/^--[a-z-]+$/.test(v) || /^[+-]o$/.test(v)) {
      if (/^[+-]o$/.test(v)) i++;
      continue;
    }
    return hasC ? rest[i] : null;
  }
  return null;
}

// Groups tokens into simple commands, each with the directory in effect.
// Returns null if a directory change could not be resolved statically and a
// later git command depends on it (signalled by dir === null).
function commandsOf(tokens, cwd, home) {
  var out = [];
  var stack = [];
  var dir = cwd;
  var words = [];
  var exportedGitEnv = false; // `export GIT_DIR=...` earlier in the command
  function flush() {
    if (words.length) handle(words);
    words = [];
  }
  function handle(ws) {
    var k = 0;
    var gitEnv = exportedGitEnv;
    var viaXargs = false;
    // A wrapper's own chdir option (`env -C <dir>`, `sudo -D <dir>`) applies
    // to this command only.
    var cmdDir = dir;
    function chdirTo(word) {
      if (word.dyn) cmdDir = null;
      else cmdDir = cmdDir === null ? null : path.resolve(cmdDir, word.v);
    }
    // Skip shell keywords, env assignments and wrappers with their options.
    while (k < ws.length) {
      var w = ws[k].v;
      if (KEYWORDS[w]) {
        k++;
        continue;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
        if (GIT_ENV.test(w)) gitEnv = true;
        k++;
        continue;
      }
      var wrapper = WRAPPERS[path.basename(w)];
      if (wrapper) {
        var wname = path.basename(w);
        if (wname === 'xargs') viaXargs = true;
        k++;
        while (k < ws.length && ws[k].v.charAt(0) === '-' && ws[k].v !== '-') {
          var opt = ws[k].v;
          var chdirOpt =
            (wname === 'env' && (opt === '-C' || opt === '--chdir')) ||
            (wname === 'sudo' && (opt === '-D' || opt === '--chdir'));
          var chdirEq = /^--chdir=/.test(opt) && (wname === 'env' || wname === 'sudo');
          if (chdirEq) chdirTo({ v: opt.slice('--chdir='.length), dyn: ws[k].dyn });
          else if (wname === 'env' && /^-C.+/.test(opt))
            chdirTo({ v: opt.slice(2), dyn: ws[k].dyn });
          if (wrapper[opt]) {
            k++;
            if (chdirOpt && k < ws.length) chdirTo(ws[k]);
          }
          k++;
        }
        if (WRAPPER_POSITIONAL[wname]) k += WRAPPER_POSITIONAL[wname];
        continue;
      }
      break;
    }
    var rest = ws.slice(k);
    if (!rest.length) return;
    var name = path.basename(rest[0].v);
    if (name === 'export' || name === 'declare' || name === 'typeset') {
      for (var e = 1; e < rest.length; e++) if (GIT_ENV.test(rest[e].v)) exportedGitEnv = true;
      return;
    }
    if (name === 'cd' || name === 'pushd') {
      // Skip `cd -P`, `cd -L`, `cd -e`, `cd -@` and the `--` end of options.
      var ai = 1;
      while (ai < rest.length && /^-[PLe@]+$/.test(rest[ai].v)) ai++;
      if (ai < rest.length && rest[ai].v === '--') ai++;
      var arg = rest[ai];
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
    var script = SHELLS[name] ? shellScript(rest) : null;
    if (script) {
      var inner = tokenize(script.v);
      if (inner === null) {
        out.push({ unparsable: true, text: script.v, dir: dir });
        return;
      }
      var nested = commandsOf(inner, cmdDir === null ? cwd : cmdDir, home);
      for (var n = 0; n < nested.length; n++) {
        if (cmdDir === null) nested[n].dir = null;
        if (gitEnv) nested[n].gitEnv = true;
        out.push(nested[n]);
      }
      return;
    }
    if (name === 'git')
      out.push({ argv: rest.slice(1), dir: cmdDir, gitEnv: gitEnv, viaXargs: viaXargs });
  }
  for (var i = 0; i < tokens.length; i++) {
    var tk = tokens[i];
    if (tk.t === 'w') {
      words.push(tk);
      continue;
    }
    if (tk.v === '(' && tk.sub) {
      // `$(...)` inside a command: the substitution's own commands are checked
      // on their own, and the outer command keeps a word only known at run
      // time in its place (so `git $(echo switch) main` stays one git call).
      words.push({ t: 'w', v: '$(...)', dyn: true });
      stack.push({ dir: dir, words: words });
      words = [];
      continue;
    }
    flush();
    if (tk.v === '(') stack.push({ dir: dir, words: null });
    else if (tk.v === ')') {
      var frame = stack.length ? stack.pop() : null;
      if (frame) {
        dir = frame.dir;
        if (frame.words) words = frame.words;
      }
    } else if (tk.v === '|' || tk.v === '&') {
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
    if (w.v.charAt(0) === '-' && !w.dyn) {
      i++;
      continue;
    }
    break;
  }
  return {
    sub: i < argv.length ? argv[i].v : null,
    subDyn: i < argv.length && !!argv[i].dyn,
    args: argv.slice(i + 1).map(function (a) {
      return a.v;
    }),
    dirs: dirs,
    unknownTarget: unknownTarget,
  };
}

// Message options of `git stash push`/`git stash`: -m <msg>, -m<msg>,
// --message <msg>, --message=<msg>.
function hasMessage(args) {
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if ((a === '-m' || a === '--message') && i + 1 < args.length) return true;
    if (/^-m.+/.test(a) || /^--message=.+/.test(a)) return true;
  }
  return false;
}

var PATH_WIDE = /^(\.|\.\/|\*|:\/|:\(top\)|:\(glob\).*|:\/\*)$/;

// Returns { reason, scope } when the command needs a location check, where
// scope is 'head' (moves HEAD or rewrites refs or files: refused outside the
// session's own checkout) or 'subagent' (only refused for subagents outside
// their own worktree); or { stash: reason } for the shared stash stack
// (refused everywhere); or null when harmless. ctx.isPath(p) tells whether a
// word names an existing file or directory in the target checkout.
function classify(sub, args, ctx) {
  ctx = ctx || {};
  var isPath =
    ctx.isPath ||
    function () {
      return false;
    };
  if (sub === 'stash') {
    var action = args[0];
    if (action === undefined || action.charAt(0) === '-') {
      return hasMessage(args) ? null : { stash: 'a `git stash` without a message' };
    }
    if (action === 'push') {
      return hasMessage(args.slice(1)) ? null : { stash: '`git stash push` without a message' };
    }
    if (action === 'save') {
      var msg = args.slice(1).filter(function (a) {
        return a.charAt(0) !== '-';
      });
      return msg.length ? null : { stash: '`git stash save` without a message' };
    }
    if (action === 'apply') {
      var ref = args.slice(1).filter(function (a) {
        return a.charAt(0) !== '-';
      })[0];
      return ref && /^[0-9a-f]{4,40}$/.test(ref)
        ? null
        : { stash: '`git stash apply` without an explicit stash commit sha' };
    }
    if (action === 'pop' || action === 'drop' || action === 'clear' || action === 'branch') {
      return { stash: '`git stash ' + action + '`' };
    }
    if (SAFE_STASH[action]) return null;
    return null;
  }
  if (sub === 'worktree') {
    if (args[0] === 'remove' || args[0] === 'move') {
      var wt = args.slice(1).filter(function (a) {
        return a.charAt(0) !== '-';
      })[0];
      return { reason: '`git worktree ' + args[0] + '`', scope: 'worktree', path: wt || null };
    }
    if (args[0] === 'add') {
      var forced = args.some(function (a) {
        return a === '--force' || a === '-B' || /^-[a-zA-Z]*f/.test(a);
      });
      return forced
        ? {
            reason:
              '`git worktree add --force/-B` resets a branch or reuses one checked out elsewhere',
            scope: 'head',
          }
        : null;
    }
    return null;
  }
  if (sub === 'branch') {
    var destructive = args.some(function (a) {
      return /^-[a-zA-Z]*[DdfMmC]/.test(a) || /^--(delete|force|move|copy)$/.test(a);
    });
    return destructive
      ? {
          reason: '`git branch ' + args.join(' ') + '` deletes, forces or renames a branch',
          scope: 'subagent',
        }
      : null;
  }
  if (args.indexOf('-h') >= 0 || args.indexOf('--help') >= 0) return null;
  if (sub === 'worktree' || sub === 'stash' || sub === 'branch') return null;
  if (sub === 'pull' || sub === 'merge') {
    if (sub === 'merge' && args.length === 0) return null;
    return {
      reason: '`git ' + sub + '` changes the current branch and the files',
      scope: 'subagent-primary',
    };
  }
  if (sub === 'commit') {
    return args.indexOf('--amend') >= 0
      ? { reason: '`git commit --amend` rewrites the current commit', scope: 'subagent-primary' }
      : null;
  }
  if (sub === 'checkout-index') {
    var ciForce = args.some(function (a) {
      return a === '--force' || /^-[a-zA-Z]*f/.test(a);
    });
    return ciForce ? { reason: '`git checkout-index -f` overwrites files', scope: 'head' } : null;
  }
  if (sub === 'apply') {
    var reverse = args.some(function (a) {
      return a === '--reverse' || /^-[a-zA-Z]*R/.test(a);
    });
    return reverse
      ? { reason: '`git apply -R` reverts changes in the files', scope: 'head' }
      : null;
  }
  if (sub === 'submodule') {
    var smForce =
      args[0] === 'update' &&
      args.some(function (a) {
        return a === '--force' || /^-[a-zA-Z]*f/.test(a);
      });
    return smForce
      ? { reason: '`git submodule update --force` overwrites submodule files', scope: 'head' }
      : null;
  }
  if (!GUARDED[sub]) return null;
  var head = function (r) {
    return { reason: r, scope: 'head' };
  };
  if (sub === 'checkout') {
    if (args.length === 0) return null;
    if (args.indexOf('-b') >= 0 || args.indexOf('-B') >= 0)
      return head('`git checkout -b` moves HEAD');
    var dd = args.indexOf('--');
    var before = (dd >= 0 ? args.slice(0, dd) : args).filter(function (a) {
      return a.charAt(0) !== '-';
    });
    var paths = dd >= 0 ? args.slice(dd + 1) : [];
    if (dd < 0) {
      // Without `--`, a lone word that names a file is a path restore; `.` too.
      if (
        before.length &&
        before.every(function (a) {
          return PATH_WIDE.test(a) || isPath(a);
        })
      ) {
        paths = before;
        before = [];
      } else {
        return head('`git checkout` moves HEAD');
      }
    }
    if (
      before.length ||
      paths.some(function (p) {
        return PATH_WIDE.test(p);
      })
    ) {
      return head(
        '`git checkout ' +
          args.join(' ') +
          '` overwrites files' +
          (before.length ? ' from another commit' : ' across the whole tree'),
      );
    }
    return null; // a single path restored from the index: local, small
  }
  if (sub === 'restore') {
    var staged = args.indexOf('--staged') >= 0 || args.indexOf('-S') >= 0;
    var worktreeToo = args.indexOf('--worktree') >= 0 || args.indexOf('-W') >= 0;
    if (staged && !worktreeToo) return null;
    var source = args.some(function (a) {
      return a === '-s' || /^--source(=|$)/.test(a) || /^-s.+/.test(a);
    });
    var rpaths = args.filter(function (a) {
      return a.charAt(0) !== '-';
    });
    if (
      source ||
      rpaths.some(function (p) {
        return PATH_WIDE.test(p);
      })
    ) {
      return head(
        '`git restore ' +
          args.join(' ') +
          '` overwrites files' +
          (source ? ' from another commit' : ' across the whole tree'),
      );
    }
    return null;
  }
  if (sub === 'switch') return head('`git switch` moves HEAD');
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
    if (moving)
      return head('`git reset ' + flags.join(' ') + '` moves the branch or clobbers the tree');
    if (dashdash >= 0) return null; // `git reset [HEAD] -- <paths>` unstages files
    if (positional.length === 0) return null;
    // `git reset HEAD a.ts b.ts` or `git reset a.ts`: paths after an optional commit.
    var maybePaths = isPath(positional[0]) ? positional : positional.slice(1);
    if (maybePaths.length && maybePaths.every(isPath)) return null;
    return head(
      '`git reset <commit>` moves the branch (use `git restore --staged <path>` to unstage)',
    );
  }
  if (sub === 'clean') {
    var force = args.some(function (a) {
      return a === '--force' || /^-[a-zA-Z]*f/.test(a);
    });
    return force ? head('`git clean -f` deletes untracked files') : null;
  }
  if (sub === 'read-tree') {
    var updates = args.some(function (a) {
      return a === '-u' || a === '--reset' || /^-[a-zA-Z]*u/.test(a);
    });
    return updates ? head('`git read-tree -u` rewrites the index and the files') : null;
  }
  if (sub === 'symbolic-ref' || sub === 'update-ref') {
    var nonFlag = args.filter(function (a) {
      return a.charAt(0) !== '-';
    });
    var readOnly =
      sub === 'symbolic-ref'
        ? nonFlag.length < 2 && args.indexOf('-d') < 0 && args.indexOf('--delete') < 0
        : false;
    return readOnly ? null : head('`git ' + sub + '` rewrites a ref');
  }
  // rebase, cherry-pick, am, revert: rewrite the current branch and the files.
  if (
    args.some(function (a) {
      return a === '--show-current-patch';
    })
  )
    return null;
  return head('`git ' + sub + '` rewrites the current branch');
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
  'Work in your own worktree instead: `git fetch origin && git worktree add -b <branch> ' +
  '<scratch-path> origin/main` (or the Agent isolation worktree), and to read a PR use ' +
  '`git show <sha>:<path>`, `git diff`, or `bash automation/review/snapshot.sh <pr>` ' +
  '(lessons L15, L38).';

function decide(input, opts) {
  opts = opts || {};
  var top = opts.findTop || findTop;
  var pathExists = opts.pathExists || exists;
  var home = opts.home || os.homedir();
  var command =
    input && input.tool_input && typeof input.tool_input.command === 'string'
      ? input.tool_input.command
      : '';
  var cwd = input && typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  // agent_id only: agent_type is also set for a main session run with --agent.
  var subagent = !!(input && input.agent_id);
  // Prefilter on the command with quotes and backslashes removed, so `g""it`
  // or `g\it` still reaches the parser.
  if (!/\bgit\b/.test(command.replace(/["'\\]/g, ''))) return { allow: true };

  var tokens = tokenize(command);
  var unbalanced = false;
  if (tokens === null) {
    // Unbalanced quotes (often an apostrophe in prose): read leniently and
    // refuse only if that reading finds a git call that needs a check.
    tokens = tokenize(command, true);
    unbalanced = true;
    if (tokens === null)
      return { deny: 'the command could not be parsed around a git call. ' + ADVICE };
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
    // An absolute `git -C /abs` names its target even when the shell
    // directory is unknown (after `cd -`); a relative one needs it.
    var base = c.dir;
    for (var k = 0; k < g.dirs.length; k++) {
      if (path.isAbsolute(g.dirs[k])) base = path.resolve(g.dirs[k]);
      else base = base === null ? null : path.resolve(base, g.dirs[k]);
    }
    var verdict = classify(g.sub, g.args, {
      isPath: function (p) {
        return base !== null && p.charAt(0) !== '-' && pathExists(path.resolve(base, p));
      },
    });
    if (
      c.viaXargs &&
      (GUARDED[g.sub] || g.sub === 'stash' || g.sub === 'branch' || g.sub === 'worktree')
    ) {
      // xargs appends arguments only known at run time.
      verdict = {
        reason: '`xargs git ' + g.sub + '` (arguments only known at run time)',
        scope: 'head',
      };
      c.dir = null;
    }
    if (g.subDyn) {
      verdict = { reason: 'a git subcommand only known at run time', scope: 'head' };
    }
    if (!verdict) continue;
    if (verdict.stash) {
      return {
        deny:
          verdict.stash +
          ' acts on the stash stack that every worktree and session shares, so it can take or drop ' +
          "another session's entry. Use a WIP commit, or `git stash push -m <unique-tag>` then " +
          '`git stash apply <sha>`.',
      };
    }
    if (unbalanced) {
      return {
        deny:
          'the command has unbalanced quotes around ' +
          verdict.reason +
          ', so the guard cannot check it. ' +
          ADVICE,
      };
    }
    if (verdict.scope === 'subagent') {
      if (subagent) {
        return {
          deny:
            verdict.reason + '; a subagent leaves branch cleanup to the orchestrator. ' + ADVICE,
        };
      }
      continue;
    }
    // A main session may remove or move any worktree, and need not know where
    // the shell is (the documented gate cleanup runs after `cd -`).
    if (verdict.scope === 'worktree' && !subagent) continue;
    if (verdict.scope === 'subagent-primary' && !subagent) continue;
    if (base === null || g.unknownTarget || c.gitEnv) {
      return {
        deny:
          verdict.reason + ', and the guard cannot tell which checkout it would run in. ' + ADVICE,
      };
    }
    var target = base;
    if (verdict.scope === 'worktree') {
      if (!verdict.path) {
        return { deny: verdict.reason + ' without a path. ' + ADVICE };
      }
      var wt = top(path.resolve(base, verdict.path));
      if (wt && own && wt.top === own.top) continue;
      return {
        deny:
          verdict.reason +
          ' on ' +
          path.resolve(base, verdict.path) +
          ", which is not this subagent's own worktree; the orchestrator removes worktrees. " +
          ADVICE,
      };
    }
    var t = top(target);
    if (!t) continue; // not a repository: git will fail on its own
    if (verdict.scope === 'subagent-primary') {
      // Only a subagent reaches this point: refused in a primary checkout,
      // allowed in its own worktree and in another one (that is
      // the orchestrator's call to integrate).
      if (t.kind !== 'primary') continue;
      return {
        deny:
          verdict.reason +
          ' in ' +
          t.top +
          ', a primary checkout shared by every session and the operator; a subagent never ' +
          'changes it. ' +
          ADVICE,
      };
    }
    if (t.kind === 'primary') {
      if (!subagent) continue; // the main session owns the primary checkout
      return {
        deny:
          verdict.reason +
          ' in ' +
          t.top +
          ', a primary checkout shared by every session and the operator; a subagent never ' +
          'changes it. ' +
          ADVICE,
      };
    }
    if (!own || own.top !== t.top) {
      return {
        deny:
          verdict.reason +
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

// `node guard-git.cjs --self-test`: checks the decision logic on synthetic
// input (a subagent's `git reset --soft HEAD` in a primary checkout must be
// refused; the same call from the main session must pass). It does not prove
// Claude Code still sends `agent_id`; the subagent probe in
// docs/loops/06-orchestration.md does.
function selfTest() {
  var fake = function (dir) {
    return dir === '/canary' || dir.indexOf('/canary/') === 0
      ? { top: '/canary', kind: 'primary' }
      : null;
  };
  var cmd = { command: 'git reset --soft HEAD' };
  var sub = decide({ cwd: '/canary', tool_input: cmd, agent_id: 'canary' }, { findTop: fake });
  var mainSession = decide(
    { cwd: '/canary', tool_input: cmd, agent_type: 'orchestrator' },
    { findTop: fake },
  );
  var ok = !!sub.deny && !!mainSession.allow;
  process.stdout.write(
    'git guard self-test: subagent ' +
      (sub.deny ? 'refused' : 'ALLOWED') +
      ', main session ' +
      (mainSession.allow ? 'allowed' : 'REFUSED') +
      (ok ? ' (ok)' : ' (FAILED)') +
      '\n',
  );
  process.exit(ok ? 0 : 1);
}

function main() {
  if (process.argv[2] === '--self-test') return selfTest();
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
