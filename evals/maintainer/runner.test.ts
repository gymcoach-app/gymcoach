import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UsageError,
  assertOutsideRepo,
  claudeRunAllowed,
  decideOutcome,
  groupByTier,
  parseArgs,
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
