import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const guard = require('./guard-git.cjs') as {
  decide: (
    input: { cwd?: string; tool_input?: { command?: string }; agent_id?: string },
    opts?: {
      findTop?: (dir: string) => { top: string; kind: string } | null;
      home?: string;
      pathExists?: (p: string) => boolean;
    },
  ) => { allow?: true; deny?: string };
  findTop: (dir: string) => { top: string; kind: string } | null;
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

// By default a call comes from a subagent (agent_id set), which is who the
// incidents behind L15 and L38 came from; `main` marks the main session.
function run(command: string, cwd: string, who: 'subagent' | 'main' = 'subagent') {
  return guard.decide(
    { cwd, tool_input: { command }, ...(who === 'subagent' ? { agent_id: 'a1' } : {}) },
    { findTop, home: '/home/u', pathExists },
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
      'git pull -q',
      'git merge --no-edit origin/main',
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
    allowed(`git worktree remove ${WT_A}`, WT_A);
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
      'git update-ref refs/heads/main abc123',
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
});
