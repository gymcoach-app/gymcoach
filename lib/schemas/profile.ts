import { z } from 'zod';
import { EffortScale, Sex, TrainingGoal, WeightUnit } from '@/lib/prisma-client';

// Max length of the free-text note to the coach (issue #188). Shared between
// the profile API's Zod bound and the coach-page UI's character counter so the
// limit lives in exactly one place.
export const COACH_NOTE_MAX_LEN = 500;

// User profile update (self-service). Every field is optional; null clears a
// value where the column is nullable.
export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
  // Bodyweight in kg, used to compute the effective tonnage on bodyweight
  // exercises. null reverts to the set.weight-only behavior.
  bodyweight: z.number().min(20, 'Too low').max(300, 'Too high').nullable().optional(),
  // Target bodyweight in kg (issue #398), drawn as a goal line on the
  // bodyweight chart. Same bounds as the bodyweight; null clears the goal.
  bodyweightGoalKg: z.number().min(20, 'Too low').max(300, 'Too high').nullable().optional(),
  sex: z.nativeEnum(Sex).nullable().optional(),
  heightCm: z.number().int().min(100).max(250).nullable().optional(),
  goal: z.nativeEnum(TrainingGoal).nullable().optional(),
  weeklyFrequency: z.number().int().min(1).max(14).nullable().optional(),
  // Free-text note to the AI coach (issue #188): the user's own current context
  // (injuries, illness, life constraints). Trimmed and bounded; null clears it.
  // An all-whitespace note trims to "" - the route coerces that to null so a
  // blank save is a clear, not an empty-string note.
  coachNote: z
    .string()
    .trim()
    .max(COACH_NOTE_MAX_LEN, `Keep it under ${COACH_NOTE_MAX_LEN} characters`)
    .nullable()
    .optional(),
  // Preferred weight unit (display + input only; data stays in kg).
  unit: z.nativeEnum(WeightUnit).optional(),
  // Preferred effort scale (display + input only; sets always store RIR).
  effortScale: z.nativeEnum(EffortScale).optional(),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
