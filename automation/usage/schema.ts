import { z } from 'zod';
import { measurementSchema, observationSchema } from '@/automation/records/schema';

// Per-run agent usage, recovered from local Claude Code session transcripts
// (roadmap milestone 1). Written as a side file, usage.jsonl, next to a
// baseline's runs.jsonl and keyed by runId, so schema-1 run bundles stay
// readable unchanged. Only per-run aggregates are stored: no transcript
// content, prompts, paths, branch names or session ids.
//
// Same rule as the run records: a value that cannot be verified is unknown
// with a reason, never 0.

export const USAGE_SCHEMA_VERSION = 1 as const;

const isoDate = z.string().datetime();

export const attributionRules = [
  // The subagent worked, from inside an agent worktree, on exactly one
  // non-default branch, and it is the PR's head branch.
  'head-branch',
  // The subagent worked on no branch of its own, and its task prompt names
  // exactly one PR of this repository.
  'pr-reference',
] as const;

export const usageRecordSchema = z
  .object({
    schemaVersion: z.literal(USAGE_SCHEMA_VERSION),
    runId: z.string().min(1),
    prNumber: z.number().int().positive(),
    // The run was created soon after the start of transcript coverage, so part
    // of its work may sit in sessions that cleanup had already removed.
    possiblyPartial: z.boolean(),
    // Subagent sessions attributed to this run, by rule.
    subagentSessions: measurementSchema,
    sessionsByRule: z
      .object({
        'head-branch': z.number().int().nonnegative(),
        'pr-reference': z.number().int().nonnegative(),
      })
      .strict(),
    // Orchestrating (main) sessions that recorded a link to this PR. Their
    // usage spans many runs and is never attributed to one.
    orchestratorSessionsLinked: measurementSchema,
    tokens: z
      .object({
        input: measurementSchema,
        output: measurementSchema,
        cacheRead: measurementSchema,
        cacheCreation5m: measurementSchema,
        cacheCreation1h: measurementSchema,
      })
      .strict(),
    // API-list-price estimate of the attributed sessions' tokens, not an
    // amount billed: the maintainer may run on a subscription.
    estimatedCostUsd: measurementSchema,
    // Summed wall-clock span (first to last event) of the attributed
    // subagent sessions.
    agentDuration: measurementSchema,
    models: observationSchema,
    skillVersion: observationSchema,
  })
  .strict();
export type UsageRecord = z.infer<typeof usageRecordSchema>;

// null: some response did not record that count, so the total is unknown.
const tokenCount = z.number().int().nonnegative().nullable();
const tokenTotalsSchema = z
  .object({
    input: tokenCount,
    output: tokenCount,
    cacheRead: tokenCount,
    cacheCreation5m: tokenCount,
    cacheCreation1h: tokenCount,
  })
  .strict();
export type TokenTotals = z.infer<typeof tokenTotalsSchema>;

const unattributedSchema = z
  .object({
    sessions: z.number().int().nonnegative(),
    responses: z.number().int().nonnegative(),
    tokens: tokenTotalsSchema,
    estimatedCostUsd: measurementSchema,
  })
  .strict();

export const usageMetaSchema = z
  .object({
    schemaVersion: z.literal(USAGE_SCHEMA_VERSION),
    generatedAt: isoDate,
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    // First and last event timestamps across all scanned transcripts; runs
    // outside this span cannot have usage.
    transcriptCoverage: z.object({ from: isoDate.nullable(), to: isoDate.nullable() }).strict(),
    sessionsScanned: z
      .object({ main: z.number().int().nonnegative(), subagent: z.number().int().nonnegative() })
      .strict(),
    subagentsAttributed: z.number().int().nonnegative(),
    // Subagents with no evidence, conflicting evidence, or a PR outside the
    // baseline. Never guessed.
    subagentsUnattributed: z.number().int().nonnegative(),
    // API responses seen in more than one transcript file, counted once: on
    // the orchestration side when an orchestrating transcript holds one (a
    // fork copies its parent's turns), otherwise on the unattributed side.
    duplicateResponses: z
      .object({
        toOrchestration: z.number().int().nonnegative(),
        toUnattributed: z.number().int().nonnegative(),
      })
      .strict(),
    // Assistant records without a response id, model or usage; not counted.
    droppedResponses: z.number().int().nonnegative(),
    orchestration: unattributedSchema,
    unattributedSubagents: unattributedSchema,
    priceTable: z.object({ checkedAt: z.string().min(1), source: z.string().min(1) }).strict(),
    // Where the sessions came from: the transcript scan (#443, the default
    // when absent) or the run-time ledger written by the usage hook.
    source: z.enum(['transcripts', 'ledger']).optional(),
    // Ledger-only details.
    ledger: z
      .object({
        // Lines that did not parse; not counted.
        invalidLines: z.number().int().nonnegative(),
        // Earlier lines for an agent or session that stopped again later.
        supersededLines: z.number().int().nonnegative(),
        // Forks whose parent transcript could not be read: their copied turn
        // may be counted twice.
        forksWithUncheckedParent: z.number().int().nonnegative(),
        // Prompts per main session, never attributed to a run.
        prompts: z
          .object({
            sessions: z.number().int().nonnegative(),
            other: z.number().int().nonnegative(),
            notifications: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type UsageMeta = z.infer<typeof usageMetaSchema>;
