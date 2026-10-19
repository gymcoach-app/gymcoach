import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Git, runGit, verifyBaseUpdates } from './base-update';

// Real git in a throwaway repository: the hops are what git proves, so the
// cases are built as an author would build them.
let repo: string;
let git: Git;

function sh(...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: repo, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function commitFile(file: string, content: string, message: string): string {
  writeFileSync(join(repo, file), content);
  sh('add', file);
  sh('commit', '-q', '-m', message);
  return sh('rev-parse', 'HEAD');
}

// Merges `other` into the checked-out branch with an optional hand edit
// before the merge commit is written.
function mergeInto(branch: string, other: string, edit?: () => void): string {
  sh('checkout', '-q', branch);
  const r = spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'merge', '-q', '--no-ff', '--no-commit', other],
    { cwd: repo, encoding: 'utf8' },
  );
  if (r.status !== 0 && !edit) throw new Error(`merge failed: ${r.stderr}`);
  edit?.();
  sh('add', '-A');
  sh('commit', '-q', '--no-edit', '-m', `merge ${other}`);
  return sh('rev-parse', 'HEAD');
}

let base: string;
let head: string;
let tip: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'gymcoach-base-update-'));
  git = runGit(repo);
  sh('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'CHANGELOG.md'), 'top\n\nmiddle\n\nbottom\n');
  sh('add', 'CHANGELOG.md');
  sh('commit', '-q', '-m', 'base');
  base = sh('rev-parse', 'HEAD');
  sh('checkout', '-q', '-b', 'feature');
  head = commitFile('feature.ts', 'export const a = 1;\n', 'feature');
  sh('checkout', '-q', 'main');
  tip = commitFile('sibling.ts', 'export const b = 2;\n', 'sibling');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('pure base update verification', () => {
  it('proves a clean merge of the live tip into the reviewed head', () => {
    sh('branch', '-f', 'pure', head);
    const merged = mergeInto('pure', tip);
    expect(verifyBaseUpdates(git, merged, tip)).toEqual({
      hops: [{ head: merged, reviewedHead: head, base: tip }],
      error: null,
    });
  });

  it('rejects a merge commit carrying a hand edit', () => {
    sh('branch', '-f', 'edited', head);
    const merged = mergeInto('edited', tip, () =>
      writeFileSync(join(repo, 'feature.ts'), 'export const a = 1;\nexport const sneaky = true;\n'),
    );
    expect(verifyBaseUpdates(git, merged, tip)).toEqual({ hops: [], error: null });
  });

  it('rejects a merge that needed a conflict resolution', () => {
    sh('checkout', '-q', '-b', 'conflict-main', tip);
    const conflictTip = commitFile('feature.ts', 'export const a = 3;\n', 'main touches it too');
    sh('branch', '-f', 'conflicted', head);
    const merged = mergeInto('conflicted', conflictTip, () =>
      writeFileSync(join(repo, 'feature.ts'), 'export const a = 1;\n'),
    );
    expect(verifyBaseUpdates(git, merged, conflictTip)).toEqual({ hops: [], error: null });
  });

  it('rejects a merge whose second parent is not the live tip', () => {
    sh('checkout', '-q', '-b', 'unmerged-branch', base);
    const stranger = commitFile('stranger.ts', 'export const c = 3;\n', 'not on main');
    sh('branch', '-f', 'foreign', head);
    const merged = mergeInto('foreign', stranger);
    expect(verifyBaseUpdates(git, merged, tip)).toEqual({ hops: [], error: null });
  });

  it('rejects a plain commit (a fixup, not a base update)', () => {
    expect(verifyBaseUpdates(git, head, tip)).toEqual({ hops: [], error: null });
  });

  it('follows two pure updates, the older one merging a commit on main', () => {
    sh('branch', '-f', 'twice', head);
    const first = mergeInto('twice', tip);
    sh('checkout', '-q', 'main');
    const tip2 = commitFile('later.ts', 'export const d = 4;\n', 'later sibling');
    const second = mergeInto('twice', tip2);
    expect(verifyBaseUpdates(git, second, tip2).hops).toEqual([
      { head: second, reviewedHead: first, base: tip2 },
      { head: first, reviewedHead: head, base: tip },
    ]);
  });

  it('fails closed when git cannot answer', () => {
    const missing = '0'.repeat(40);
    const result = verifyBaseUpdates(git, missing, tip);
    expect(result.hops).toEqual([]);
    expect(result.error).toMatch(/git rev-list/);
    const broken: Git = () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' });
    expect(verifyBaseUpdates(broken, head, tip)).toEqual({
      hops: [],
      error: expect.stringContaining('not a git repository'),
    });
  });
});
