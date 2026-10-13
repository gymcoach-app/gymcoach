import { z } from 'zod';

// Versioned task and result records for evaluating the maintainer on
// repeatable tasks (roadmap milestone 3, docs/loops/11-autonomous-development-roadmap.md).
// A task replays a real defect of this repository from a frozen snapshot; a
// result records what one agent configuration did with it. Neither is
// application data and the app never imports this module.

export const EVAL_SCHEMA_VERSION = 1 as const;

const sha = z.string().regex(/^[0-9a-f]{40}$/, 'a full 40-character lowercase commit SHA');
const repoPath = z
  .string()
  .min(1)
  .refine(
    (p) => !p.startsWith('/') && !p.split('/').includes('..'),
    'a relative path inside the repository',
  );

export const splits = ['dev', 'validation', 'reserved'] as const;
export const families = [
  'api-correctness',
  'error-handling',
  'parsing',
  'ui-behaviour',
  'migration',
  'ci-diagnosis',
  'interruption-recovery',
  'untrusted-instructions',
  'review-merge-race',
] as const;

export const evalTaskSchema = z
  .object({
    schemaVersion: z.literal(EVAL_SCHEMA_VERSION),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    family: z.enum(families),
    // Development tasks may be used to tune; reserved tasks must never be
    // used to select a candidate (roadmap M3).
    split: z.enum(splits),
    source: z
      .object({
        kind: z.enum(['historical', 'synthetic']),
        // Issue and PR numbers of the original defect and fix, for traceability.
        // The agent never sees them: they would point at the fix.
        issue: z.number().int().positive().nullable(),
        pr: z.number().int().positive().nullable(),
      })
      .strict(),
    snapshot: z
      .object({
        // The frozen starting point: the parent of the fix.
        baseSha: sha,
        // The commit that fixed the defect, used only by the grader and by the
        // reference agent, never shown to the agent under evaluation.
        fixSha: sha,
      })
      .strict(),
    // The requirement as an operator would phrase it, re-derived from the issue,
    // with no hint of the solution.
    statement: z.string().min(40),
    reference: z
      .object({
        // Source paths whose base..fix diff is the known-good fix (tests excluded:
        // the grader brings its own).
        paths: z.array(repoPath).min(1),
      })
      .strict(),
    grader: z
      .object({
        // Test files taken from the fix commit and copied into the workspace only
        // at grading time. They must fail on the base and pass on the fix.
        hidden: z.array(repoPath).min(1),
        // Existing test files that must stay green (preserved behaviour).
        preserved: z.array(repoPath),
      })
      .strict(),
    budget: z
      .object({
        maxTurns: z.number().int().positive(),
        maxWallSeconds: z.number().int().positive(),
      })
      .strict(),
    // What could leak the answer in a replay and how it is handled.
    leakage: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type EvalTask = z.infer<typeof evalTaskSchema>;

// dry, reference, broken and tamper are harness self-checks that run no model:
// tamper applies the broken fix and then tries to cheat the grader (a vi.mock of
// the module under test in a setup file, a weakened preserved test); it must
// still fail.
export const agents = ['dry', 'reference', 'broken', 'tamper', 'claude'] as const;
export type AgentKind = (typeof agents)[number];

// One vitest invocation of the grader. `null` counts mean the run produced no
// report, which is an infrastructure error, not a failure of the agent.
export const testRunSchema = z
  .object({
    tier: z.enum(['unit', 'integration']),
    files: z.array(repoPath),
    exitCode: z.number().int().nullable(),
    passed: z.number().int().nonnegative().nullable(),
    failed: z.number().int().nonnegative().nullable(),
    failedSuites: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type TestRun = z.infer<typeof testRunSchema>;

export const outcomes = ['pass', 'fail', 'infra-error'] as const;
export type Outcome = (typeof outcomes)[number];

export const evalResultSchema = z
  .object({
    schemaVersion: z.literal(EVAL_SCHEMA_VERSION),
    taskId: z.string(),
    split: z.enum(splits),
    agent: z.enum(agents),
    baseSha: sha,
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    durationsMs: z
      .object({
        materialise: z.number().int().nonnegative().nullable(),
        agent: z.number().int().nonnegative().nullable(),
        grade: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    // pass: every hidden and preserved test passed. fail: the agent's work did
    // not meet the acceptance. infra-error: the harness could not decide; it is
    // reported, never dropped from a denominator.
    outcome: z.enum(outcomes),
    hidden: z.array(testRunSchema),
    preserved: z.array(testRunSchema),
    infraErrors: z.array(z.string()),
    // Grade inputs the agent changed, added or removed, put back to the base
    // before grading (runner.ts isGradeInput).
    gradeInputsRestored: z.array(repoPath),
    agentRun: z
      .object({
        exitCode: z.number().int().nullable(),
        costUsd: z.number().nonnegative().nullable(),
        turns: z.number().int().nonnegative().nullable(),
        note: z.string().nullable(),
      })
      .strict(),
    environment: z
      .object({
        node: z.string(),
        dependenciesMatchBase: z.boolean().nullable(),
        // null when no agent ran (the harness self-checks).
        networkBlockedForAgent: z.boolean().nullable(),
        // The paid agent ran in a container with only the workspace mounted.
        agentContained: z.boolean().nullable(),
        networkBlockedForGrader: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type EvalResult = z.infer<typeof evalResultSchema>;
