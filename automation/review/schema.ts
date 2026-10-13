import { z } from 'zod';

// A structured review of one PR at one exact base and head (roadmap
// milestones 2 and 4). The orchestrator posts it as a PR comment with
// record.ts; the merge gate only counts a record whose head SHA is the approved
// SHA and whose base SHA is the PR's current base, so a fixup push or a rebase
// makes the old record stale by construction.
//
// This is distinct from the baseline's reviewRecordSchema
// (automation/records/schema.ts), which describes reviews reconstructed after
// the fact from GitHub; this one is what a reviewer produces before a merge.

export const REVIEW_SCHEMA_VERSION = 1;

const sha = z.string().regex(/^[0-9a-f]{40}$/, 'a full, lowercase 40-character commit SHA');

export const findingSeverities = ['blocking', 'major', 'minor', 'nit'] as const;
export type FindingSeverity = (typeof findingSeverities)[number];

// Severities that keep a review from counting as ready.
export const STOPPING_SEVERITIES: readonly FindingSeverity[] = ['blocking', 'major'];

export const reviewFindingSchema = z
  .object({
    severity: z.enum(findingSeverities),
    file: z.string().min(1).nullable(),
    line: z.number().int().positive().nullable(),
    claim: z.string().min(1).max(500),
  })
  .strict();
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const structuredReviewSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
    pr: z.number().int().positive(),
    // The PR's base SHA as GitHub reports it (pulls API base.sha) when the
    // review was made, and the head SHA the reviewer actually read.
    baseSha: sha,
    headSha: sha,
    reviewer: z
      .object({
        kind: z.enum(['agent', 'human']),
        // e.g. claude-opus-5-5; null for a human or when unknown.
        model: z.string().min(1).nullable(),
      })
      .strict(),
    // What the review looked for, e.g. correctness, security, egress.
    lenses: z.array(z.string().min(1)).min(1),
    filesInspected: z.array(z.string().min(1)),
    // Scope the reviewer did not read in full (lesson L26): explicit, never
    // implied by omission.
    filesNotReadInFull: z.array(z.string().min(1)),
    findings: z.array(reviewFindingSchema),
    verdict: z.enum(['ready', 'needs-changes']),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((review, ctx) => {
    const stopping = review.findings.filter((f) => STOPPING_SEVERITIES.includes(f.severity));
    if (review.verdict === 'ready' && stopping.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verdict'],
        message: `a ready verdict cannot carry ${stopping.length} blocking or major finding(s)`,
      });
    }
  });
export type StructuredReview = z.infer<typeof structuredReviewSchema>;
