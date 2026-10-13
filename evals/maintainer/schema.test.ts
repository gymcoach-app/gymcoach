import { describe, expect, it } from 'vitest';
import { evalResultSchema, evalTaskSchema } from './schema';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const task = {
  schemaVersion: 1,
  id: 'dev-example',
  family: 'parsing',
  split: 'dev',
  source: { kind: 'historical', issue: 1, pr: 2 },
  snapshot: { baseSha: SHA_A, fixSha: SHA_B },
  statement: 'A requirement phrased as an operator would phrase it, with no hint of the fix.',
  reference: { paths: ['lib/a.ts'] },
  grader: { hidden: ['lib/a.test.ts'], preserved: [] },
  budget: { maxTurns: 10, maxWallSeconds: 600 },
  leakage: ['none known'],
};

describe('evalTaskSchema', () => {
  it('accepts a complete task', () => {
    expect(evalTaskSchema.parse(task).id).toBe('dev-example');
  });

  it('rejects short SHAs, paths outside the repo, unknown splits and extra keys', () => {
    expect(() =>
      evalTaskSchema.parse({ ...task, snapshot: { baseSha: 'abc123', fixSha: SHA_B } }),
    ).toThrow();
    expect(() => evalTaskSchema.parse({ ...task, reference: { paths: ['../x.ts'] } })).toThrow();
    expect(() =>
      evalTaskSchema.parse({ ...task, grader: { hidden: ['/etc/passwd'], preserved: [] } }),
    ).toThrow();
    expect(() => evalTaskSchema.parse({ ...task, split: 'train' })).toThrow();
    expect(() => evalTaskSchema.parse({ ...task, answer: 'x' })).toThrow();
  });

  it('needs at least one hidden test and one leakage note', () => {
    expect(() =>
      evalTaskSchema.parse({ ...task, grader: { hidden: [], preserved: [] } }),
    ).toThrow();
    expect(() => evalTaskSchema.parse({ ...task, leakage: [] })).toThrow();
  });
});

describe('evalResultSchema', () => {
  const result = {
    schemaVersion: 1,
    taskId: 'dev-example',
    split: 'dev',
    agent: 'dry',
    baseSha: SHA_A,
    startedAt: '2026-10-13T10:00:00.000Z',
    finishedAt: '2026-10-13T10:01:00.000Z',
    durationsMs: { materialise: 1000, agent: 0, grade: null },
    outcome: 'infra-error',
    hidden: [],
    preserved: [],
    infraErrors: ['grade: the test database did not start'],
    gradeInputsRestored: [],
    agentRun: { exitCode: null, costUsd: null, turns: null, note: null },
    environment: {
      node: 'v22.17.1',
      dependenciesMatchBase: true,
      networkBlockedForAgent: null,
      agentContained: null,
      networkBlockedForGrader: true,
    },
  };

  it('keeps an infrastructure error as a recorded outcome with unknown counts', () => {
    expect(evalResultSchema.parse(result).outcome).toBe('infra-error');
  });

  it('rejects an unknown outcome', () => {
    expect(() => evalResultSchema.parse({ ...result, outcome: 'skipped' })).toThrow();
  });
});
