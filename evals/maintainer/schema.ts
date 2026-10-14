import { z } from 'zod';

// Two hours: well below the 3 h after which a run's leftovers count as stale.
export const MAX_WALL_SECONDS = 2 * 60 * 60;

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

// Ids of the static tamper rules (runner.ts TAMPER_RULES). A task whose real
// fix legitimately needs one of these patterns in application code lists the
// rule in grader.allowTamperRules; every other task keeps the full screen.
// The application source roots an agent may write under (runner.ts
// isAgentWritable). Defined here so the task schema can keep
// grader.allowPaths inside them.
export const AGENT_WRITABLE_ROOTS = [
  'app',
  'components',
  'lib',
  'messages',
  'i18n',
  'public',
] as const;

// File names that configure a tool wherever they sit: never agent-writable,
// even under a source root (a nested package.json "imports" map or tsconfig
// changes how the graded code resolves; review of #455).
export const CONFIG_FILE =
  /^(?:package\.json|tsconfig.*\.json|jsconfig.*\.json|\.babelrc.*|babel\.config\..*|.*\.config\.[^/]*)$/;

export const tamperRuleIds = [
  'test-framework',
  'dynamic-require',
  'dynamic-import',
  'module-system',
  'node-modules-path',
  'framework-internals',
  'global-mutation',
  'process-hooks',
  'host-io',
  'subpath-import',
] as const;
export type TamperRuleId = (typeof tamperRuleIds)[number];
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
        // Static tamper rules this task's real fix needs to break (see
        // tamperRuleIds). Empty by default: every rule applies.
        allowTamperRules: z.array(z.enum(tamperRuleIds)).default([]),
        // Extra agent-writable paths (runner.ts isAgentWritable): a narrower
        // path under one of the application source roots, never a config
        // file, a dotfile or a node_modules segment. It cannot widen the
        // allowlist to a root config, a setup file, tests/ or prisma/.
        allowPaths: z
          .array(
            repoPath.refine((p) => {
              const parts = p.replace(/\/+$/, '').split('/');
              return (
                (AGENT_WRITABLE_ROOTS as readonly string[]).includes(parts[0]!) &&
                parts.length > 1 &&
                !parts.some(
                  (s) =>
                    s.startsWith('.') ||
                    s === 'node_modules' ||
                    s === '__mocks__' ||
                    s === '__snapshots__' ||
                    CONFIG_FILE.test(s),
                )
              );
            }, 'under an application source root, not a config, dotfile, node_modules, __mocks__ or __snapshots__'),
          )
          .default([]),
        // A task whose fix changes the Prisma schema. Not supported: the graded
        // schema is always the base file byte for byte, until a check built on
        // Prisma's own parser exists. The runner refuses such a task.
        allowSchemaChanges: z.boolean().default(false),
      })
      .strict(),
    budget: z
      .object({
        maxTurns: z.number().int().positive(),
        // Capped below the runner's leftover sweep threshold (3 h, run.ts
        // STALE_AFTER_MS): a live run must never look stale to another run.
        maxWallSeconds: z.number().int().positive().max(MAX_WALL_SECONDS),
      })
      .strict(),
    // What could leak the answer in a replay and how it is handled.
    leakage: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type EvalTask = z.infer<typeof evalTaskSchema>;

// dry, reference, broken and tamper are harness self-checks that run no model:
// tamper applies the broken fix and then tries to cheat the grader (grade-input
// edits, assertions disabled from application code and from an ignored path, a
// symlink); it must still fail.
export const agents = [
  'dry',
  'reference',
  'broken',
  'tamper',
  'tamper-generator',
  'tamper-inprocess',
  'claude',
] as const;
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
    // The harness canary (runner.ts canaryFiles) in this run: ok (its test
    // passed with this run's nonce and no file reported an integrity
    // failure), failed, missing (no canary test with the nonce in the report),
    // or null when the report was unreadable (an infrastructure error).
    canary: z.enum(['ok', 'failed', 'missing']).nullable(),
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
    // Changes outside the agent-writable allowlist (runner.ts isAgentWritable):
    // left out of every grading tree, which keeps the base version.
    gradeInputsRestored: z.array(repoPath),
    // Agent changes the static tamper check rejected (runner.ts
    // tamperViolations); any entry makes the outcome a fail.
    tamperViolations: z.array(z.string()),
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
        // The contained agent's only network path: the egress proxy that allows
        // the Anthropic API alone. null when no agent ran (the self-checks).
        agentNetwork: z.enum(['egress-proxy-only']).nullable(),
        // The paid agent ran in a container with only the workspace mounted.
        agentContained: z.boolean().nullable(),
        // Every grading step (prisma generate, migrate, vitest) ran in a
        // container: no network for the unit tier, an --internal network shared
        // only with a throwaway Postgres for the integration tier. Nothing an
        // agent wrote runs on the host.
        gradedInContainer: z.literal(true),
      })
      .strict(),
  })
  .strict();
export type EvalResult = z.infer<typeof evalResultSchema>;
