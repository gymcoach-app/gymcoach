import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const guard = require('./guard-git.cjs') as {
  decide: (
    input: { cwd?: string; tool_input?: { command?: string } },
    opts?: { findTop?: (dir: string) => { top: string; kind: string } | null; home?: string },
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

function run(command: string, cwd: string) {
  return guard.decide({ cwd, tool_input: { command } }, { findTop, home: '/home/u' });
}
const allowed = (command: string, cwd = WT_A) => expect(run(command, cwd)).toEqual({ allow: true });
const denied = (command: string, cwd = WT_A) => {
  const res = run(command, cwd);
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
      'git checkout origin/main -- docs/a.md',
      'git restore --staged x',
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
  it('refuses a git command with unbalanced quotes', () => {
    expect(denied(`git commit -m "unterminated && git checkout main`, MAIN)).toContain(
      'unbalanced quotes',
    );
  });

  it('allows commands without git even when they do not parse', () => {
    allowed(`echo "unterminated`, MAIN);
  });

  it('refuses an unterminated here-document around git', () => {
    denied('git commit -F - <<EOF\nno end', MAIN);
  });
});

describe('findTop on a real filesystem', () => {
  it('tells a primary checkout from a linked worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'guard-'));
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
