import { z } from 'zod';
import { stripLeadingReasoning } from '@/lib/llm/reasoning';

// ============================================================
// Adjustments proposed by the coach (BATCH 10)
// ============================================================
// The system prompt asks Claude to emit an <adjustments> XML block
// containing a JSON array at the end of each debrief. We extract, validate
// (Zod) and expose the result to the UI without touching the displayed markdown.

export const adjustmentSchema = z.object({
  exerciseName: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(300),
  rationale: z.string().trim().max(800).optional().nullable(),
  suggestedRepsMin: z.number().int().min(1).max(50).optional().nullable(),
  suggestedRepsMax: z.number().int().min(1).max(50).optional().nullable(),
  suggestedSets: z.number().int().min(1).max(20).optional().nullable(),
  suggestedRIR: z.number().int().min(0).max(5).optional().nullable(),
  suggestedRestSec: z.number().int().min(15).max(600).optional().nullable(),
  currentLoad: z.number().min(0).max(1000).optional().nullable(),
  suggestedLoad: z.number().min(0).max(1000).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export type Adjustment = z.infer<typeof adjustmentSchema>;

const ADJUSTMENTS_TAG_RE = /<adjustments>([\s\S]*?)<\/adjustments>/i;

export interface ExtractedAdjustments {
  // Markdown with the <adjustments> block stripped out (ready to display as-is).
  cleaned: string;
  // Array of validated adjustments. Empty if the block is missing or invalid.
  adjustments: Adjustment[];
  // Parsing errors surfaced for debugging (non-blocking).
  parseErrors: string[];
}

// Extracts and parses the <adjustments>...</adjustments> block from a coach response.
// Returns the cleaned markdown + the valid adjustments. On a JSON parsing or schema
// error, we just return an empty array and the error in parseErrors (the markdown
// stays displayable). A leading reasoning block (<think>...</think>) is dropped
// first: it is not part of the debrief, and an <adjustments> example in the
// model's thinking must not be taken for the real block.
export function extractAdjustments(response: string): ExtractedAdjustments {
  const markdown = stripLeadingReasoning(response);
  const match = markdown.match(ADJUSTMENTS_TAG_RE);
  if (!match) {
    return { cleaned: markdown.trim(), adjustments: [], parseErrors: [] };
  }
  const cleaned = markdown.replace(ADJUSTMENTS_TAG_RE, '').trim();
  const raw = match[1]?.trim();
  if (!raw) {
    return { cleaned, adjustments: [], parseErrors: ['Empty <adjustments> block.'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      cleaned,
      adjustments: [],
      parseErrors: [
        `Invalid JSON in <adjustments>: ${err instanceof Error ? err.message : 'unknown error'}`,
      ],
    };
  }

  const result = z.array(adjustmentSchema).safeParse(parsed);
  if (!result.success) {
    return {
      cleaned,
      adjustments: [],
      parseErrors: [
        `Invalid schema: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ; ')}`,
      ],
    };
  }
  return { cleaned, adjustments: result.data, parseErrors: [] };
}

// ============================================================
// Schema for the POST /api/coach/[id]/apply request
// ============================================================
// The client sends the list of validated adjustments (possibly edited
// by the user). We re-validate server-side via Zod.

export const applyAdjustmentsSchema = z.object({
  adjustments: z.array(adjustmentSchema).min(1, 'No adjustment to apply.'),
});

export type ApplyAdjustmentsInput = z.infer<typeof applyAdjustmentsSchema>;
