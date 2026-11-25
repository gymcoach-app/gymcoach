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
//     the one its cwd is in; nor remove, move or prune any worktree, its
//     own included, nor delete, force or rename a branch, nor rewrite a
//     branch ref with `update-ref` (branches belong to every worktree), nor
//     force-create (`checkout -B`, `switch -C`, `worktree add -B`) a branch
//     that another worktree has checked out;
//   - the main session (the operator's, or the orchestrator's) may do so in a
//     primary checkout, but not in another session's linked worktree;
//   - nobody may pop, drop or take an untagged entry of the shared stash.
// "Own" checkout: the worktree that contains the `cwd` of the hook input.
// A subagent may also not pull, merge or amend a commit in a primary checkout.
// `gh pr checkout` is treated like `git checkout <ref>`.
// Everything else is allowed, including read-only git, fetch, commit, push,
// `git worktree add -b`, and restoring a single file.
//
// It is a guard against accidents, not a sandbox. It reads the command the
// way a shell would (compound commands, subshells, `$(...)` and backticks in
// or out of double quotes, `bash -c`, `eval`, `trap`, wrappers, env prefixes,
// `cd` and `git -C`), and stops there: a git call built in a variable, behind
// an alias or a shell function defined elsewhere, in a script file, or in a
// here-document fed to a shell is not seen, and neither is a ref deleted
// through `git push`.
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
  setsid: {},
  taskset: {},
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
var WRAPPER_POSITIONAL = { timeout: 1, taskset: 1 };
var GIT_ENV = /^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_COMMON_DIR)=/;

// --- Tokenizer -------------------------------------------------------------

// Index of the `)` that closes a `$(` whose body starts at `from`, or -1.
// Quotes inside the body are skipped, so a `)` in a string does not close it.
function closingParen(input, from) {
  var depth = 1;
  for (var i = from; i < input.length; i++) {
    var c = input[i];
    if (c === '\\') {
      i++;
    } else if (c === "'") {
      var q = input.indexOf("'", i + 1);
      if (q < 0) return -1;
      i = q;
    } else if (c === '"') {
      var j = i + 1;
      while (j < input.length && input[j] !== '"') j += input[j] === '\\' ? 2 : 1;
      if (j >= input.length) return -1;
      i = j;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Index of the backtick that closes the one before `from`, or -1.
function closingBacktick(input, from) {
  for (var i = from; i < input.length; i++) {
    if (input[i] === '\\') i++;
    else if (input[i] === '`') return i;
  }
  return -1;
}

// Splits a shell command into tokens. Operators (&&, ||, ;, |, &, newline,
// parentheses, `$(`) become separate operator tokens. A word that holds a
// command substitution the shell runs while building it (`"$(...)"` inside
// double quotes, backticks anywhere) carries the substitution's text in
// `subs`, so those commands are checked too. Returns null when the quoting is
// unbalanced.
function tokenize(input, lenient) {
  var tokens = [];
  var cur = '';
  var has = false; // a word is in progress (even an empty quoted one)
  var dynamic = false; // the word contains $ or ` (expansion we cannot resolve)
  var subs = []; // command substitutions inside the word in progress
  var i = 0;
  function push() {
    if (has) {
      var word = { t: 'w', v: cur, dyn: dynamic };
      if (subs.length) word.subs = subs;
      tokens.push(word);
    }
    cur = '';
    has = false;
    dynamic = false;
    subs = [];
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
        if (d === '$' && input[j + 1] === '(' && input[j + 2] !== '(') {
          // "$(...)": the shell runs it. Keep its text in the word and its
          // commands for the check; quotes inside it do not end this string.
          var endSub = closingParen(input, j + 2);
          if (endSub >= 0) {
            subs.push(input.slice(j + 2, endSub));
            buf += input.slice(j, endSub + 1);
            dynamic = true;
            j = endSub + 1;
            continue;
          }
        }
        if (d === '`') {
          var endTickDq = closingBacktick(input, j + 1);
          if (endTickDq >= 0) {
            subs.push(input.slice(j + 1, endTickDq).replace(/\\([`$\\])/g, '$1'));
            buf += input.slice(j, endTickDq + 1);
            dynamic = true;
            j = endTickDq + 1;
            continue;
          }
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
    if (c === '`') {
      // `...`: one word part whose commands the shell runs.
      var endTick = closingBacktick(input, i + 1);
      if (endTick >= 0) {
        subs.push(input.slice(i + 1, endTick).replace(/\\([`$\\])/g, '$1'));
        cur += input.slice(i, endTick + 1);
        dynamic = true;
        has = true;
        i = endTick + 1;
        continue;
      }
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
  // Commands of a script given as text (`bash -c`, `eval`, `trap`, a
  // substitution inside a word), run from `from` (null: unknown).
  function nestedScript(text, from, gitEnv) {
    var inner = tokenize(text);
    if (inner === null) {
      out.push({ unparsable: true, text: text, dir: dir });
      return;
    }
    var nested = commandsOf(inner, from === null ? cwd : from, home);
    for (var n = 0; n < nested.length; n++) {
      if (from === null) nested[n].dir = null;
      if (gitEnv) nested[n].gitEnv = true;
      out.push(nested[n]);
    }
  }
  function handle(ws) {
    var k = 0;
    var gitEnv = exportedGitEnv;
    // Substitutions inside this command's words run first, where the shell is.
    for (var s = 0; s < ws.length; s++) {
      if (!ws[s].subs) continue;
      for (var b = 0; b < ws[s].subs.length; b++) nestedScript(ws[s].subs[b], dir, gitEnv);
    }
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
      if (w === 'function' && k === 0 && ws.length > 2) {
        // `function name { ...`: the body's first command follows the name.
        k += 2;
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
      nestedScript(script.v, cmdDir, gitEnv);
      return;
    }
    if (name === 'eval' && rest.length > 1) {
      // eval joins its arguments and runs the result as a command line.
      nestedScript(
        rest
          .slice(1)
          .map(function (r) {
            return r.v;
          })
          .join(' '),
        cmdDir,
        gitEnv,
      );
      return;
    }
    if (name === 'trap' && rest.length > 2 && rest[1].v !== '-' && !/^-[lp]$/.test(rest[1].v)) {
      // trap '<commands>' EXIT: they run later, from wherever the shell is then.
      nestedScript(rest[1].v, cmdDir, gitEnv);
      return;
    }
    if (name === 'gh') {
      // `gh pr checkout <n>` switches the branch of the checkout it runs in.
      var gw = [];
      for (var q = 1; q < rest.length; q++) {
        if (rest[q].v === '-R' || rest[q].v === '--repo') q++;
        else gw.push(rest[q].v);
      }
      if (
        gw[0] === 'pr' &&
        (gw[1] === 'checkout' || gw[1] === 'co') &&
        gw.indexOf('--help') < 0 &&
        gw.indexOf('-h') < 0
      )
        out.push({ gh: true, dir: cmdDir, gitEnv: gitEnv });
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

// `-h` or `--help` among the options (before any `--`): git prints the usage
// of the subcommand and does nothing else.
function helpAsked(args) {
  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--') return false;
    if (args[i] === '-h' || args[i] === '--help') return true;
  }
  return false;
}

// The word after one of `flags`, or null.
function valueOf(args, flags) {
  for (var i = 0; i < args.length - 1; i++) if (flags.indexOf(args[i]) >= 0) return args[i + 1];
  return null;
}

// Refs that each worktree has for itself; every other ref is shared.
var PER_WORKTREE_REF = /^(HEAD|[A-Z][A-Z_]*_HEAD|refs\/(worktree|bisect|rewritten)\/.+)$/;

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
  // Checked on git 2.34.1: `git stash drop -h`, `git branch -D x -h` and
  // `git worktree remove -h <path>` print the usage (exit 129) and change
  // nothing. For stash and worktree only right after the action, where it
  // cannot be the value of an option or follow a positional argument.
  if (sub === 'branch' && helpAsked(args)) return null;
  if ((sub === 'stash' || sub === 'worktree') && helpAsked(args.slice(0, 2))) return null;
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
      return { reason: '`git worktree ' + args[0] + '`', scope: 'worktree' };
    }
    if (args[0] === 'prune') {
      // It drops the entry of every worktree whose directory is missing at
      // that moment, whoever owns it. A dry run only lists them.
      var dryRun = args.some(function (a) {
        return a === '--dry-run' || /^-[a-zA-Z]*n/.test(a);
      });
      return dryRun ? null : { reason: '`git worktree prune`', scope: 'worktree' };
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
            forceBranch: valueOf(args, ['-B']),
          }
        : null;
    }
    return null;
  }
  if (sub === 'branch') {
    var destructive = false;
    for (var bi = 0; bi < args.length; bi++) {
      if (args[bi] === '--') break;
      if (args[bi] === '--sort' || args[bi] === '--format') {
        bi++; // its value is a key or a format, even when it starts with `-`
        continue;
      }
      if (/^-[a-zA-Z]*[DdfMmC]/.test(args[bi]) || /^--(delete|force|move|copy)$/.test(args[bi]))
        destructive = true;
    }
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
      return {
        reason: '`git checkout -b` moves HEAD',
        scope: 'head',
        forceBranch: valueOf(args, ['-B']),
      };
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
  if (sub === 'switch')
    return {
      reason: '`git switch` moves HEAD',
      scope: 'head',
      forceBranch: valueOf(args, ['-C', '--force-create']),
    };
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
  if (sub === 'update-ref') {
    // update-ref [-m <reason>] [--no-deref] (-d <ref> [<old>] | <ref> <new> [<old>] | --stdin)
    var ref = null;
    for (var ui = 0; ui < args.length && ref === null; ui++) {
      if (args[ui] === '-m') ui++;
      else if (args[ui].charAt(0) !== '-') ref = args[ui];
    }
    var named = ref !== null && args.indexOf('--stdin') < 0;
    if (named && PER_WORKTREE_REF.test(ref)) return head('`git update-ref` rewrites a ref');
    // A branch, or refs the guard cannot read (--stdin, a variable): branches
    // are shared by every worktree, so the checkout it runs in protects nobody.
    if (!named || /^refs\/heads\//.test(ref) || /[$`]/.test(ref))
      return {
        reason:
          '`git update-ref` on ' +
          (named && /^refs\/heads\//.test(ref)
            ? 'the branch ref ' + ref
            : 'refs named at run time'),
        scope: 'shared-ref',
      };
    return head('`git update-ref` rewrites a ref');
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

function realOrSame(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

// The branches checked out in the worktrees of the repository that the
// checkout `top` belongs to, as [{ branch, top }], read from its git
// directory (HEAD of the primary checkout and of each `worktrees/<name>`).
// Anything unreadable is left out: this only ever adds a refusal.
function checkedOut(top) {
  var out = [];
  function add(headFile, wtTop) {
    try {
      var m = /^ref: refs\/heads\/(.+)$/m.exec(fs.readFileSync(headFile, 'utf8'));
      if (m) out.push({ branch: m[1].trim(), top: wtTop });
    } catch {
      // unreadable: unknown
    }
  }
  try {
    var dotGit = path.join(top, '.git');
    var common = dotGit;
    if (!fs.statSync(dotGit).isDirectory()) {
      var link = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
      if (!link) return out;
      var gitDir = path.resolve(top, link[1].trim());
      common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
    }
    add(path.join(common, 'HEAD'), path.dirname(common));
    var names = [];
    try {
      names = fs.readdirSync(path.join(common, 'worktrees'));
    } catch {
      // no linked worktree
    }
    names.forEach(function (n) {
      var admin = path.join(common, 'worktrees', n);
      try {
        var wtGit = fs.readFileSync(path.join(admin, 'gitdir'), 'utf8').trim();
        add(path.join(admin, 'HEAD'), path.dirname(path.resolve(admin, wtGit)));
      } catch {
        // a stale entry
      }
    });
  } catch {
    // not a layout this reads: unknown
  }
  return out;
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
  if (!/\b(git|gh)\b/.test(command.replace(/["'\\]/g, ''))) return { allow: true };

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
      if (/\b(git|gh)\b/.test(c.text)) {
        return { deny: 'a nested shell command around git could not be parsed. ' + ADVICE };
      }
      continue;
    }
    var g = c.gh ? { sub: 'gh', args: [], dirs: [], unknownTarget: false } : parseGit(c.argv);
    // An absolute `git -C /abs` names its target even when the shell
    // directory is unknown (after `cd -`); a relative one needs it.
    var base = c.dir;
    for (var k = 0; k < g.dirs.length; k++) {
      if (path.isAbsolute(g.dirs[k])) base = path.resolve(g.dirs[k]);
      else base = base === null ? null : path.resolve(base, g.dirs[k]);
    }
    var verdict = c.gh
      ? { reason: '`gh pr checkout` moves HEAD', scope: 'head' }
      : classify(g.sub, g.args, {
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
    // A main session may remove, move or prune any worktree, and need not know
    // where the shell is (the documented gate cleanup runs after `cd -`). A
    // subagent may not, whatever the path: git also takes a worktree by the
    // last component of its path (`git worktree remove agent-b` from anywhere),
    // and a path in a variable is only known at run time, so "its own
    // worktree" cannot be told from somebody else's by reading the command
    // (issue #593). Its own worktree is the orchestrator's to remove too.
    if (verdict.scope === 'worktree') {
      if (!subagent) continue;
      return {
        deny:
          verdict.reason +
          '; a subagent leaves worktree cleanup to the orchestrator, its own worktree ' +
          'included (the orchestrator removes worktrees after the merge). Leave the ' +
          'worktree in place and name it in your report.',
      };
    }
    // A branch belongs to every worktree: moving or deleting its ref from the
    // subagent's own worktree still pulls it from under whoever has it checked
    // out. The main session keeps the rule of the other ref rewrites.
    if (verdict.scope === 'shared-ref') {
      if (subagent) {
        return {
          deny:
            verdict.reason +
            ' moves or deletes a branch for every worktree, whichever checkout it runs in; ' +
            'a subagent leaves branch cleanup to the orchestrator. To move the branch you ' +
            'are on, commit or `git reset` in your own worktree.',
        };
      }
      verdict.scope = 'head';
    }
    if (verdict.scope === 'subagent-primary' && !subagent) continue;
    if (base === null || g.unknownTarget || c.gitEnv) {
      return {
        deny:
          verdict.reason + ', and the guard cannot tell which checkout it would run in. ' + ADVICE,
      };
    }
    var target = base;
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
    // In its own worktree a subagent may force-create a branch, unless that
    // branch is checked out elsewhere: git 2.34.1 moves it anyway (checked).
    if (subagent && verdict.forceBranch) {
      var holders = (opts.checkedOut || checkedOut)(t.top);
      for (var h = 0; h < holders.length; h++) {
        if (holders[h].branch !== verdict.forceBranch) continue;
        if (realOrSame(holders[h].top) === realOrSame(t.top)) continue;
        return {
          deny:
            'it would reset the branch `' +
            verdict.forceBranch +
            '`, which is checked out in ' +
            holders[h].top +
            ' (git 2.34 does not refuse that, and the other checkout is left with ' +
            'its files showing as changed). Pick another branch name.',
        };
      }
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
  checkedOut: checkedOut,
};

if (require.main === module) main();
