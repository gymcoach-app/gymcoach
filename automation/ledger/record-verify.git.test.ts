import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The recorder's tree against real git. The merge gate matches a ledger line
// to a commit by this tree (#596), so a dirty tree that comes out as HEAD's
// would let a run on edited files count for the commit.

const require = createRequire(import.meta.url);
const recorder = require('./record-verify.cjs') as {
  makeGit: (root: string) => unknown;
  gitState: (git: unknown) => {
    headSha: string | null;
    treeSha: string | null;
    dirty: boolean | null;
  };
};

let repo: string;

function sh(...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const nextSecond = () => sleep(Math.ceil(Date.now() / 1000) * 1000 + 5 - Date.now());

const state = () => recorder.gitState(recorder.makeGit(repo));

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'gymcoach-record-verify-'));
  sh('init', '-q', '-b', 'main');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('record-verify.cjs tree of a dirty checkout', () => {
  it('is the tree of HEAD on a clean checkout', () => {
    writeFileSync(join(repo, 'clean.ts'), 'export const c = 1;\n');
    sh('add', 'clean.ts');
    sh('commit', '-q', '-m', 'clean');
    expect(state()).toMatchObject({ dirty: false, treeSha: sh('rev-parse', 'HEAD^{tree}') });
  });

  // The racy case: the file is committed and then rewritten with other
  // content of the same size within one second, and the recorder runs in a
  // later second. git's stat data for the file are then unchanged (same size,
  // same whole-second times), and only the "entry is not older than the index
  // file" rule makes it compare the content. A temporary index with a fresh
  // modification time defeated that rule: the tree came out as HEAD's (40
  // misses in 40 tries before the fix, and about 1 in 25 without the wait).
  it.each([1, 2, 3])(
    'sees a same-size edit made in the same second as the commit (try %i)',
    async (n) => {
      // Leave room for the write, the commit and the rewrite in one second.
      if (Date.now() % 1000 > 600) await nextSecond();
      writeFileSync(join(repo, 'a.ts'), `export const a = ${n};\n`);
      sh('add', 'a.ts');
      sh('commit', '-q', '-m', `a ${n}`);
      const headTree = sh('rev-parse', 'HEAD^{tree}');
      writeFileSync(join(repo, 'a.ts'), `export const a = ${n + 5};\n`);
      await nextSecond();
      const result = state();
      expect(result.dirty).toBe(true);
      expect(result.treeSha).toMatch(/^[0-9a-f]{40}$/);
      expect(result.treeSha).not.toBe(headTree);
      // And it is the tree a commit of the files would have.
      sh('add', 'a.ts');
      expect(result.treeSha).toBe(sh('write-tree'));
      sh('reset', '-q', '--hard', 'HEAD');
    },
    20_000,
  );

  it('sees it without any wait as well, and leaves the real index alone', () => {
    writeFileSync(join(repo, 'b.ts'), 'export const b = 1;\n');
    sh('add', 'b.ts');
    sh('commit', '-q', '-m', 'b');
    const headTree = sh('rev-parse', 'HEAD^{tree}');
    writeFileSync(join(repo, 'b.ts'), 'export const b = 2;\n');
    expect(state().treeSha).not.toBe(headTree);
    // Nothing was staged by the recorder.
    expect(sh('diff', '--cached', '--name-only')).toBe('');
    expect(sh('status', '--porcelain')).toBe('M b.ts');
    sh('reset', '-q', '--hard', 'HEAD');
  });
});
