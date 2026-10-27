import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_ENV, type Git, runGit } from './base-update';
import { collectChangedPaths, diffPaths, parseNameStatus } from './changed-paths';

// Real git in a throwaway repository, like base-update.test.ts: the paths are
// what git reports for the approved commit.
let repo: string;
let git: Git;

const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];

function sh(...args: string[]): string {
  const r = spawnSync('git', [...IDENTITY, '-c', 'commit.gpgsign=false', ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(file: string, content: string) {
  const path = join(repo, file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

let tip: string;
let approved: string;
let later: string;

const BODY = 'export const tool = () => 1;\n'.repeat(20);

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'gymcoach-changed-paths-'));
  git = runGit(repo);
  sh('init', '-q', '-b', 'main');
  write('lib/mcp/tool.ts', BODY);
  write('README.md', 'readme\n');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'base');
  sh('checkout', '-q', '-b', 'feature');
  // A rename out of a group A directory plus a docs edit.
  sh('mv', 'lib/mcp/tool.ts', 'lib/tool.ts');
  write('README.md', 'readme, edited\n');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'feature');
  approved = sh('rev-parse', 'HEAD');
  // A push after approval that touches another guarded path.
  write('lib/auth.ts', 'export const x = 1;\n');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'later');
  later = sh('rev-parse', 'HEAD');
  // main moves on after the branch point: its changes are not the PR's.
  sh('checkout', '-q', 'main');
  write('docs/main-only.md', 'main\n');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'main moves');
  tip = sh('rev-parse', 'HEAD');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('changed paths at the approved SHA', () => {
  it('lists both sides of a rename and nothing from main', () => {
    const result = diffPaths(git, tip, approved);
    expect(result.error).toBeNull();
    expect(result.paths?.sort()).toEqual(['README.md', 'lib/mcp/tool.ts', 'lib/tool.ts']);
  });

  it('reads the approved commit, not a later head', () => {
    expect(diffPaths(git, tip, later).paths).toContain('lib/auth.ts');
    expect(diffPaths(git, tip, approved).paths).not.toContain('lib/auth.ts');
  });

  it('fails closed on a malformed SHA or a commit that is not present', () => {
    expect(diffPaths(git, tip, 'abc').paths).toBeNull();
    expect(diffPaths(git, tip, '0'.repeat(40)).error).toMatch(/merge-base/);
  });

  it('refuses when the fetch fails (no origin here) and leaves no ref behind', () => {
    const result = collectChangedPaths(git, 7, 'main', approved, tip);
    expect(result.paths).toBeNull();
    expect(result.error).toMatch(/fetch/);
    expect(sh('for-each-ref', 'refs/gymcoach-gate')).toBe('');
  });

  it('parses name-status output, renames and copies with two paths', () => {
    expect(parseNameStatus('M\0a.ts\0R100\0old.ts\0new.ts\0C75\0x.ts\0y.ts\0D\0gone.ts\0')).toEqual(
      ['a.ts', 'old.ts', 'new.ts', 'x.ts', 'y.ts', 'gone.ts'],
    );
    expect(() => parseNameStatus('R100\0only-one.ts\0')).toThrow();
    expect(() => parseNameStatus('??\0a.ts\0')).toThrow();
  });
});
