import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_ENV, type Git, runGit } from './base-update';
import {
  type LedgerRead,
  collectLocalGate,
  ledgerFile,
  matchRuns,
  parseVerifyLines,
  readLedger,
} from './local-gate-collect';
import { evaluateLocalGate } from './local-gate';

const require = createRequire(import.meta.url);
// The real recorder: the lines the gate reads are the lines verify.sh writes.
const recorder = require('../ledger/record-verify.cjs') as {
  makeGit: (root: string) => unknown;
  gitState: (git: unknown) => {
    headSha: string | null;
    treeSha: string | null;
    dirty: boolean | null;
    branchHash: string | null;
  };
  buildLine: (
    opts: Record<string, string>,
    state: ReturnType<typeof recorder.gitState>,
    env: Record<string, string | undefined>,
    nowIso: string,
  ) => Record<string, unknown>;
  ledgerPath: (env: Record<string, string | undefined>) => string;
};

let dir: string;
let repo: string;
let git: Git;

function sh(...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(file: string, content: string) {
  const path = join(repo, file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function commit(file: string, content: string): string {
  write(file, content);
  sh('add', file);
  sh('commit', '-q', '-m', `edit ${file}`);
  return sh('rev-parse', 'HEAD');
}

const FULL_STEPS =
  'slot|passed|1;prisma|passed|1;lint|passed|1;typecheck|passed|1;unit|passed|1;script-tests|passed|1;build|passed|1;infra-lock|passed|1;test-db|passed|1;integration|passed|1;e2e|passed|1;';

// One line as verify.sh would record it for the repository as it is now: the
// tree is taken before the first step (`edit` runs in between) and at exit.
function record(
  over: { tier?: string; exit?: string; steps?: string; at?: string; edit?: () => void } = {},
): Record<string, unknown> {
  const before = recorder.gitState(recorder.makeGit(repo)).treeSha;
  over.edit?.();
  return recorder.buildLine(
    {
      tier: over.tier ?? 'full',
      exit: over.exit ?? '0',
      started: '1700000000000',
      steps: over.steps ?? FULL_STEPS,
      'start-tree': before ?? 'none',
    },
    recorder.gitState(recorder.makeGit(repo)),
    {},
    over.at ?? '2026-11-20T10:00:00.000Z',
  );
}

const ledgerOf = (lines: unknown[]): LedgerRead => {
  const text = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n');
  const parsed = parseVerifyLines(`${text}\n`);
  return {
    state: {
      status: 'ok',
      path: '/ledger.jsonl',
      verifyLines: parsed.lines.length,
      skippedLines: parsed.skipped,
    },
    lines: parsed.lines,
  };
};

let base: string;
let head: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gymcoach-local-gate-'));
  repo = join(dir, 'repo');
  mkdirSync(repo);
  sh('init', '-q', '-b', 'main');
  write('.gitignore', 'node_modules/\n');
  sh('add', '.gitignore');
  base = commit('lib/a.ts', 'export const a = 1;\n');
  head = commit('lib/a.ts', 'export const a = 2;\n');
  git = runGit(repo);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ledger location', () => {
  it('resolves the same file as the recorder that writes it', () => {
    for (const env of [
      {},
      { XDG_DATA_HOME: '/data' },
      { GYMCOACH_USAGE_LEDGER_PATH: '/elsewhere/l.jsonl', XDG_DATA_HOME: '/data' },
    ]) {
      expect(ledgerFile(env)).toBe(recorder.ledgerPath(env));
    }
    expect(ledgerFile({}, '/home/u')).toBe('/home/u/.local/share/gymcoach-runs/ledger.jsonl');
    expect(ledgerFile({ XDG_DATA_HOME: '/data' }, '/home/u')).toBe(
      '/data/gymcoach-runs/ledger.jsonl',
    );
  });
});

describe('reading the ledger', () => {
  it('reports a disabled ledger without reading any file', () => {
    const read = () => {
      throw new Error('must not read');
    };
    expect(readLedger({ GYMCOACH_USAGE_LEDGER: 'off' }, read).state).toEqual({
      status: 'disabled',
    });
    expect(readLedger({ GYMCOACH_USAGE_LEDGER: 'OFF' }, read).state).toEqual({
      status: 'disabled',
    });
  });

  it('reports a missing ledger with the path it looked at', () => {
    const path = join(dir, 'nowhere', 'ledger.jsonl');
    expect(readLedger({ GYMCOACH_USAGE_LEDGER_PATH: path }).state).toEqual({
      status: 'missing',
      path,
    });
    expect(readLedger({ XDG_DATA_HOME: join(dir, 'xdg') }).state).toEqual({
      status: 'missing',
      path: join(dir, 'xdg', 'gymcoach-runs', 'ledger.jsonl'),
    });
  });

  it('reports an unreadable ledger with the error code', () => {
    // A directory where the file should be.
    expect(readLedger({ GYMCOACH_USAGE_LEDGER_PATH: dir }).state).toEqual({
      status: 'unreadable',
      path: dir,
      error: 'EISDIR',
    });
    const locked = join(dir, 'locked.jsonl');
    writeFileSync(locked, '');
    chmodSync(locked, 0o000);
    // Root reads through the mode bits; the directory case above still holds.
    if (process.getuid?.() !== 0) {
      expect(readLedger({ GYMCOACH_USAGE_LEDGER_PATH: locked }).state).toMatchObject({
        status: 'unreadable',
        error: 'EACCES',
      });
    }
  });

  it('keeps valid verify lines with their line numbers and counts the rest', () => {
    const good = record();
    const text = [
      JSON.stringify({ v: 1, kind: 'prompt', at: '2026-11-20T10:00:00.000Z' }),
      JSON.stringify(good),
      '',
      'not json',
      JSON.stringify({ ...good, exit: 'zero' }),
      JSON.stringify({ ...good, extra: true }),
      JSON.stringify(good),
      '"a string"',
    ].join('\n');
    const { lines, skipped } = parseVerifyLines(text);
    expect(lines.map((l) => l.line)).toEqual([2, 7]);
    expect(skipped).toBe(4);
  });

  it('reads an empty ledger as zero lines, not as missing', () => {
    const empty = join(dir, 'empty.jsonl');
    writeFileSync(empty, '');
    expect(readLedger({ GYMCOACH_USAGE_LEDGER_PATH: empty }).state).toEqual({
      status: 'ok',
      path: empty,
      verifyLines: 0,
      skippedLines: 0,
    });
  });
});

describe('matching ledger lines to heads with git', () => {
  it('matches a run on a clean checkout of the head', () => {
    const evidence = matchRuns(git, ledgerOf([record()]), [head]);
    expect(evidence.error).toBeNull();
    expect(evidence.heads).toEqual([{ head, tree: sh('rev-parse', `${head}^{tree}`) }]);
    expect(evidence.runs).toMatchObject([
      { line: 1, head, match: 'tree', dirty: false, tier: 'full', exit: 0, headSha: head },
    ]);
  });

  it('matches a run made before the commit: HEAD is the parent, the tree is the commit', () => {
    write('lib/b.ts', 'export const b = 1;\n');
    const line = record();
    sh('add', 'lib/b.ts');
    sh('commit', '-q', '-m', 'add b');
    const committed = sh('rev-parse', 'HEAD');
    try {
      expect(line.headSha).toBe(head);
      expect(line.dirty).toBe(true);
      const evidence = matchRuns(git, ledgerOf([line]), [committed]);
      expect(evidence.runs).toMatchObject([{ head: committed, match: 'tree', headSha: head }]);
      // And not the parent it was started at.
      expect(matchRuns(git, ledgerOf([line]), [head]).runs).toEqual([]);
    } finally {
      sh('reset', '-q', '--hard', head);
    }
  });

  it('matches a dirty run whose only difference is the untracked node_modules symlink', () => {
    symlinkSync(join(dir, 'install'), join(repo, 'node_modules'));
    try {
      const line = record();
      expect(line.dirty).toBe(true);
      expect(line.treeSha).not.toBe(sh('rev-parse', `${head}^{tree}`));
      const evidence = matchRuns(git, ledgerOf([line]), [head]);
      expect(evidence.runs).toMatchObject([
        { line: 1, head, match: 'tree-plus-node-modules-symlink', dirty: true },
      ]);
      // The decision accepts it and names the line.
      const result = evaluateLocalGate({
        evidence,
        approvedSha: head,
        carriedHeads: [],
        changedPaths: ['lib/a.ts'],
        authorTier: 'maintainer',
      });
      expect(result).toMatchObject({ ok: true, report: { accepted: { line: 1 } } });
    } finally {
      unlinkSync(join(repo, 'node_modules'));
    }
  });

  it('matches the symlink run made before the commit as well', () => {
    symlinkSync(join(dir, 'install'), join(repo, 'node_modules'));
    write('lib/c.ts', 'export const c = 1;\n');
    try {
      const line = record();
      sh('add', 'lib/c.ts');
      sh('commit', '-q', '-m', 'add c');
      const committed = sh('rev-parse', 'HEAD');
      expect(matchRuns(git, ledgerOf([line]), [committed]).runs).toMatchObject([
        { head: committed, match: 'tree-plus-node-modules-symlink', headSha: head },
      ]);
    } finally {
      unlinkSync(join(repo, 'node_modules'));
      sh('reset', '-q', '--hard', head);
    }
  });

  it.each([
    ['an uncommitted edit', () => write('lib/a.ts', 'export const a = 3;\n')],
    ['an extra untracked file', () => write('scratch.ts', 'export {};\n')],
    ['an extra file in a subdirectory', () => write('lib/extra.ts', 'export {};\n')],
    ['a deleted file', () => unlinkSync(join(repo, 'lib/a.ts'))],
    [
      'the symlink plus an edit',
      () => {
        symlinkSync(join(dir, 'install'), join(repo, 'node_modules'));
        write('lib/a.ts', 'export const a = 3;\n');
      },
    ],
    [
      'the symlink plus an extra file',
      () => {
        symlinkSync(join(dir, 'install'), join(repo, 'node_modules'));
        write('scratch.ts', 'export {};\n');
      },
    ],
    ['a symlink under another name', () => symlinkSync(join(dir, 'install'), join(repo, 'modules'))],
    ['a node_modules file, not a symlink', () => write('node_modules', 'not a link\n')],
    [
      'a nested node_modules symlink',
      () => symlinkSync(join(dir, 'install'), join(repo, 'lib', 'node_modules')),
    ],
  ])('never matches a dirty run with %s', (_name, dirty) => {
    try {
      dirty();
      const line = record();
      expect(line.dirty).toBe(true);
      const evidence = matchRuns(git, ledgerOf([line]), [head]);
      expect(evidence.error).toBeNull();
      expect(evidence.runs).toEqual([]);
    } finally {
      sh('reset', '-q', '--hard', head);
      sh('clean', '-q', '-fd');
      rmSync(join(repo, 'node_modules'), { force: true });
    }
  });

  it('never matches a run whose files changed while it ran', () => {
    const line = record({ edit: () => write('lib/a.ts', 'export const a = 9;\n') });
    sh('reset', '-q', '--hard', head);
    expect(line).toMatchObject({ treeChanged: true, treeSha: null, headSha: head, exit: 0 });
    const evidence = matchRuns(git, ledgerOf([line]), [head]);
    expect(evidence.runs).toEqual([]);
    expect(evidence.changedDuringRun).toBe(1);
  });

  it('never matches a line written before the start-and-exit comparison existed', () => {
    const legacy = record();
    delete legacy.treeChanged;
    const evidence = matchRuns(git, ledgerOf([legacy]), [head]);
    expect(evidence.ledger).toMatchObject({ verifyLines: 1, skippedLines: 0 });
    expect(evidence.runs).toEqual([]);
  });

  it('never matches a run on another commit, and keeps the tiers and exits as recorded', () => {
    const lines = [
      record({ tier: 'default', steps: 'lint|passed|1;' }),
      record({ exit: '1', steps: 'lint|failed|1;', at: '2026-11-20T11:00:00.000Z' }),
    ];
    expect(matchRuns(git, ledgerOf(lines), [base]).runs).toEqual([]);
    expect(matchRuns(git, ledgerOf(lines), [head]).runs).toMatchObject([
      { line: 1, tier: 'default', exit: 0 },
      { line: 2, tier: 'full', exit: 1, steps: [{ name: 'lint', outcome: 'failed' }] },
    ]);
  });

  it('counts a dirty run whose tree is not in this repository, and does not match it', () => {
    const line = { ...record(), dirty: true, treeSha: '9'.repeat(40) };
    const evidence = matchRuns(git, ledgerOf([line]), [head]);
    expect(evidence.error).toBeNull();
    expect(evidence.runs).toEqual([]);
    expect(evidence.treeAbsent).toBe(1);
  });

  it('never takes a commit or a blob id in the tree field for a tree', () => {
    const blob = sh('rev-parse', `${head}:lib/a.ts`);
    for (const treeSha of [head, blob]) {
      const evidence = matchRuns(git, ledgerOf([{ ...record(), dirty: true, treeSha }]), [head]);
      expect(evidence.error).toBeNull();
      expect(evidence.runs).toEqual([]);
    }
  });

  it('matches one run to every head that has its tree, and many lines in one pass', () => {
    // An empty commit: another head, the same tree.
    sh('commit', '-q', '--allow-empty', '-m', 'empty');
    const twin = sh('rev-parse', 'HEAD');
    sh('reset', '-q', '--hard', head);
    const one = record();
    const lines = Array.from({ length: 450 }, () => one);
    const evidence = matchRuns(git, ledgerOf(lines), [head, twin, head]);
    expect(evidence.heads.map((h) => h.head)).toEqual([head, twin]);
    expect(evidence.runs).toHaveLength(900);
  });

  it('proves many dirty trees across batches', () => {
    // Five distinct dirty trees, two pairs per git call: only the symlink one matches.
    const lines: Record<string, unknown>[] = [];
    try {
      for (let i = 0; i < 4; i += 1) {
        write('scratch.ts', `export const n = ${i};\n`);
        lines.push(record());
      }
      unlinkSync(join(repo, 'scratch.ts'));
      symlinkSync(join(dir, 'install'), join(repo, 'node_modules'));
      lines.push(record());
    } finally {
      rmSync(join(repo, 'node_modules'), { force: true });
      sh('clean', '-q', '-fd');
    }
    const evidence = matchRuns(git, ledgerOf(lines), [head], 2);
    expect(evidence.error).toBeNull();
    expect(evidence.runs.map((r) => r.line)).toEqual([5]);
  });

  it('reports a git error when a head is not in the repository, or is not a full SHA', () => {
    const absent = matchRuns(git, ledgerOf([record()]), ['9'.repeat(40)]);
    expect(absent.runs).toEqual([]);
    expect(absent.error).toContain('rev-parse');
    expect(matchRuns(git, ledgerOf([record()]), ['abc']).error).toContain('not a full SHA');
  });

  it('runs no git at all when the ledger could not be read', () => {
    const never: Git = () => {
      throw new Error('git must not run');
    };
    expect(matchRuns(never, { state: { status: 'disabled' }, lines: [] }, [head])).toEqual({
      ledger: { status: 'disabled' },
      heads: [],
      runs: [],
      changedDuringRun: 0,
      treeAbsent: 0,
      error: null,
    });
  });
});

describe('several checkouts, one ledger', () => {
  it('counts a run made in another worktree of the same clone, by its tree', () => {
    const other = join(dir, 'other-worktree');
    sh('worktree', 'add', '-q', '--detach', other, head);
    symlinkSync(join(dir, 'install'), join(other, 'node_modules'));
    const state = recorder.gitState(recorder.makeGit(other));
    const line = recorder.buildLine(
      { tier: 'full', exit: '0', started: '1', steps: FULL_STEPS, 'start-tree': state.treeSha! },
      state,
      {},
      '2026-11-20T10:00:00.000Z',
    );
    sh('worktree', 'remove', '--force', other);
    // A run on other content, from a third checkout, sits in the same file.
    const unrelated = { ...line, treeSha: sh('rev-parse', `${base}^{tree}`), dirty: false };
    const file = join(dir, 'shared-ledger.jsonl');
    writeFileSync(file, `${JSON.stringify(unrelated)}\n${JSON.stringify(line)}\n`);
    const evidence = collectLocalGate(git, [head], { GYMCOACH_USAGE_LEDGER_PATH: file });
    expect(evidence.ledger).toEqual({ status: 'ok', path: file, verifyLines: 2, skippedLines: 0 });
    expect(evidence.runs).toMatchObject([
      { line: 2, head, match: 'tree-plus-node-modules-symlink' },
    ]);
  });

  it('reads the ledger under XDG_DATA_HOME, where the recorder writes it', () => {
    const xdg = join(dir, 'xdg-home');
    const file = recorder.ledgerPath({ XDG_DATA_HOME: xdg });
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `${JSON.stringify(record())}\n`);
    expect(collectLocalGate(git, [head], { XDG_DATA_HOME: xdg }).runs).toHaveLength(1);
    expect(collectLocalGate(git, [head], { XDG_DATA_HOME: join(dir, 'other-xdg') }).ledger).toEqual(
      { status: 'missing', path: join(dir, 'other-xdg', 'gymcoach-runs', 'ledger.jsonl') },
    );
  });
});
