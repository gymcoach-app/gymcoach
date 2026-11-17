import { z } from 'zod';
import { stripLeadingReasoning } from '@/lib/llm/reasoning';
import {
  EquipmentType,
  MuscleGroup,
  ExerciseCategory,
  SetAutoregulationMode,
} from '@/lib/prisma-client';
import {
  MAX_FATIGUE_RATE,
  MAX_LOAD_ADJUSTMENT_PCT,
  MIN_FATIGUE_RATE,
  MIN_LOAD_ADJUSTMENT_PCT,
} from '@/lib/intra-set-autoregulation';
import { MAX_SUPERSET_GROUP, MIN_SUPERSET_GROUP } from '@/lib/supersets';

// ============================================================
// Structured output for AI-generated programs (LOT: program generation)
// ============================================================
// The model is asked to return a single JSON object matching this schema. We
// validate it with Zod before previewing or persisting. Pure module (no DB
// imports) so it is cheap to unit-test.

export const generatedExerciseSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    muscleGroup: z.nativeEnum(MuscleGroup),
    category: z.nativeEnum(ExerciseCategory),
    equipmentType: z.nativeEnum(EquipmentType).optional(),
    targetSets: z.number().int().min(1).max(20),
    targetRepsMin: z.number().int().min(1).max(50),
    targetRepsMax: z.number().int().min(1).max(50),
    targetRIR: z.number().int().min(0).max(5),
    restSec: z.number().int().min(15).max(600),
    autoregulationMode: z.nativeEnum(SetAutoregulationMode).optional(),
    fatigueRate: z.number().min(MIN_FATIGUE_RATE).max(MAX_FATIGUE_RATE).optional(),
    loadAdjustmentPct: z
      .number()
      .min(MIN_LOAD_ADJUSTMENT_PCT)
      .max(MAX_LOAD_ADJUSTMENT_PCT)
      .optional(),
    supersetGroup: z.number().int().min(MIN_SUPERSET_GROUP).max(MAX_SUPERSET_GROUP).nullish(),
    tempo: z.string().trim().max(20).nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .refine((e) => e.targetRepsMax >= e.targetRepsMin, {
    message: 'targetRepsMax must be >= targetRepsMin',
    path: ['targetRepsMax'],
  });

export const generatedWorkoutSchema = z.object({
  name: z.string().trim().min(1).max(120),
  dayOfWeek: z.number().int().min(1).max(7).nullish(),
  exercises: z.array(generatedExerciseSchema).min(1).max(15),
});

export const generatedProgramSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullish(),
  phase: z.string().trim().min(1).max(60),
  workouts: z.array(generatedWorkoutSchema).min(1).max(7),
});

export type GeneratedExercise = z.infer<typeof generatedExerciseSchema>;
export type GeneratedWorkout = z.infer<typeof generatedWorkoutSchema>;
export type GeneratedProgram = z.infer<typeof generatedProgramSchema>;

// Pulls a JSON object out of a model response: tolerates code fences and
// surrounding prose by slicing from the first '{' to the last '}'. A leading
// reasoning block (<think>...</think>) is dropped first, so a brace or a fence
// in the model's thinking is not taken for the answer.
export function extractJsonObject(rawText: string): string | null {
  const text = stripLeadingReasoning(rawText);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start, end + 1);
}

export type ParseResult = { ok: true; program: GeneratedProgram } | { ok: false; error: string };

// Extracts, parses and validates a generated program from raw model text.
export function parseGeneratedProgram(text: string): ParseResult {
  const json = extractJsonObject(text);
  if (!json) {
    return { ok: false, error: 'No JSON object found in the model response.' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : 'parse error'}`,
    };
  }
  const result = generatedProgramSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  return { ok: true, program: result.data };
}
