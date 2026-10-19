import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_ENV, type Git, runGit, verifyBaseUpdates } from './base-update';

// Real git in a throwaway repository: the hops are what git proves, so the
// cases are built as an author would build them. The harness, like the gate,
// ignores the host's global and system git config, so a user identity or a
// merge driver configured on this machine cannot hide a bug.
let repo: string;
let git: Git;

const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];

function raw(args: string[]) {
  return spawnSync('git', [...IDENTITY, '-c', 'commit.gpgsign=false', ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
  });
}

function sh(...args: string[]): string {
  const r = raw(args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(file: string, content: string) {
  const path = join(repo, file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function commitFile(file: string, content: string, message: string): string {
  write(file, content);
  sh('add', file);
  sh('commit', '-q', '-m', message);
  return sh('rev-parse', 'HEAD');
}

// A new commit on main, which becomes the live tip.
let mainCounter = 0;
function advanceMain(): string {
  sh('checkout', '-q', 'main');
  mainCounter += 1;
  return commitFile(`main-${mainCounter}.ts`, `export const m = ${mainCounter};\n`, `main ${mainCounter}`);
}

// Merges `other` into `branch` (created at `from` when given), optionally with
// a hand edit before the merge commit is written.
function mergeInto(branch: string, other: string, opts: { from?: string; edit?: () => void } = {}) {
  if (opts.from) sh('branch', '-f', branch, opts.from);
  sh('checkout', '-q', branch);
  const r = raw(['merge', '-q', '--no-ff', '--no-commit', other]);
  if (r.status !== 0 && !opts.edit) throw new Error(`merge failed: ${r.stderr}`);
  opts.edit?.();
  sh('add', '-A');
  sh('commit', '-q', '--no-edit', '-m', `merge ${other}`);
  return sh('rev-parse', 'HEAD');
}

function worktreeCount(): number {
  return sh('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;
}

let base: string;
let head: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'gymcoach-base-update-'));
  git = runGit(repo);
  sh('init', '-q', '-b', 'main');
  base = commitFile('CHANGELOG.md', 'top\n\nmiddle\n\nbottom\n', 'base');
  sh('checkout', '-q', '-b', 'feature');
  head = commitFile('feature.ts', 'export const a = 1;\n', 'feature');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('pure base update verification', () => {
  it('proves a clean merge of the live tip into the reviewed head', () => {
    const tip = advanceMain();
    const merged = mergeInto('pure', tip, { from: head });
    expect(verifyBaseUpdates(git, merged, tip)).toEqual({
      hops: [{ head: merged, reviewedHead: head, base: tip }],
      basesOnMain: [],
      error: null,
    });
    // The throwaway worktrees are gone.
    expect(worktreeCount()).toBe(1);
  });

  it('rejects a merge commit carrying a hand edit', () => {
    const tip = advanceMain();
    const merged = mergeInto('edited', tip, {
      from: head,
      edit: () => write('feature.ts', 'export const a = 1;\nexport const sneaky = true;\n'),
    });
    expect(verifyBaseUpdates(git, merged, tip).hops).toEqual([]);
  });

  it('rejects a merge that needed a conflict resolution', () => {
    // A side branch stands in for a main that touched the same file, so the
    // later cases still merge cleanly into the real main.
    sh('checkout', '-q', '-b', 'conflict-main', advanceMain());
    const tip = commitFile('feature.ts', 'export const a = 3;\n', 'main touches it too');
    const merged = mergeInto('conflicted', tip, {
      from: head,
      edit: () => write('feature.ts', 'export const a = 1;\n'),
    });
    expect(verifyBaseUpdates(git, merged, tip).hops).toEqual([]);
  });

  it('rejects a merge whose second parent is not the live tip', () => {
    const tip = advanceMain();
    sh('checkout', '-q', '-b', 'stranger', base);
    const stranger = commitFile('stranger.ts', 'export const c = 3;\n', 'not on main');
    const merged = mergeInto('foreign', stranger, { from: head });
    expect(verifyBaseUpdates(git, merged, tip).hops).toEqual([]);
  });

  it('rejects swapped parents (the head merged into main, not main into the head)', () => {
    const tip = advanceMain();
    // First parent main, second the reviewed head.
    const swapped = mergeInto('swapped', head, { from: tip });
    expect(verifyBaseUpdates(git, swapped, tip).hops).toEqual([]);
  });

  it('rejects an octopus merge', () => {
    const tip = advanceMain();
    sh('checkout', '-q', '-b', 'octo-side', base);
    const side = commitFile('side.ts', 'export const s = 1;\n', 'side');
    sh('branch', '-f', 'octopus', head);
    sh('checkout', '-q', 'octopus');
    sh('merge', '-q', '--no-ff', '-m', 'octopus', tip, side);
    const octopus = sh('rev-parse', 'HEAD');
    expect(sh('rev-list', '--parents', '-n', '1', octopus).split(' ')).toHaveLength(4);
    expect(verifyBaseUpdates(git, octopus, tip).hops).toEqual([]);
  });

  it('rejects a plain commit (a fixup, not a base update)', () => {
    expect(verifyBaseUpdates(git, head, advanceMain()).hops).toEqual([]);
  });

  it('ends the chain when the reviewed head changes .gitattributes', () => {
    // With `merge=union`, a conflicting update would re-merge "cleanly": the
    // reviewed head must not choose how the re-merge resolves.
    sh('checkout', '-q', '-b', 'attributes', head);
    const withAttrs = commitFile('.gitattributes', '*.md merge=union\n', 'attributes');
    const tip = advanceMain();
    const merged = mergeInto('attributes', tip);
    expect(verifyBaseUpdates(git, merged, tip).hops).toEqual([]);
    // Nested attributes files count too.
    sh('checkout', '-q', '-b', 'nested-attributes', head);
    commitFile('lib/.gitattributes', '*.ts merge=union\n', 'nested attributes');
    const tip2 = advanceMain();
    const nested = mergeInto('nested-attributes', tip2);
    expect(verifyBaseUpdates(git, nested, tip2).hops).toEqual([]);
    expect(withAttrs).toMatch(/^[0-9a-f]{40}$/);
  });

  it('follows two pure updates, the older one merging a commit on main', () => {
    const tip = advanceMain();
    const first = mergeInto('twice', tip, { from: head });
    const tip2 = advanceMain();
    const second = mergeInto('twice', tip2);
    expect(verifyBaseUpdates(git, second, tip2).hops).toEqual([
      { head: second, reviewedHead: first, base: tip2 },
      { head: first, reviewedHead: head, base: tip },
    ]);
  });

  it('ends the chain at an older hop whose second parent is not on main', () => {
    sh('checkout', '-q', '-b', 'off-main', base);
    const offMain = commitFile('off-main.ts', 'export const o = 1;\n', 'never merged');
    const first = mergeInto('older-off-main', offMain, { from: head });
    const tip = advanceMain();
    const second = mergeInto('older-off-main', tip);
    // Only the newest hop is proven; the older one brought in an unmerged branch.
    expect(verifyBaseUpdates(git, second, tip).hops).toEqual([
      { head: second, reviewedHead: first, base: tip },
    ]);
  });

  it('follows at most five hops', () => {
    sh('branch', '-f', 'many', head);
    const heads = [head];
    let tip = '';
    for (let i = 0; i < 6; i += 1) {
      tip = advanceMain();
      heads.push(mergeInto('many', tip));
    }
    const { hops } = verifyBaseUpdates(git, heads[6]!, tip);
    // Six pure hops exist; the walk stops after five (MAX_HOPS).
    expect(hops).toHaveLength(5);
    expect(hops.at(-1)!.reviewedHead).toBe(heads[1]);
  });

  it('proves which record bases are on main', () => {
    const tip = advanceMain();
    sh('checkout', '-q', '-b', 'stack-parent', base);
    const stackTip = commitFile('stack.ts', 'export const p = 1;\n', 'parent PR, never merged');
    const result = verifyBaseUpdates(git, head, tip, [base, stackTip, base]);
    expect(result.basesOnMain).toEqual([base]);
    expect(result.error).toBeNull();
  });

  it('fails closed when git cannot answer', () => {
    const tip = advanceMain();
    const missing = '0'.repeat(40);
    const result = verifyBaseUpdates(git, missing, tip);
    expect(result).toMatchObject({ hops: [], basesOnMain: [] });
    expect(result.error).toMatch(/git rev-list/);
    // An unknown record base is an error too, never "not on main".
    expect(verifyBaseUpdates(git, head, tip, [missing]).error).toMatch(/merge-base/);
    const broken: Git = () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' });
    expect(verifyBaseUpdates(broken, head, tip)).toEqual({
      hops: [],
      basesOnMain: [],
      error: expect.stringContaining('not a git repository'),
    });
  });
});
