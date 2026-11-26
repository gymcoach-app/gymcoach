import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { describeCost, measureGrowth, repeatedReferenceCost } from '@/lib/testing/cpu-cost';

const require = createRequire(import.meta.url);
const guard = require('./guard-git.cjs') as {
  decide: (
    input: { cwd?: string; tool_input?: { command?: string }; agent_id?: string },
    opts?: {
      findTop?: (dir: string) => { top: string; kind: string } | null;
      home?: string;
      pathExists?: (p: string) => boolean;
      checkedOut?: (top: string) => { branch: string; top: string }[];
    },
  ) => { allow?: true; deny?: string };
  findTop: (dir: string) => { top: string; kind: string } | null;
  checkedOut: (top: string) => { branch: string; top: string }[];
  tokenize: (s: string) => unknown[] | null;
};

// A fake filesystem layout: one primary checkout, two agent worktrees inside
// it, one scratch worktree elsewhere, and a directory outside any repository.
const MAIN = '/repo';
const WT_A = '/repo/.claude/worktrees/a';
const WT_B = '/repo/.claude/worktrees/b';
const SCRATCH = '/tmp/scratch/gate';
const TOPS: Array<{ top: string; kind: string }> = [
  { top: WT_A, kind: 'linked' },
  { top: WT_B, kind: 'linked' },
  { top: SCRATCH, kind: 'linked' },
  { top: MAIN, kind: 'primary' },
];
function findTop(dir: string) {
  return TOPS.find((t) => dir === t.top || dir.startsWith(`${t.top}/`)) ?? null;
}

// Files that exist in the fake checkouts, for path-vs-commit decisions.
const FILES = new Set([
  `${MAIN}/README.md`,
  `${MAIN}/lib/a.ts`,
  `${WT_A}/lib/a.ts`,
  `${MAIN}/file.ts`,
]);
const pathExists = (p: string) => FILES.has(p);

// The branch each fake checkout has checked out.
const checkedOut = () => [
  { branch: 'main', top: MAIN },
  { branch: 'wa', top: WT_A },
  { branch: 'wb', top: WT_B },
];

// By default a call comes from a subagent (agent_id set), which is who the
// incidents behind L15 and L38 came from; `main` marks the main session.
function run(command: string, cwd: string, who: 'subagent' | 'main' = 'subagent') {
  return guard.decide(
    { cwd, tool_input: { command }, ...(who === 'subagent' ? { agent_id: 'a1' } : {}) },
    { findTop, home: '/home/u', pathExists, checkedOut },
  );
}
const allowed = (command: string, cwd = WT_A, who: 'subagent' | 'main' = 'subagent') =>
  expect(run(command, cwd, who), command).toEqual({ allow: true });
const denied = (command: string, cwd = WT_A, who: 'subagent' | 'main' = 'subagent') => {
  const res = run(command, cwd, who);
  expect(res.deny, `expected a deny for: ${command}`).toBeTruthy();
  return res.deny!;
};

describe('git guard: commands that move HEAD or clobber the tree', () => {
  it('denies them in the primary checkout', () => {
    for (const cmd of [
      'git checkout main',
      'git checkout -b feat/x',
      'git checkout --detach abc123',
      'git switch main',
      'git switch -c feat/y',
      'git reset --hard origin/main',
      'git reset --keep HEAD~1',
      'git reset HEAD~1',
      'git clean -fd',
      'git clean --force',
    ]) {
      expect(denied(cmd, MAIN)).toContain('primary checkout');
    }
  });

  it('allows them inside the worktree the session works in', () => {
    for (const cmd of [
      'git checkout main',
      'git checkout -b feat/x origin/main',
      'git switch -c feat/y',
      'git reset --hard HEAD',
      'git clean -fd',
    ]) {
      allowed(cmd, WT_A);
    }
    allowed('git checkout --detach HEAD', SCRATCH);
  });

  it("denies them in another session's worktree, by -C, cd or a subshell", () => {
    expect(denied(`git -C ${WT_B} checkout main`)).toContain(
      'not the worktree this session works in',
    );
    denied(`cd ${WT_B} && git checkout --detach abc`);
    denied(`cd ../b && git switch main`);
    denied(`(cd ${MAIN}; git reset --hard)`);
    denied(`git -C ${MAIN} checkout main`);
    denied(`git -C .. -C ../.. checkout main`);
    denied(`pushd ${MAIN} >/dev/null; git switch main`);
  });

  it('restores the directory after a subshell closes', () => {
    allowed(`(cd ${MAIN} && git status) && git checkout -b feat/z`);
    denied(`(cd ${WT_A}) ; cd ${MAIN} ; git checkout -b feat/z`);
  });

  it('checks git calls inside bash -c and $(...)', () => {
    denied(`bash -c "cd ${MAIN} && git checkout main"`);
    denied(`echo $(cd ${MAIN}; git switch main)`, WT_A);
    allowed(`bash -c "git log --oneline -3"`, MAIN);
  });

  it('refuses when the target directory cannot be resolved', () => {
    expect(denied('cd "$DIR" && git checkout main')).toContain('cannot tell which checkout');
    denied('git -C "$WT" switch main');
    denied('git --work-tree=/x checkout main');
    denied('cd - && git reset --hard');
  });
});

describe('git guard: allowed commands', () => {
  it('lets read-only git and normal work run anywhere', () => {
    for (const cmd of [
      'git status -sb',
      'git log --oneline -5',
      'git diff origin/main...HEAD',
      'git show abc:path/to/file.ts',
      'git fetch -q origin',
      'git commit -q -m "fix: x"',
      'git push -q origin HEAD',
      'git worktree add --detach /tmp/x origin/main',
      'git worktree list',
      'git branch -a',
      'git rev-parse HEAD',
      'git checkout',
      'git checkout -- README.md',
      'git checkout README.md',
      'git restore --staged x',
      'git restore lib/a.ts',
      'git reset HEAD file.ts',
      'git reset file.ts',
      'git stash push -mtag',
      'git stash push --message=tag',
      'git reset',
      'git reset -q',
      'git reset -- lib/a.ts',
      'git reset HEAD -- lib/a.ts',
      'git clean -n',
      'git checkout --help',
      'ls && echo git checkout main',
      'grep -n "git checkout" docs/loops/lessons.md',
    ]) {
      allowed(cmd, MAIN);
    }
  });

  it('keeps a subagent from pulling, merging or amending in a primary checkout', () => {
    for (const cmd of [
      'git pull -q',
      'git pull --rebase origin main',
      'git merge --no-edit origin/main',
      'git commit --amend --no-edit',
    ]) {
      expect(denied(cmd, MAIN)).toContain('primary checkout');
      // Its own worktree is its own business, and the main session is free.
      allowed(cmd, WT_A);
      allowed(cmd, MAIN, 'main');
    }
  });

  it('ignores commands outside any repository', () => {
    allowed('git checkout main', '/elsewhere');
  });

  it('treats a here-document body as data, not commands', () => {
    allowed(
      "git commit -q -F - <<'EOF'\nfix: don't git checkout main\ngit switch x\nEOF\ngit push -q",
      MAIN,
    );
    denied('cat <<EOF > x.txt\nhello\nEOF\ngit switch main', MAIN);
  });

  it('drops redirections and their fd numbers', () => {
    allowed('git reset 2>/dev/null && git status 2>&1', MAIN);
    allowed('git log > /tmp/log.txt', MAIN);
  });
});

describe('git guard: the shared stash stack', () => {
  it('refuses stash forms that can take another session entry, in any checkout', () => {
    for (const cmd of [
      'git stash',
      'git stash pop',
      'git stash drop',
      'git stash clear',
      'git stash push',
      'git stash -u',
    ]) {
      expect(denied(cmd, WT_A)).toContain('stash stack');
    }
  });

  it('allows tagged pushes and read or apply by sha', () => {
    for (const cmd of [
      'git stash push -u -m wip-123',
      'git stash -m wip-123',
      'git stash list --format="%H %gs"',
      'git stash show -p stash@{0}',
      'git stash apply abc123',
    ]) {
      allowed(cmd, WT_A);
    }
  });
});

describe('git guard: parse failures', () => {
  it('refuses a guarded git command next to unbalanced quotes', () => {
    expect(denied(`git checkout main && echo "unterminated`, MAIN)).toContain('unbalanced quotes');
    denied(`git reset --hard && echo it's`, MAIN);
  });

  it('does not refuse an apostrophe in prose around harmless git', () => {
    allowed(`echo it's git time`, MAIN);
    allowed(`git log --oneline && echo "don't`, MAIN);
    // The checkout is inside the unterminated string: bash rejects the whole
    // command with a syntax error, so nothing runs.
    allowed(`git commit -m "unterminated && git checkout main`, MAIN);
  });

  it('allows commands without git even when they do not parse', () => {
    allowed(`echo "unterminated`, MAIN);
  });

  it('refuses an unterminated here-document next to a guarded git command', () => {
    denied('git switch main <<EOF\nno end', MAIN);
    // The body is data; an unterminated one does not hide a command.
    allowed('git commit -F - <<EOF\nno end', MAIN);
  });
});

const tmpRoots: string[] = [];
afterAll(() => {
  for (const r of tmpRoots) rmSync(r, { recursive: true, force: true });
});

describe('findTop on a real filesystem', () => {
  it('tells a primary checkout from a linked worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-'));
    tmpRoots.push(root);
    mkdirSync(join(root, 'main', '.git'), { recursive: true });
    mkdirSync(join(root, 'main', 'src'), { recursive: true });
    mkdirSync(join(root, 'wt'), { recursive: true });
    writeFileSync(join(root, 'wt', '.git'), 'gitdir: x\n');
    expect(guard.findTop(join(root, 'main', 'src'))).toEqual({
      top: join(root, 'main'),
      kind: 'primary',
    });
    expect(guard.findTop(join(root, 'wt', 'missing', 'dir'))).toEqual({
      top: join(root, 'wt'),
      kind: 'linked',
    });
  });
});

describe('git guard: main session vs subagent', () => {
  it('lets the main session move HEAD in the primary checkout', () => {
    for (const cmd of [
      'git checkout main',
      'git switch -c feat/x',
      'git switch -',
      'git reset --hard origin/main',
      'git checkout origin/main -- docs/a.md',
    ]) {
      allowed(cmd, MAIN, 'main');
    }
  });

  it("still refuses the main session in another session's worktree and on the stash", () => {
    denied(`git -C ${WT_B} checkout main`, MAIN, 'main');
    denied(`cd ${WT_B} && git reset --hard`, WT_A, 'main');
    expect(denied('git stash pop', MAIN, 'main')).toContain('stash stack');
  });

  it('lets the main session remove worktrees and branches, but not a subagent', () => {
    allowed(`git worktree remove --force ${WT_B}`, MAIN, 'main');
    allowed('git branch -D old-branch', MAIN, 'main');
    expect(denied(`git worktree remove --force ${WT_B}`, WT_A)).toContain('own worktree');
    denied('git worktree remove', WT_A);
    // Until #593 its own worktree was allowed; see "worktree removal" below.
    expect(denied(`git worktree remove ${WT_A}`, WT_A)).toContain('its own worktree included');
    expect(denied('git branch -D old-branch', WT_A)).toContain('branch cleanup');
    denied('git branch -f main origin/main', WT_A);
    denied('git branch -M renamed', WT_A);
    allowed('git branch -a', WT_A);
  });
});

describe('git guard: shapes that used to slip past', () => {
  it('sees git behind shell keywords, groups and wrappers', () => {
    for (const cmd of [
      'if true; then git checkout main; fi',
      '{ git checkout main; }',
      'for b in a; do git switch $b; done',
      'while true; do git reset --hard; done',
      '! git checkout main',
      'timeout 30 git checkout main',
      'timeout -k 5 30 git switch main',
      'nice -n 10 git checkout main',
      'xargs git checkout < refs.txt',
      'sudo -u me git checkout main',
      'env -i git checkout main',
      'time git switch main',
      'command git checkout main',
      '/usr/bin/git checkout main',
      'git -c core.x=y checkout main',
    ]) {
      denied(cmd, MAIN);
    }
  });

  it('reads -c scripts behind flag clusters', () => {
    denied(`bash -lc "git checkout main"`, MAIN);
    denied(`sh -ec 'git switch main'`, MAIN);
    denied(`bash -l -c "cd ${MAIN} && git reset --hard"`, WT_A);
    allowed(`bash -lc "git status"`, MAIN);
  });

  it('treats GIT_DIR and GIT_WORK_TREE as an unknown target', () => {
    expect(denied(`GIT_DIR=${MAIN}/.git git checkout main`, WT_A)).toContain(
      'cannot tell which checkout',
    );
    denied(`env GIT_WORK_TREE=${MAIN} git reset --hard`, WT_A);
    denied(`export GIT_DIR=${MAIN}/.git; git switch main`, WT_A);
    allowed(`GIT_DIR=${MAIN}/.git git log -1`, WT_A);
  });

  it('guards history-rewriting commands outside the own checkout', () => {
    for (const cmd of [
      'git rebase origin/main',
      'git cherry-pick abc123',
      'git am < patch.mbox',
      'git revert HEAD',
      // A per-worktree ref. A branch ref is refused in the own worktree too
      // since #593: see "update-ref on a branch" below.
      'git update-ref HEAD abc123',
      'git symbolic-ref HEAD refs/heads/x',
      'git read-tree -u -m HEAD',
    ]) {
      denied(cmd, MAIN);
      allowed(cmd, WT_A);
    }
    allowed('git symbolic-ref HEAD', MAIN);
    allowed('git read-tree HEAD', MAIN);
  });

  it('guards path-wide or sourced restores outside the own checkout', () => {
    for (const cmd of [
      'git checkout -- .',
      'git checkout .',
      'git checkout HEAD~3 -- .',
      'git checkout origin/main -- docs/a.md',
      'git restore .',
      'git restore --source=HEAD~3 lib/a.ts',
      'git restore -s HEAD~1 -- :/',
    ]) {
      denied(cmd, MAIN);
      allowed(cmd, WT_A);
    }
    allowed('git restore --staged .', MAIN);
  });

  it('refuses stash forms that pick an entry implicitly', () => {
    for (const cmd of [
      'git stash save -u',
      'git stash branch wip',
      'git stash apply',
      'git stash apply stash@{0}',
    ]) {
      expect(denied(cmd, WT_A), cmd).toContain('stash stack');
    }
    allowed('git stash save "wip 1"', WT_A);
    allowed('git stash apply 1a2b3c4d', WT_A);
  });
});

describe('git guard: review round 3 (#448)', () => {
  it('treats agent_type alone as the main session (claude --agent sets it)', () => {
    const res = guard.decide(
      {
        cwd: MAIN,
        tool_input: { command: 'git switch main' },
        agent_type: 'orchestrator',
      } as never,
      { findTop, home: '/home/u', pathExists },
    );
    expect(res).toEqual({ allow: true });
  });

  it('lets the main session run the ship-pr gate cleanup after `cd -`', () => {
    const cleanup = `cd - && git -C ${MAIN} worktree remove --force ${SCRATCH}`;
    allowed(cleanup, SCRATCH, 'main');
    allowed(`git -C ${MAIN} worktree remove --force ${SCRATCH}`, SCRATCH, 'main');
    // A subagent still may not remove a worktree that is not its own.
    expect(denied(cleanup, WT_A)).toContain('worktree remove');
  });

  it('resolves an absolute git -C even when the shell directory is unknown', () => {
    expect(denied(`cd - && git -C ${MAIN} switch main`, WT_A)).toContain('primary checkout');
    allowed(`cd - && git -C ${WT_A} switch -c x`, WT_A);
    // A relative -C after `cd -` still has no known base.
    expect(denied('cd - && git -C sub switch main', WT_A)).toContain('cannot tell');
  });

  it('skips cd options instead of taking them as the path', () => {
    expect(denied(`cd -- ${MAIN} && git switch main`, WT_A)).toContain('primary checkout');
    expect(denied(`cd -P ${MAIN} && git switch main`, WT_A)).toContain('primary checkout');
    expect(denied(`cd -L -- ${WT_B} && git reset --hard`, WT_A)).toContain(WT_B);
  });

  it('applies env -C / env --chdir / sudo -D to the command', () => {
    expect(denied(`env -C ${MAIN} git switch main`, WT_A)).toContain('primary checkout');
    expect(denied(`env --chdir=${MAIN} git switch main`, WT_A)).toContain('primary checkout');
    expect(denied(`sudo -D ${MAIN} git switch main`, WT_A)).toContain('primary checkout');
    // Into another session's worktree: refused like `git -C` would be.
    expect(denied(`env -C ${WT_B} git switch -c x`, WT_A)).toContain(WT_B);
    // The chdir is per command: the next command runs where the shell is.
    allowed(`env -C ${MAIN} true && git switch -c x`, WT_A);
  });

  it('refuses a git subcommand only known at run time outside the own worktree', () => {
    for (const cmd of ['git $x main', 'git $(echo switch) main', 'git `echo switch` main']) {
      expect(denied(cmd, MAIN), cmd).toContain('only known at run time');
      allowed(cmd, WT_A);
      allowed(cmd, MAIN, 'main');
    }
    // The substitution's own git call is still checked.
    expect(denied('echo $(git checkout main)', MAIN)).toContain('primary checkout');
    allowed('git log $(git rev-parse HEAD)', MAIN);
  });

  it('sees git spelled with quotes or a backslash', () => {
    expect(denied('g""it switch main', MAIN)).toContain('primary checkout');
    expect(denied('g\\it switch main', MAIN)).toContain('primary checkout');
  });

  it('guards the other tree-clobbering forms outside the own checkout', () => {
    for (const cmd of [
      'git checkout-index -a -f',
      'git apply -R fix.patch',
      'git worktree add --force /tmp/w main',
      'git worktree add -B feat/x /tmp/w origin/main',
      'git submodule update --force',
    ]) {
      expect(denied(cmd, MAIN), cmd).toContain('primary checkout');
      allowed(cmd, WT_A);
    }
    allowed('git apply fix.patch', MAIN);
    allowed('git checkout-index -a', MAIN);
  });
});

describe('git guard: the hook process', () => {
  const script = join(__dirname, 'guard-git.cjs');
  function hook(input: unknown, env: Record<string, string> = {}) {
    return spawnSync(process.execPath, [script], {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      env: { ...process.env, ...env, GYMCOACH_GIT_GUARD: env.GYMCOACH_GIT_GUARD ?? '' },
      encoding: 'utf8',
    });
  }
  const root = mkdtempSync(join(tmpdir(), 'guard-proc-'));
  tmpRoots.push(root);
  mkdirSync(join(root, '.git'));
  const sub = {
    tool_name: 'Bash',
    cwd: root,
    agent_id: 'a1',
    tool_input: { command: 'git switch main' },
  };

  it('exits 2 with the reason on stderr for a denied subagent command', () => {
    const res = hook(sub);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Blocked by the git guard');
    expect(res.stderr).toContain('git worktree add -b');
  });

  it('exits 0 for the main session, another tool, the off switch, and bad JSON', () => {
    const { agent_id: _ignored, ...mainSession } = sub;
    expect(hook(mainSession).status).toBe(0);
    expect(hook({ ...sub, tool_name: 'Read' }).status).toBe(0);
    expect(hook(sub, { GYMCOACH_GIT_GUARD: 'off' }).status).toBe(0);
    const bad = hook('{not json');
    expect(bad.status).toBe(0);
    expect(bad.stderr).toContain('command allowed');
  });

  it('passes its self-test (the session-start canary of the decision logic)', () => {
    const res = spawnSync(process.execPath, [script, '--self-test'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('subagent refused, main session allowed (ok)');
  });
});

// Issue #593, part 2: one subagent's `git worktree remove` went through while
// similar commands were refused. Which forms pass was established by running
// the guard on the matrix below (synthetic input, never a real git command),
// and what git itself does with them in a throwaway repository on git 2.34.1.
describe('git guard: command forms (issue #593)', () => {
  const PAYLOADS = [
    `git worktree remove --force ${WT_B}`,
    'git branch -D old',
    'git update-ref -d refs/heads/old',
    `git -C ${MAIN} reset --hard`,
  ];
  const first = (p: string, as: string) => p.replace(/^git/, as);
  const FORMS: Record<string, (p: string) => string> = {
    plain: (p) => p,
    and: (p) => `git status && ${p}`,
    semicolon: (p) => `git status; ${p}`,
    or: (p) => `git status || ${p}`,
    'after a pipeline': (p) => `git status | cat; ${p}`,
    'after a background job': (p) => `git status &\n${p}`,
    'next line': (p) => `git status\n${p}`,
    'after a comment': (p) => `git status # note\n${p}`,
    subshell: (p) => `(${p})`,
    'subshell with cd': (p) => `( cd /elsewhere && ${p} )`,
    group: (p) => `{ ${p}; }`,
    'group after &&': (p) => `true && { ${p}; }`,
    '$(...)': (p) => `echo $(${p})`,
    '"$(...)"': (p) => `echo "$(${p})"`,
    'assignment from "$(...)"': (p) => `out="$(${p} 2>&1)"; echo "$out"`,
    backticks: (p) => 'echo `' + p + '`',
    'backticks in double quotes': (p) => 'echo "done: `' + p + '`"',
    'variable prefix': (p) => `FOO=1 ${p}`,
    'two variable prefixes': (p) => `FOO=1 BAR="b c" ${p}`,
    'env prefix': (p) => `env FOO=1 ${p}`,
    'after export': (p) => `export FOO=1; ${p}`,
    'cd own worktree &&': (p) => `cd ${WT_A} && ${p}`,
    'cd main &&': (p) => `cd ${MAIN} && ${p}`,
    'cd main || exit;': (p) => `cd ${MAIN} || exit 1; ${p}`,
    pushd: (p) => `pushd ${MAIN} >/dev/null && ${p}`,
    '"git"': (p) => first(p, '"git"'),
    "'git'": (p) => first(p, "'git'"),
    '\\git': (p) => first(p, '\\git'),
    '/usr/bin/git': (p) => first(p, '/usr/bin/git'),
    'every argument quoted': (p) =>
      p
        .split(' ')
        .map((w, i) => (i ? `"${w}"` : w))
        .join(' '),
    'git --no-pager': (p) => first(p, 'git --no-pager'),
    'git -c k=v': (p) => first(p, 'git -c core.x=y'),
    'bash -c': (p) => `bash -c "${p}"`,
    'bash -lc': (p) => `bash -lc '${p}'`,
    'sh -c': (p) => `sh -c "${p}"`,
    'eval "..."': (p) => `eval "${p}"`,
    'eval words': (p) => `eval ${p}`,
    trap: (p) => `trap '${p}' EXIT; true`,
    taskset: (p) => `taskset -c 4-11 ${p}`,
    setsid: (p) => `setsid ${p}`,
    time: (p) => `time ${p}`,
    nohup: (p) => `nohup ${p} &`,
    timeout: (p) => `timeout 60 ${p}`,
    if: (p) => `if git status; then ${p}; fi`,
    for: (p) => `for x in a b; do ${p}; done`,
    'while read': (p) => `while read l; do ${p}; done < list.txt`,
    case: (p) => `case x in x) ${p};; esac`,
    'f() { }': (p) => `f() { ${p}; }; f`,
    'function f { }': (p) => `function f { ${p}; }; f`,
    'test &&': (p) => `test -d x && ${p}`,
    '[ ] &&': (p) => `[ -d x ] && ${p}`,
    '[[ ]] &&': (p) => `[[ -d x ]] && ${p}`,
    '!': (p) => `! ${p}`,
    '2>&1 | tail': (p) => `${p} 2>&1 | tail -3`,
    '>/dev/null 2>&1': (p) => `${p} >/dev/null 2>&1`,
    '&> /dev/null': (p) => `${p} &> /dev/null`,
    '|| true': (p) => `${p} || true`,
    'after a here-document': (p) => `cat <<'EOF' > /tmp/x\nhello\nEOF\n${p}`,
  };

  it('refuses a subagent the same command in every form a shell runs it in', () => {
    const passed: string[] = [];
    for (const [name, form] of Object.entries(FORMS)) {
      for (const p of PAYLOADS) {
        if (!run(form(p), WT_A).deny) passed.push(`${name}: ${form(p)}`);
      }
    }
    expect(passed).toEqual([]);
  });

  it('keeps every one of those forms open to the main session', () => {
    // Forms that leave the shell where it was: the main session, in the main
    // checkout, may remove a worktree, delete a branch, and reset its tree.
    const moving = ['subshell with cd', 'cd own worktree &&'];
    const refused: string[] = [];
    for (const [name, form] of Object.entries(FORMS)) {
      if (moving.includes(name)) continue;
      for (const p of PAYLOADS) {
        if (run(form(p), MAIN, 'main').deny) refused.push(`${name}: ${form(p)}`);
      }
    }
    expect(refused).toEqual([]);
  });

  it('does not take a command that is only text for a command that runs', () => {
    for (const p of PAYLOADS) {
      allowed(`echo ${p}`, WT_A);
      allowed(`grep -rn "${p}" docs`, WT_A);
      allowed(`echo '$(${p})'`, WT_A);
      allowed(`git commit -q -m 'docs: say that \`${p}\` is refused'`, WT_A);
      allowed(`git commit -q -F - <<'EOF'\ndocs: $(${p})\nEOF`, WT_A);
    }
  });

  it('checks a substitution where the shell is, and keeps its cd to itself', () => {
    expect(denied(`out="$(cd ${MAIN} && git checkout main 2>&1)"`, WT_A)).toContain(
      'primary checkout',
    );
    expect(denied(`cd ${MAIN} && echo "now on $(git switch main)"`, WT_A)).toContain(
      'primary checkout',
    );
    allowed(`echo "$(cd ${MAIN} && git status -sb)"; git switch -c feat/x`, WT_A);
    // Quotes inside the substitution do not end the string around it.
    allowed('echo "last: $(git log --format="%h %s" -1)"', MAIN);
    expect(denied('echo "last: $(git log --format="%h" -1)" && git switch main', MAIN)).toContain(
      'primary checkout',
    );
    // An escaped backtick in double quotes is a character, not a command.
    allowed('git commit -q -m "docs: \\`git switch main\\` is refused"', MAIN);
    allowed('echo "$((1 + 2))" && git status', MAIN);
  });

  it('reads eval, trap and function only as far as they hold commands', () => {
    allowed('eval "$(ssh-agent -s)" && git fetch -q origin', MAIN);
    allowed('trap - EXIT; git status', MAIN);
    allowed("trap 'rm -f /tmp/x' EXIT; git log -1", MAIN);
    expect(denied(`trap 'git -C ${MAIN} checkout main' EXIT`, WT_A)).toContain('primary checkout');
    expect(denied('function back { git switch main; }; back', MAIN)).toContain('primary checkout');
    allowed('taskset -c 4-11 git status', MAIN);
    expect(denied('taskset -c 4-11 git switch main', MAIN)).toContain('primary checkout');
  });
});

describe('git guard: worktree removal by a subagent (issue #593)', () => {
  // The cause of the incident. The guard used to allow a subagent's
  // `worktree remove <path>` when <path>, resolved against the shell's
  // directory, lay inside the worktree holding its cwd. Two readings of
  // <path> are wrong there, both checked on git 2.34.1 in a throwaway repo:
  // git also takes a worktree by the last component of its path (from
  // agent-a, `git worktree remove agent-b` removed the sibling), and a
  // variable is not a path at all. Both resolved "inside its own worktree".
  it('refuses the forms that used to pass as "its own worktree"', () => {
    for (const cmd of [
      'git worktree remove b', // git: the worktree whose path ends in /b
      'git worktree remove --force b',
      'git worktree remove "$WT"',
      `WT=${WT_B}; git worktree remove "$WT"`,
      'git worktree remove $(pwd)',
      'git worktree remove "$(git rev-parse --show-toplevel)"',
      'for w in a b; do git worktree remove --force "$w"; done',
      'git worktree move b ../c',
    ]) {
      expect(denied(cmd, WT_A), cmd).toContain('worktree cleanup to the orchestrator');
    }
    // From the main checkout a bare name resolved to "inside the primary
    // checkout", the subagent's own cwd: it passed too.
    expect(denied('git worktree remove b', MAIN)).toContain('worktree cleanup');
  });

  it('refuses its own worktree too, however it is named', () => {
    for (const cmd of [
      `git worktree remove ${WT_A}`,
      'git worktree remove .',
      'git worktree remove --force .',
      `cd ${MAIN} && git worktree remove .claude/worktrees/a`,
      `git -C ${MAIN} worktree remove --force ${WT_A}`,
      `git status --short && cd ${MAIN} && git worktree remove --force ${WT_A} && git branch -a`,
      'git worktree move . ../c',
    ]) {
      expect(denied(cmd, WT_A), cmd).toContain('its own worktree included');
    }
  });

  it('refuses a prune, which drops any worktree whose directory is missing', () => {
    for (const cmd of [
      'git worktree prune',
      'git worktree prune -v',
      'git worktree prune --expire now',
      `rm -rf ${WT_B} && git worktree prune`,
      `git -C ${MAIN} worktree prune`,
    ]) {
      expect(denied(cmd, WT_A), cmd).toContain('git worktree prune');
      allowed(cmd, MAIN, 'main');
    }
  });

  it('keeps the read-only and additive worktree commands', () => {
    for (const cmd of [
      'git worktree list',
      'git worktree list --porcelain',
      'git worktree prune -n',
      'git worktree prune --dry-run -v',
      'git worktree add -b fix/x /tmp/x origin/main',
      'git worktree add --detach /tmp/y origin/main',
      'git worktree lock .',
      'git worktree remove -h',
      'git worktree remove --help',
      'git worktree -h',
    ]) {
      allowed(cmd, WT_A);
      allowed(cmd, MAIN);
    }
  });

  it('keeps the main session free to remove, move and prune', () => {
    for (const cmd of [
      `git worktree remove ${WT_A}`,
      'git worktree remove a',
      'git worktree remove --force "$WT"',
      `git worktree move ${WT_A} /tmp/moved`,
      'git worktree prune',
      `cd - && git -C ${MAIN} worktree remove --force ${SCRATCH}`,
    ]) {
      allowed(cmd, MAIN, 'main');
    }
  });
});

describe('git guard: branches are shared by every worktree (issue #593)', () => {
  it('refuses a subagent update-ref on a branch, in its own worktree too', () => {
    // Checked on git 2.34.1: from one worktree, `update-ref refs/heads/main`
    // moved the branch the primary checkout was on, and `update-ref -d`
    // deleted the branch another worktree had checked out.
    for (const cmd of [
      'git update-ref -d refs/heads/old',
      'git update-ref refs/heads/main abc123',
      'git update-ref -m "reset" refs/heads/main abc123',
      'git update-ref --no-deref -d refs/heads/wb',
      'git update-ref "refs/heads/$b" abc123',
      'git update-ref --stdin',
      'git update-ref --stdin -z < refs.txt',
    ]) {
      expect(denied(cmd, WT_A), cmd).toContain('for every worktree');
      expect(denied(cmd, MAIN), cmd).toContain('for every worktree');
      // The main session keeps what it had: free in the primary checkout,
      // refused in another session's worktree.
      allowed(cmd, MAIN, 'main');
      denied(`cd ${WT_B} && ${cmd}`, MAIN, 'main');
    }
  });

  it('keeps update-ref on refs of the own worktree and on non-branch refs', () => {
    for (const cmd of [
      'git update-ref HEAD abc123',
      'git update-ref -d ORIG_HEAD',
      'git update-ref -d CHERRY_PICK_HEAD',
      'git update-ref refs/worktree/tmp abc123',
      'git update-ref refs/remotes/pr/5 FETCH_HEAD',
      'git update-ref -d refs/remotes/pr/5',
    ]) {
      allowed(cmd, WT_A);
      // Still a ref rewrite: not in a checkout the subagent does not own.
      expect(denied(cmd, MAIN), cmd).toContain('primary checkout');
    }
    allowed('git update-ref -h', MAIN);
  });

  it('refuses force-creating a branch that another worktree has checked out', () => {
    // Checked on git 2.34.1: `checkout -B main` and `switch -C wb` from a
    // third worktree both succeed and move the branch under its checkout.
    for (const cmd of [
      'git checkout -B main origin/main',
      'git checkout -q -B main',
      'git switch -C wb',
      'git switch --force-create main origin/main',
      'git worktree add -B main /tmp/w origin/main',
      `git status && git checkout -B main origin/main`,
      // Every spelling git accepts for the option and its value.
      'git checkout -Bmain origin/main',
      'git checkout -fB main origin/main',
      'git checkout -qfBmain',
      'git switch -Cwb',
      'git switch -fC wb',
      'git switch --force-create=main origin/main',
      'git worktree add -Bmain /tmp/w origin/main',
      'git worktree add -fB main /tmp/w',
    ]) {
      expect(denied(cmd, WT_A), cmd).toContain('which is checked out in');
    }
    for (const cmd of [
      'git checkout -B wa origin/main', // the branch this worktree is on
      'git checkout -B fresh origin/main',
      'git switch -C fresh',
      'git checkout -b main2 origin/main',
      'git switch -c feat/x',
      'git checkout -B "$b" origin/main', // only known at run time: not judged
      'git checkout -Bfresh origin/main',
      'git checkout -b main2 -B fresh', // -b takes `main2`; -B takes `fresh`
      'git checkout -bmain origin/x', // a new branch named `main`: git refuses it itself
      'git switch --force-create=fresh',
      'git switch -cC', // a new branch named `C`
      'git worktree add -Bfresh /tmp/w origin/main',
    ]) {
      allowed(cmd, WT_A);
    }
    // `worktree add -B<name>` is a forced add like `-B <name>`: not in a
    // checkout the subagent does not own.
    expect(denied('git worktree add -Bfresh /tmp/w', MAIN)).toContain('primary checkout');
    // In the primary checkout the subagent is refused as before, the main
    // session allowed as before.
    expect(denied('git checkout -B wb', MAIN)).toContain('primary checkout');
    allowed('git checkout -B wb', MAIN, 'main');
  });

  it('reads the checked-out branches from the git directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-heads-'));
    tmpRoots.push(root);
    const main = join(root, 'main');
    const wt = join(root, 'wt', 'agent-a');
    const admin = join(main, '.git', 'worktrees', 'agent-a');
    mkdirSync(admin, { recursive: true });
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(admin, 'HEAD'), 'ref: refs/heads/wa\n');
    writeFileSync(join(admin, 'commondir'), '../..\n');
    writeFileSync(join(admin, 'gitdir'), `${join(wt, '.git')}\n`);
    writeFileSync(join(wt, '.git'), `gitdir: ${admin}\n`);
    // A stale entry and a detached worktree are left out, not fatal.
    mkdirSync(join(main, '.git', 'worktrees', 'stale'));
    const detached = join(main, '.git', 'worktrees', 'detached');
    mkdirSync(detached);
    writeFileSync(join(detached, 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
    writeFileSync(join(detached, 'gitdir'), `${join(root, 'wt', 'detached', '.git')}\n`);
    const expected = [
      { branch: 'main', top: main },
      { branch: 'wa', top: wt },
    ];
    expect(guard.checkedOut(wt)).toEqual(expected);
    expect(guard.checkedOut(main)).toEqual(expected);
    expect(guard.checkedOut(join(root, 'nowhere'))).toEqual([]);
    // End to end on that layout, with the real lookups.
    const ask = (command: string) =>
      guard.decide({ cwd: wt, tool_input: { command }, agent_id: 'a1' });
    expect(ask('git checkout -B main origin/main').deny).toContain(`checked out in ${main}`);
    expect(ask('git checkout -B wa origin/main')).toEqual({ allow: true });
    expect(ask('git switch -C fresh')).toEqual({ allow: true });
  });

  it('still refuses a subagent every branch deletion, and reads branch listings as listings', () => {
    for (const cmd of [
      'git branch -d old',
      'git branch --delete old',
      'git branch --delete --force old',
      'git branch -rd origin/old',
      'git branch -m new-name',
      'git branch --sort -committerdate -D old',
    ]) {
      expect(denied(cmd, WT_A), cmd).toContain('branch cleanup');
    }
    for (const cmd of [
      // Refused before #593: the sort key was read as a cluster of flags.
      'git branch --sort -committerdate',
      'git branch -a --sort -committerdate --format "%(refname:short)"',
      'git branch --sort=-committerdate',
      'git branch --show-current',
      'git branch -vv',
      'git branch --merged main',
      'git branch --contains HEAD -r',
      'git branch -c copy',
      'git branch -h',
      'git branch -D old -h', // prints the usage, deletes nothing (checked)
    ]) {
      allowed(cmd, WT_A);
      allowed(cmd, MAIN);
    }
  });
});

describe('git guard: gh pr checkout and read-only commands (issue #593)', () => {
  it('treats `gh pr checkout` as the checkout it is', () => {
    expect(denied('gh pr checkout 12', MAIN)).toContain('primary checkout');
    expect(denied('gh pr checkout 12 --force', MAIN)).toContain('gh pr checkout');
    expect(denied('gh -R gymcoach-app/gymcoach pr checkout 12', MAIN)).toContain('primary');
    expect(denied('gh --repo=gymcoach-app/gymcoach pr checkout 12', MAIN)).toContain('primary');
    expect(denied('gh -Rgymcoach-app/gymcoach pr checkout 12', MAIN)).toContain('primary');
    expect(denied('gh pr --repo gymcoach-app/gymcoach checkout 12', MAIN)).toContain('primary');
    // New with #593 for the main session too: like `git checkout`, not in
    // another session's worktree.
    expect(denied(`cd ${WT_B} && gh pr checkout 12`, MAIN, 'main')).toContain(WT_B);
    expect(denied(`cd ${MAIN} && gh pr checkout 12`, WT_A)).toContain('primary checkout');
    expect(denied(`cd ${WT_B} && gh pr checkout 12`, WT_A)).toContain(WT_B);
    allowed('gh pr checkout 12', WT_A);
    allowed('gh pr checkout 12', MAIN, 'main');
    for (const cmd of [
      'gh pr view 12 --json state',
      'gh pr checkout --help',
      'gh pr list --search "checkout"',
      'gh pr create --title "fix: gh pr checkout in the main checkout" --body x',
      'gh api repos/o/r/pulls/12',
      'gh issue view 593 --comments',
    ]) {
      allowed(cmd, MAIN);
    }
  });

  it('does not refuse read-only commands, in the main checkout either', () => {
    for (const cmd of [
      'git log --oneline -5',
      'git status --short && git diff --stat',
      'git for-each-ref --sort=-committerdate refs/heads',
      'git show-ref -d',
      'git reflog -5',
      'git ls-remote --heads origin',
      'git rev-parse --abbrev-ref HEAD',
      'git config --get remote.origin.url',
      'git remote -v',
      'git blame -L 1,5 README.md',
      'git grep -n "git worktree remove" -- docs',
      'git log --grep "reset --hard" -3',
      'git show HEAD:automation/README.md | grep -n "worktree remove"',
      'git diff --stat origin/main...HEAD -- . ":(exclude)package-lock.json"',
      'git commit -q -m "docs: say git branch -D is refused"',
      'git stash list',
      'git stash -h',
      'git stash drop -h',
      'git stash show -p stash@{0}',
      'git cherry -v origin/main',
      'git merge-base origin/main HEAD',
      'git check-ignore -v node_modules',
      'git cat-file -p HEAD',
      'git describe --tags --always',
      'git tag -l',
      'git shortlog -sn',
      'git name-rev HEAD',
      'git clean -nd',
      'git rebase --show-current-patch',
      'git symbolic-ref --short HEAD',
      'git symbolic-ref -q HEAD',
      'git restore --staged lib/a.ts',
      'git worktree list --porcelain | grep -c worktree',
      'echo "branch: $(git branch --show-current)"',
      'echo "head: `git rev-parse --short HEAD`"',
      'cd "$(git rev-parse --show-toplevel)" && git status -sb',
    ]) {
      allowed(cmd, MAIN);
      allowed(cmd, WT_A);
    }
    // Help is only read right after a stash action: a later -h is not trusted.
    expect(denied('git stash drop stash@{0} -h', WT_A)).toContain('stash stack');
  });
});

// Review of #595. Reading "$(...)" inside double quotes must not cost the two
// things the plain reading had: prose in a message body is never refused, and
// a command next to such a body is never hidden. Where a comment says "as
// before #593", the expectation was checked against the guard at bbf7f1d
// during the review (7175 commands replayed through both).
describe('git guard: message bodies and substitutions (issue #593, review of #595)', () => {
  const ask = (
    g: Pick<typeof guard, 'decide'>,
    command: string,
    cwd: string,
    who: 'subagent' | 'main',
  ) =>
    g.decide(
      { cwd, tool_input: { command }, ...(who === 'subagent' ? { agent_id: 'a1' } : {}) },
      { findTop, home: '/home/u', pathExists, checkedOut },
    );
  const WHO: Array<[string, 'subagent' | 'main']> = [
    [MAIN, 'subagent'],
    [WT_A, 'subagent'],
    [MAIN, 'main'],
  ];

  // Prose as it appears in commit messages and PR bodies. None of it is a
  // command when the here-document's delimiter is quoted.
  const PROSE = [
    'Steps:\n1) first\n2) second',
    'works now :)',
    "the guard's rule (and the hook's) changed",
    "don't",
    "can't (yet)",
    'run `git stash pop` after `git checkout main`',
    'a 5" screen, a 3\' cable',
    'an unbalanced ( paren',
    'a closing ) only',
    "# a heading: it's short",
    'case a) or b) esac',
    'costs $(5), see $x and ${y}',
    'says "$(git stash pop)" in the docs',
    'a "quoted" word and a \\ backslash',
    'EOF2 is not the delimiter\n EOF neither',
    'cat <<EOF inside the body',
    'ends with a backslash \\',
    '`unclosed backtick and "unclosed quote',
    'if x; then y; fi; case z in',
    '',
  ];
  const tabbed = (b: string) =>
    b
      .split('\n')
      .map((l) => `\t${l}`)
      .join('\n');
  // Ways a body reaches git or gh with a quoted delimiter.
  const QUOTED: Record<string, (b: string) => string> = {
    'commit -m "$(cat <<\'EOF\')"': (b) => `git commit -q -m "$(cat <<'EOF'\n${b}\nEOF\n)"`,
    'commit -m "$(cat <<"EOF")"': (b) => `git commit -q -m "$(cat <<"EOF"\n${b}\nEOF\n)"`,
    'commit -m "$(cat <<\\EOF)"': (b) => `git commit -q -m "$(cat <<\\EOF\n${b}\nEOF\n)"`,
    'commit -m "$(cat <<-\'EOF\')"': (b) =>
      `git commit -q -m "$(cat <<-'EOF'\n${tabbed(b)}\n\tEOF\n)"`,
    'title and body': (b) =>
      `git commit -q -m "fix: x" -m "$(cat <<'EOF'\n${b}\nEOF\n)" && git push -q origin HEAD`,
    'gh pr create --body': (b) =>
      `gh pr create --title "fix: x" --body "$(cat <<'EOF'\n${b}\nEOF\n)"`,
    'gh pr comment --body': (b) => `gh pr comment 595 --body "$(cat <<'EOF'\n${b}\nEOF\n)"`,
    'commit -F - <<': (b) => `git commit -q -F - <<'EOF'\n${b}\nEOF`,
    'gh pr create --body-file - <<': (b) =>
      `gh pr create --title t --body-file - <<'EOF'\n${b}\nEOF`,
  };
  // What must stay refused next to a body: (command, cwd, who).
  const GUARDED: Array<[string, string, 'subagent' | 'main']> = [
    ['git stash pop', WT_A, 'subagent'],
    ['git stash pop', MAIN, 'main'],
    ['git switch main', MAIN, 'subagent'],
    [`git -C ${MAIN} reset --hard origin/main`, WT_A, 'subagent'],
    [`git -C ${WT_B} checkout main`, MAIN, 'main'],
  ];

  it('never refuses prose in a body with a quoted delimiter', () => {
    const refused: string[] = [];
    let checked = 0;
    for (const [name, form] of Object.entries(QUOTED)) {
      for (const b of PROSE) {
        for (const [cwd, who] of WHO) {
          checked++;
          const res = ask(guard, form(b), cwd, who);
          if (res.deny) refused.push(`${name} | ${who}@${cwd} | ${JSON.stringify(b)}`);
        }
      }
    }
    expect(refused).toEqual([]);
    expect(checked).toBe(9 * 20 * 3);
  });

  it('never hides a guarded command behind a body: before, after, or between two', () => {
    const hidden: string[] = [];
    let checked = 0;
    for (const [name, form] of Object.entries(QUOTED)) {
      // A here-document at the top level ends the line: the next command
      // goes on the next line there.
      const sep = name.endsWith('<<') ? '\n' : ' && ';
      for (let i = 0; i < PROSE.length; i++) {
        const one = form(PROSE[i]!);
        const other = form(PROSE[(i + 3) % PROSE.length]!);
        for (const [cmd, cwd, who] of GUARDED) {
          for (const command of [
            `${cmd} && ${one}`,
            `${one}${sep}${cmd}`,
            `${one}${sep}${cmd} && ${other}`,
          ]) {
            checked++;
            // Every one of these is refused: nothing next to a body is hidden.
            if (!ask(guard, command, cwd, who).deny) hidden.push(`${name} | ${command}`);
          }
        }
      }
    }
    expect(hidden).toEqual([]);
    expect(checked).toBe(9 * 20 * 5 * 3);
  });

  it('reads the inputs of the review both ways', () => {
    // Refused by the first version of #595, allowed by the guard before it.
    for (const body of [
      'Steps:\n1) first\n2) second',
      'done :)',
      "the parser's rule (the old one's) is back",
      'use `git stash pop` with care',
      'a 5" screen',
    ]) {
      for (const cmd of [
        `git commit -q -m "$(cat <<'EOF'\n${body}\nEOF\n)"`,
        `gh pr comment 595 --body "$(cat <<'EOF'\n${body}\nEOF\n)"`,
        `gh pr create --title t --body "$(cat <<'EOF'\n${body}\nEOF\n)"`,
      ]) {
        allowed(cmd, MAIN, 'main');
        allowed(cmd, MAIN);
      }
    }
    // Hidden by the first version of #595, refused by the guard before it.
    const hiding =
      `git commit -q -m "$(cat <<'EOF'\ndon't\nEOF\n)" && git stash pop && ` +
      `git commit -q -m "$(cat <<'EOF'\ncan't\nEOF\n)"`;
    expect(denied(hiding, MAIN, 'main')).toContain('stash stack');
    expect(denied(hiding, WT_A)).toContain('stash stack');
  });

  it('knows comments, case patterns and here-documents inside "$(...)"', () => {
    for (const cmd of [
      `echo "$(echo hi # don't (really)\n)" && git status`,
      `echo "$(case $x in a) echo one;; (b) echo two;; esac)" && git status`,
      `echo "$(cat <<EOF\nplain ) text\nEOF\n)" && git status`,
      `echo "$(cat <<A; cat <<'B'\nfirst )\nA\nsecond ' \nB\n)" && git status`,
      'echo "$(cat <<<"a ) b")" && git status',
      'echo "$(echo "$((1 + (2 * 3)))")" && git status',
    ]) {
      allowed(cmd, MAIN);
      expect(denied(`${cmd} && git switch main`, MAIN), cmd).toContain('primary checkout');
    }
    // And still reads the commands in them.
    expect(denied(`echo "$(case $x in a) git switch main;; esac)"`, MAIN)).toContain('primary');
    expect(denied(`echo "$(true # note\ngit switch main)"`, MAIN)).toContain('primary checkout');
  });

  it('runs the substitutions of a here-document only when its delimiter is unquoted', () => {
    // The shell expands an unquoted body: these commands do run.
    for (const body of ['now on $(git switch main)', 'now on `git switch main`']) {
      expect(denied(`cat <<EOF\n${body}\nEOF`, MAIN)).toContain('primary checkout');
      expect(denied(`git commit -q -m "$(cat <<EOF\n${body}\nEOF\n)"`, MAIN)).toContain('primary');
      expect(denied(`cat <<-EOF\n\t${body}\n\tEOF`, MAIN)).toContain('primary checkout');
      allowed(`cat <<'EOF'\n${body}\nEOF`, MAIN);
      allowed(`cat <<"EOF"\n${body}\nEOF`, MAIN);
      allowed(`cat <<\\EOF\n${body}\nEOF`, MAIN);
      allowed(`cat <<EOF\n${body.replace(/[$`]/g, '\\$&')}\nEOF`, MAIN); // escaped: text
    }
    // The rest of an unquoted body is data, whatever it looks like.
    for (const b of PROSE.filter((p) => !/[`]|\$\(/.test(p))) {
      for (const [cwd, who] of WHO) {
        expect(ask(guard, `git commit -q -F - <<EOF\n${b}\nEOF`, cwd, who), b).toEqual({
          allow: true,
        });
        expect(
          ask(guard, `gh pr create --title t --body "$(cat <<EOF\n${b}\nEOF\n)"`, cwd, who),
          b,
        ).toEqual({ allow: true });
      }
    }
    // A substitution that does not close or is not shell code is left alone.
    allowed('cat <<EOF\nan open $( paren and a lone ` tick\nEOF', MAIN);
    allowed("cat <<EOF\nit's `not shell'` code\nEOF", MAIN);
  });

  it('falls back to the plain reading of a string it cannot read, as before #593', () => {
    for (const cmd of [
      // No closing parenthesis, no closing backtick, a body that is not shell.
      'git commit -q -m "an open $( paren"',
      'git commit -q -m "a lone ` tick"',
      `git commit -q -m "it is \`not shell' code\`"`,
      `git commit -q -m "$(echo 'unclosed)"`,
      'git commit -q -m "$(cat <<EOF\nnever ends\n)"',
      // The fallback is for the whole string: its other backticks are not
      // commands either.
      'git commit -q -m "`git switch main` and an open $( paren"',
      'git commit -q -m "an open $( paren and `git stash pop`"',
    ]) {
      for (const [cwd, who] of WHO) {
        expect(ask(guard, cmd, cwd, who), cmd).toEqual({ allow: true });
        const then = `${cmd} && git stash pop`;
        expect(ask(guard, then, cwd, who).deny, then).toBeTruthy();
      }
    }
  });

  it('skips the body of every here-document announced on one line', () => {
    // Two on one line: both bodies are data, and what follows them is not.
    const two = `cat <<A; cat <<'B'\ngit switch main\nA\ngit stash pop\nB`;
    allowed(two, MAIN);
    allowed(`cat <<'A' <<'B' && git status\ngit switch main\nA\ngit stash pop\nB`, MAIN);
    expect(denied(`${two}\ngit switch main`, MAIN)).toContain('primary checkout');
    // The second body is only expanded when its own delimiter is unquoted.
    allowed("cat <<A; cat <<'B'\nplain\nA\n$(git switch main)\nB", MAIN);
    expect(denied("cat <<'A'; cat <<B\nplain\nA\n$(git switch main)\nB", MAIN)).toContain(
      'primary checkout',
    );
    // A second body that never ends: the command cannot be read as a whole.
    expect(denied('git switch main && cat <<A; cat <<B\none\nA\ntwo', MAIN)).toContain(
      'unbalanced quotes',
    );
    // An empty quoted delimiter ends at the first empty line.
    allowed("cat <<''\ngit switch main\n\ngit status", MAIN);
    expect(denied("cat <<''\ngit stash pop\n\ngit switch main", MAIN)).toContain('primary');
    expect(denied('cat <<""\ntext\n\ngit stash pop', WT_A)).toContain('stash stack');
    allowed(`echo "$(cat <<''\na ) paren\n\n)" && git status`, MAIN);
  });

  it('still refuses what sits in or after $((...)) and a here-string, as before #593', () => {
    // $((...)) and `<<<` are read the way the guard read them before #593
    // (their limits are in automation/README.md). A reading of them as
    // arithmetic or as a word was tried in the review of #595 and let these
    // through, so they are pinned here.
    for (const arithmetic of [
      'n=$((2*(a+(b))))',
      'n=$(( (a+(b)) * 2 ))',
      'n=$(( $(date +$(b)) + 1 ))',
    ]) {
      const cmd = `(cd ${MAIN} && ${arithmetic} && git switch main)`;
      expect(denied(cmd, WT_A), cmd).toBeTruthy();
    }
    for (const cmd of [
      'echo $(( $(git $X) ))',
      'echo $((git ${X}))',
      'echo $(( $(git 2>&1 pull) ))',
    ]) {
      expect(denied(cmd, MAIN), cmd).toBeTruthy();
    }
    expect(denied('git stash <<<"x"$(y)', WT_A)).toContain('stash stack');
  });

  it('reads a nested script with unbalanced quotes leniently, like the top level', () => {
    // Refused before: any nested script that did not parse and named git.
    allowed(`bash -c "git log --oneline -3 && echo it's"`, MAIN);
    allowed(`bash -lc 'git status && echo "unterminated'`, MAIN);
    allowed(`eval "git log -1 && echo it's"`, MAIN);
    // Still refused when a call that needs a check is in it.
    expect(denied(`bash -c "git switch main && echo it's"`, MAIN)).toContain('unbalanced quotes');
    expect(denied(`bash -c "git stash pop && echo it's"`, WT_A)).toContain('stash stack');
    expect(denied(`trap 'git switch main; echo "x' EXIT`, MAIN)).toContain('unbalanced quotes');
  });

  // Each of these shapes once made the guard read the same text again and
  // again: a look-ahead restarted at every `"$(`, or a nested script read once
  // per level that holds it. The look-ahead budget (`newScan`) and the `seen`
  // set of `commandsOf` keep the work proportional to the length of the
  // command, and this test holds them to it.
  //
  // It measures growth, not milliseconds: every shape is built at two sizes,
  // and the CPU time may grow no faster than the command gets longer, with a
  // margin: the exponent of the growth (1 is proportional, 2 the square) stays
  // under LINEAR. It used to allow each input 1000 ms on the wall clock, which
  // failed at 1018 ms on a busy machine (#593) and would have let a guard
  // three times slower through on an idle one.
  //
  // The three shapes that nest a script in a script are not linear by design
  // below MAX_NEST levels: each level reads the text it holds, so depth times
  // length. They are also a few dozen characters long and take a tenth of a
  // millisecond, so their measured exponent moves more than the others'.
  //
  // Measured with 16 busy loops on 12 cores: 0.85 to 1.05 for the linear
  // shapes (the plain "$(...)" nested thousands deep is one of them: past
  // MAX_NEST it is not followed), 0.7 to 0.9 for `bash -c`, 1.5 to 1.6 for
  // the "$(...)" around a checkout (limit DEPTH_TIMES_LENGTH), 1.5 to 1.8 for
  // the `eval` one. Without the look-ahead budget the `"$(a"`
  // shape takes 65 to 82 times longer for 8 times the length (2.0 to 2.1).
  // Without `seen` the `eval "$(...)"` shape doubles with every level until
  // the budget stops it at about 8 levels, which is why that shape is
  // measured from 3 levels to 8: 22 to 80 times longer for 2.3 times the
  // length (4.2 to 5.4). Both fail here.
  //
  // Between the 1.05 at most of the linear shapes and the 2 of a square.
  const LINEAR = 1.6;
  const DEPTH_TIMES_LENGTH = 2.5;
  // Halfway between what the `eval` shape measures with `seen` and without.
  const EACH_LEVEL_ONCE = 3.3;
  const decideAsAgent = (command: string) =>
    guard.decide(
      { cwd: MAIN, tool_input: { command }, agent_id: 'a1' },
      { findTop, home: '/home/u', pathExists, checkedOut },
    );
  const wrapped = (inner: string, depth: number, wrap: (text: string) => string) => {
    let command = inner;
    for (let i = 0; i < depth; i++) command = wrap(command);
    return command;
  };
  // Each level of quoting doubles the backslashes, so the quoted forms are
  // 2^depth characters long by themselves: the cost is compared with the
  // length of the command, never with the depth.
  const evalWords = (depth: number) =>
    wrapped('git status', depth, (text) => `eval ${JSON.stringify(text)}`);
  const evalSubs = (depth: number) => wrapped('git status', depth, (text) => `eval "$(${text})"`);
  const shells = (depth: number) =>
    wrapped('git switch main', depth, (text) => `bash -c ${JSON.stringify(text)}`);
  const nestedSubs = (depth: number, inner: string) =>
    `${'echo "$('.repeat(depth)}${inner}${')"'.repeat(depth)}`;
  const hereDocument = (lines: number) =>
    `git commit -q -m "$(cat <<'EOF'\n${"it's 1) fine\n".repeat(lines)}EOF\n)"`;

  // [name, the command at size n, small n, large n, limit, refused?]
  it.each<[string, (n: number) => string, number, number, number, boolean]>([
    ['"$(" repeated', (n) => `${'"$('.repeat(n)} git status`, 1000, 8000, LINEAR, false],
    ['"$(a" repeated', (n) => `${'"$(a" '.repeat(n)}git status`, 1000, 8000, LINEAR, false],
    ['"`" repeated', (n) => `${'"`'.repeat(n)} git status`, 2000, 16_000, LINEAR, false],
    ['eval nested (quoted)', evalWords, 11, 14, LINEAR, false],
    ['eval "$(...)" nested', evalSubs, 3, 8, EACH_LEVEL_ONCE, false],
    ['"$(...)" nested', (n) => nestedSubs(n, 'git status'), 600, 4800, LINEAR, false],
    ['a long here-document body', hereDocument, 2000, 16_000, LINEAR, false],
    // Depth does not hide a command either.
    ['bash -c nested', shells, 3, 6, DEPTH_TIMES_LENGTH, true],
    [
      '"$(...)" nested around a checkout',
      (n) => nestedSubs(n, 'git switch main'),
      4,
      30,
      DEPTH_TIMES_LENGTH,
      true,
    ],
  ])('reads %s without reading it again and again', (name, build, small, large, limit, refused) => {
    const commands = new Map([small, large].map((n) => [build(n).length, build(n)]));
    const [smallLength, largeLength] = [...commands.keys()] as [number, number];
    for (const command of commands.values()) {
      expect(!!decideAsAgent(command).deny, name).toBe(refused);
    }
    const growth = measureGrowth(
      (length) => {
        decideAsAgent(commands.get(length)!);
      },
      smallLength,
      largeLength,
    );
    expect(
      growth.exponent,
      `${growth.smallMs.toFixed(3)} ms for ${smallLength} characters, ` +
        `${growth.largeMs.toFixed(3)} ms for ${largeLength}`,
    ).toBeLessThan(limit);
  });

  it('still decides the largest inputs it was first held to', () => {
    const cases: Array<[string, string, boolean]> = [
      ['"$(" x 50000', `${'"$('.repeat(50_000)} git status`, false],
      ['"$(a" x 20000', `${'"$(a" '.repeat(20_000)}git status`, false],
      ['"`" x 50000', `${'"`'.repeat(50_000)} git status`, false],
      ['eval nested 14 deep (quoted)', evalWords(14), false],
      ['eval "$(...)" nested 20 deep', evalSubs(20), false],
      ['"$(...)" nested 5000 deep', nestedSubs(5000, 'git status'), false],
      ['a 200 kB body', hereDocument(15_000), false],
      ['bash -c nested 6 deep', shells(6), true],
      ['"$(...)" nested 30 deep around a checkout', nestedSubs(30, 'git switch main'), true],
    ];
    for (const [name, command, refused] of cases) {
      expect(!!decideAsAgent(command).deny, name).toBe(refused);
    }
  });

  // Growth says nothing about a guard that reads every command once but ten
  // times more slowly, which the old bound (1000 ms per input) did catch on a
  // calm machine. So the heaviest of those inputs also has a bound on what it
  // costs, in units of the reference work of lib/testing/cpu-cost.ts measured
  // next to it. Calibration (one machine: a six-core 2020 laptop, Node 22):
  // 64 to 75 units on a calm machine, where the read takes 100 ms, and 67 to
  // 110 with 16 busy loops. With every command read three times: 182 to 226.
  // Ten times: 600. The limit is between the code as it is and the
  // three-times version (1.3 times each way), and five times stricter than
  // the old bound was on a calm machine (1000 ms is 690 units there). The
  // units another machine measures are printed on CI and with
  // COST_UNITS_LOG=1 (describeCost).
  const HEAVIEST_INPUT_LIMIT_UNITS = 140;

  it('reads the heaviest input it was first held to at a bounded cost', () => {
    const command = `${'"$('.repeat(50_000)} git status`;
    const cost = repeatedReferenceCost(
      () => {
        expect(decideAsAgent(command).deny).toBeFalsy();
      },
      // One timed run and a short batch: this test runs next to seventy
      // others in a file that has five seconds per test.
      { rounds: 1, referenceBatchMs: 100 },
    );
    const measured = describeCost(
      'git guard, "$(" x 50000',
      cost.units,
      HEAVIEST_INPUT_LIMIT_UNITS,
      `${cost.cpuMs.toFixed(0)} ms, reference ${cost.referenceMs.toFixed(3)} ms`,
    );
    expect(cost.units, measured).toBeGreaterThan(0);
    expect(cost.units, measured).toBeLessThan(HEAVIEST_INPUT_LIMIT_UNITS);
  });
});
