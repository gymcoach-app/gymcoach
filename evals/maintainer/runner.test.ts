import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_HOME,
  SNAPSHOT_EXCLUDES,
  UsageError,
  assertOutsideRepo,
  claudeRunAllowed,
  containerArgs,
  decideOutcome,
  evalSettings,
  groupByTier,
  isGradeInput,
  parseArgs,
  planGradeInputRestore,
  sameDependencies,
  summariseVitestReport,
} from './runner';
import { evalTaskSchema, type TestRun } from './schema';

const run = (over: Partial<TestRun> = {}): TestRun => ({
  tier: 'unit',
  files: ['lib/a.test.ts'],
  exitCode: 0,
  passed: 3,
  failed: 0,
  failedSuites: 0,
  ...over,
});

describe('parseArgs', () => {
  it('reads a task and an agent', () => {
    expect(parseArgs(['--task', 'dev-x', '--agent', 'reference'])).toMatchObject({
      task: 'dev-x',
      agent: 'reference',
      budgetUsd: null,
    });
  });

  it('refuses unknown flags, repeated flags, bad agents and missing values', () => {
    expect(() => parseArgs(['--task', 'dev-x', '--merge'])).toThrow(UsageError);
    expect(() => parseArgs(['--task', 'a', '--task', 'b'])).toThrow(/twice/);
    expect(() => parseArgs(['--task', 'dev-x', '--agent', 'gpt'])).toThrow(/--agent/);
    expect(() => parseArgs(['--task', '--agent', 'dry'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--agent', 'dry'])).toThrow(/--task/);
    expect(() => parseArgs(['--task', 'dev-x', '--budget-usd', '0'])).toThrow(/positive/);
  });
});

describe('claudeRunAllowed', () => {
  it('lets the free agents run', () => {
    expect(claudeRunAllowed({ agent: 'dry', budgetUsd: null }, {})).toEqual({ allowed: true });
  });

  it('needs both a budget and the operator approval for a paid run', () => {
    expect(
      claudeRunAllowed({ agent: 'claude', budgetUsd: null }, { EVAL_BUDGET_APPROVED: '1' }).allowed,
    ).toBe(false);
    expect(claudeRunAllowed({ agent: 'claude', budgetUsd: 2 }, {}).allowed).toBe(false);
    expect(
      claudeRunAllowed({ agent: 'claude', budgetUsd: 2 }, { EVAL_BUDGET_APPROVED: 'yes' }).allowed,
    ).toBe(false);
    expect(
      claudeRunAllowed({ agent: 'claude', budgetUsd: 2 }, { EVAL_BUDGET_APPROVED: '1' }),
    ).toEqual({
      allowed: true,
    });
  });
});

describe('assertOutsideRepo', () => {
  it('refuses the repository itself and anything inside it', () => {
    expect(() => assertOutsideRepo('/repo', '/repo')).toThrow(UsageError);
    expect(() => assertOutsideRepo('/repo/out', '/repo')).toThrow(UsageError);
    expect(() => assertOutsideRepo('/repo/a/../out', '/repo')).toThrow(UsageError);
  });

  it('accepts a sibling or a temp dir', () => {
    expect(() => assertOutsideRepo('/repo-evals/out', '/repo')).not.toThrow();
    expect(() => assertOutsideRepo('/tmp/gymcoach-evals/x', '/repo')).not.toThrow();
  });
});

describe('groupByTier', () => {
  it('routes integration tests to the integration tier', () => {
    expect(
      groupByTier(['lib/a.test.ts', 'tests/integration/b.test.ts', 'components/c.test.tsx']),
    ).toEqual([
      { tier: 'unit', files: ['lib/a.test.ts', 'components/c.test.tsx'] },
      { tier: 'integration', files: ['tests/integration/b.test.ts'] },
    ]);
    expect(groupByTier([])).toEqual([]);
  });
});

describe('summariseVitestReport', () => {
  it('reads the counts of the JSON reporter', () => {
    const raw = JSON.stringify({ numPassedTests: 4, numFailedTests: 1, numFailedTestSuites: 0 });
    expect(summariseVitestReport(raw)).toEqual({ passed: 4, failed: 1, failedSuites: 0 });
  });

  it('turns a missing or unreadable report into unknown counts', () => {
    expect(summariseVitestReport(null)).toEqual({ passed: null, failed: null, failedSuites: null });
    expect(summariseVitestReport('{not json')).toEqual({
      passed: null,
      failed: null,
      failedSuites: null,
    });
    expect(summariseVitestReport('{}')).toEqual({ passed: null, failed: null, failedSuites: null });
  });
});

describe('decideOutcome', () => {
  it('passes only when every hidden and preserved run is green', () => {
    expect(decideOutcome({ hidden: [run()], preserved: [run()], infraErrors: [] })).toBe('pass');
    expect(
      decideOutcome({ hidden: [run({ failed: 1 })], preserved: [run()], infraErrors: [] }),
    ).toBe('fail');
    expect(
      decideOutcome({ hidden: [run()], preserved: [run({ failed: 2 })], infraErrors: [] }),
    ).toBe('fail');
  });

  it('fails a hidden file that does not even load (a failed suite, no test counted)', () => {
    expect(
      decideOutcome({
        hidden: [run({ passed: 0, failed: 0, failedSuites: 1 })],
        preserved: [],
        infraErrors: [],
      }),
    ).toBe('fail');
  });

  it('never passes a run with no test executed', () => {
    expect(decideOutcome({ hidden: [run({ passed: 0 })], preserved: [], infraErrors: [] })).toBe(
      'fail',
    );
  });

  it('reports an infrastructure error instead of a pass or a silent fail', () => {
    expect(decideOutcome({ hidden: [run()], preserved: [run()], infraErrors: ['db down'] })).toBe(
      'infra-error',
    );
    expect(decideOutcome({ hidden: [run({ passed: null })], preserved: [], infraErrors: [] })).toBe(
      'infra-error',
    );
    expect(decideOutcome({ hidden: [], preserved: [run()], infraErrors: [] })).toBe('infra-error');
  });
});

describe('sameDependencies', () => {
  const lock = (version: string, dep: string) =>
    JSON.stringify({ packages: { '': { version }, 'node_modules/zod': { version: dep } } });

  it('ignores the root version bump of a release', () => {
    expect(sameDependencies(lock('0.1.0', '4.0.0'), lock('1.0.0', '4.0.0'))).toBe(true);
  });

  it('notices a changed dependency', () => {
    expect(sameDependencies(lock('1.0.0', '4.0.0'), lock('1.0.0', '4.1.0'))).toBe(false);
  });
});

describe('committed tasks', () => {
  const tasksDir = path.join(__dirname, 'tasks');
  const ids = readdirSync(tasksDir);

  it('has a smoke suite to run', () => {
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it.each(ids)('%s is a valid task with a broken variant and a separate grader', (id) => {
    const task = evalTaskSchema.parse(
      JSON.parse(readFileSync(path.join(tasksDir, id, 'task.json'), 'utf8')),
    );
    expect(task.id).toBe(id);
    expect(existsSync(path.join(tasksDir, id, 'broken.patch'))).toBe(true);
    // The reference fix never includes the grader's own test files.
    for (const file of task.grader.hidden) expect(task.reference.paths).not.toContain(file);
    // The statement must not point the agent at the fix.
    expect(task.statement).not.toMatch(/#\d+|issue \d+|PR \d+|[0-9a-f]{7,40}/i);
    expect(task.snapshot.baseSha).not.toBe(task.snapshot.fixSha);
  });
});

describe('decideOutcome and the vitest exit code', () => {
  it('fails a run whose counts look green but whose exit code is not zero', () => {
    // vitest exits non-zero on an unhandled error even when every test passed.
    expect(decideOutcome({ hidden: [run({ exitCode: 1 })], preserved: [], infraErrors: [] })).toBe(
      'fail',
    );
  });
});

const task = {
  grader: {
    hidden: ['lib/cardio.test.ts'],
    preserved: ['lib/import/track.test.ts'],
  },
};

describe('isGradeInput', () => {
  it('covers tests, test helpers, runner and package configs', () => {
    for (const file of [
      'lib/cardio.test.ts',
      'lib/import/track.test.ts',
      'components/a.test.tsx',
      'tests/integration/setup.ts',
      'tests/integration/helpers/seed.ts',
      'vitest.config.ts',
      'vitest.integration.config.ts',
      'vitest.workspace.ts',
      'vitest.setup.ts',
      'package.json',
      'package-lock.json',
      'tsconfig.json',
    ])
      expect(isGradeInput(file, task), file).toBe(true);
  });

  it('leaves application code to the agent', () => {
    for (const file of ['lib/cardio.ts', 'app/api/x/route.ts', 'prisma/schema.prisma'])
      expect(isGradeInput(file, task), file).toBe(false);
  });
});

describe('planGradeInputRestore', () => {
  const base = new Map([
    ['lib/cardio.ts', 'b-src'],
    ['lib/cardio.test.ts', 'b-hidden-old'],
    ['lib/import/track.test.ts', 'b-preserved'],
    ['vitest.setup.ts', 'b-setup'],
    ['evals/maintainer/runner.test.ts', 'b-evals'],
  ]);

  it('puts back a weakened preserved test and an edited setup file, not the agent code', () => {
    const work = new Map<string, string | null>([
      ['lib/cardio.ts', 'agent-fix'],
      ['lib/cardio.test.ts', 'b-hidden-old'],
      ['lib/import/track.test.ts', 'weakened'],
      ['vitest.setup.ts', 'with-vi-mock'],
    ]);
    expect(planGradeInputRestore(task, base, work)).toEqual({
      restore: ['lib/import/track.test.ts', 'vitest.setup.ts'],
      remove: [],
    });
  });

  it('restores a deleted grade input and removes an added one', () => {
    const work = new Map<string, string | null>([
      ['lib/import/track.test.ts', null],
      ['vitest.setup.ts', 'b-setup'],
      ['vitest.workspace.ts', 'added'],
      ['tests/integration/cheat.ts', 'added'],
      ['lib/cardio.tamper.ts', 'added'],
    ]);
    expect(planGradeInputRestore(task, base, work)).toEqual({
      restore: ['lib/import/track.test.ts'],
      remove: ['tests/integration/cheat.ts', 'vitest.workspace.ts'],
    });
  });

  it('leaves hidden tests to the fix-commit copy and stripped paths stripped', () => {
    const work = new Map<string, string | null>([
      ['lib/cardio.test.ts', 'agent-edit'],
      ['lib/import/track.test.ts', 'b-preserved'],
      ['vitest.setup.ts', 'b-setup'],
    ]);
    expect(planGradeInputRestore(task, base, work)).toEqual({ restore: [], remove: [] });
  });
});

describe('the snapshot and the contained agent', () => {
  it('strips the project .claude directory from the snapshot', () => {
    expect(SNAPSHOT_EXCLUDES).toContain('.claude');
    expect(SNAPSHOT_EXCLUDES).toContain('evals');
  });

  const spec = {
    name: 'gymcoach-eval-abcd',
    image: 'node:22-bookworm',
    workspace: '/tmp/ws',
    nodeModules: '/home/u/repo/node_modules',
    viteCacheInNodeModules: true,
    claudeBinary: '/home/u/.local/share/claude/versions/1',
    home: '/tmp/home',
    uid: 1000,
    gid: 1000,
    command: ['claude', '-p', 'x'],
  };

  it('mounts only the workspace read-write, the install and binary read-only, and a fresh HOME', () => {
    const args = containerArgs(spec);
    const mounts = args.flatMap((a, i) => (args[i - 1] === '-v' ? [a] : []));
    expect(mounts).toEqual([
      '/tmp/ws:/work:rw',
      '/home/u/repo/node_modules:/work/node_modules:ro',
      '/home/u/.local/share/claude/versions/1:/usr/local/bin/claude:ro',
      `/tmp/home:${CONTAINER_HOME}:rw`,
    ]);
    expect(args).toContain('--read-only');
    expect(args.join(' ')).toContain('--cap-drop ALL');
    expect(args).toContain('no-new-privileges');
    expect(args.slice(-4)).toEqual(['node:22-bookworm', 'claude', '-p', 'x']);
  });

  it('passes no host environment except the listed variables', () => {
    const args = containerArgs(spec);
    const env = args.flatMap((a, i) => (args[i - 1] === '-e' ? [a.split('=')[0]] : []));
    expect(env.sort()).toEqual(
      ['CI', 'DISABLE_AUTOUPDATER', 'DISABLE_TELEMETRY', 'GIT_TERMINAL_PROMPT', 'HOME'].sort(),
    );
    expect(args).not.toContain('--env-file');
    expect(args.some((a) => /GH_TOKEN|GITHUB_TOKEN|ANTHROPIC_API_KEY/.test(a))).toBe(false);
  });

  it('denies every publishing and fetching path in the eval settings', () => {
    const deny = (evalSettings().permissions as { deny: string[] }).deny;
    for (const rule of ['Bash(git push:*)', 'Bash(gh:*)', 'Bash(curl:*)', 'WebFetch'])
      expect(deny).toContain(rule);
  });

  it('accepts the tamper self-check agent', () => {
    expect(parseArgs(['--task', 'dev-x', '--agent', 'tamper']).agent).toBe('tamper');
  });
});
