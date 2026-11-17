import { z } from 'zod';
import { stripLeadingReasoning } from '@/lib/llm/reasoning';
import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
} from '@/lib/cardio';

// ============================================================
// AI-parsed free-text set logging (issue #210)
// ============================================================
// This is a NEW, SEPARATE contract from the coach <adjustments> block and the
// program-generation schema: it is the shape the LLM must return when it parses
// ONE natural-language set description into the set form fields. The model
// output is UNTRUSTED: parseSetDescription extracts JSON, Zod-validates it
// against these bounds, and returns a typed result or a failure - on any junk,
// refusal, or out-of-range value the caller fills NOTHING (never throws, never
// logs garbage).
//
// The bounds mirror the set input schema (lib/schemas/set.ts):
//  - strength: reps 1..100, rir 0..5 (a logged working set has at least 1 rep)
//  - cardio:   durationSec 1..MAX_DURATION_SEC, distanceM 0..MAX_DISTANCE_M,
//              avgHr AVG_HR_MIN..AVG_HR_MAX
// Weight is returned in the user's DISPLAY unit (kg or lb), exactly like the
// deterministic shorthand parser: the component converts it with
// fromDisplayWeight before it ever reaches the kg-bounded set API, which stays
// the authoritative gate. It is bounded here to a generous but sane envelope so
// an absurd value (or a unit confusion) is rejected up front.
export const PARSE_WEIGHT_MAX = 2000;

const strengthParseSchema = z.object({
  kind: z.literal('strength'),
  // In the user's display unit; >= 0 (0 = bodyweight-only, like the manual field).
  weight: z.number().min(0).max(PARSE_WEIGHT_MAX),
  reps: z.number().int().min(1).max(100),
  // Reps in reserve, optional. Absent when the text gives no effort cue.
  rir: z.number().int().min(0).max(5).optional(),
});

const cardioParseSchema = z.object({
  kind: z.literal('cardio'),
  durationSec: z.number().int().min(1).max(MAX_DURATION_SEC),
  distanceM: z.number().min(0).max(MAX_DISTANCE_M).optional(),
  avgHr: z.number().int().min(AVG_HR_MIN).max(AVG_HR_MAX).optional(),
});

// The structured parse result. Discriminated on `kind` so a strength parse can
// never carry cardio fields and vice versa.
export const setParseResultSchema = z.discriminatedUnion('kind', [
  strengthParseSchema,
  cardioParseSchema,
]);

export type SetParseResult = z.infer<typeof setParseResultSchema>;
export type StrengthParse = z.infer<typeof strengthParseSchema>;
export type CardioParse = z.infer<typeof cardioParseSchema>;

// Pulls a JSON object out of a model response: tolerates code fences and
// surrounding prose by slicing from the first '{' to the last '}'. Mirrors
// extractJsonObject in program-generation so both LLM consumers behave alike,
// including the leading reasoning block (<think>...</think>) dropped first.
export function extractJsonObject(rawText: string): string | null {
  const text = stripLeadingReasoning(rawText);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start, end + 1);
}

export type SetParseOutcome =
  | { ok: true; value: SetParseResult }
  | { ok: false };

// Extracts, parses and validates the model's set parse. Pure and total: ANY
// failure path (no JSON, invalid JSON, schema mismatch, out-of-range, a refusal
// or apology) returns { ok: false } so the caller fills nothing. It never
// throws. `expectedKind` lets the caller reject a parse of the wrong shape for
// the exercise (a cardio parse on a strength exercise, or vice versa).
export function parseSetDescription(
  text: string,
  expectedKind?: 'strength' | 'cardio',
): SetParseOutcome {
  if (typeof text !== 'string') return { ok: false };
  const json = extractJsonObject(text);
  if (!json) return { ok: false };

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false };
  }

  const result = setParseResultSchema.safeParse(raw);
  if (!result.success) return { ok: false };
  if (expectedKind && result.data.kind !== expectedKind) return { ok: false };
  return { ok: true, value: result.data };
}
