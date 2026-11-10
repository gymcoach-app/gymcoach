import { z } from 'zod';

export const sessionStartSchema = z.object({
  // Absent (or null) starts a freestyle session (issue #388): no workout, no
  // program, exercises added from the catalog while training.
  workoutId: z.string().min(1).optional().nullable(),
  gymId: z.string().min(1).optional().nullable(),
});

export const sessionUpdateSchema = z.object({
  notes: z.string().trim().max(2000).optional().nullable(),
  // If true, sets finishedAt to now.
  finish: z.boolean().optional(),
});

// One exercise of a freestyle session (issue #388): the targets the live
// runner needs, with the same bounds as a program exercise.
export const sessionExerciseInputSchema = z
  .object({
    exerciseId: z.string().min(1),
    targetSets: z.coerce.number().int().min(1).max(20),
    targetRepsMin: z.coerce.number().int().min(1).max(50),
    targetRepsMax: z.coerce.number().int().min(1).max(50),
    targetRIR: z.coerce.number().int().min(0).max(5),
    restSec: z.coerce.number().int().min(15).max(600),
  })
  .refine((v) => v.targetRepsMax >= v.targetRepsMin, {
    message: 'Reps max must be >= reps min',
    path: ['targetRepsMax'],
  });

// Query of DELETE /api/sessions/[id]. `discardEmpty=1` is the "discard this
// empty session" action of the live runner (issue #388): the server then
// refuses a session that holds sets, whatever the client believed.
export const sessionDeleteQuerySchema = z.object({
  discardEmpty: z.literal('1').optional(),
});

export type SessionExerciseInput = z.infer<typeof sessionExerciseInputSchema>;
export type SessionStart = z.infer<typeof sessionStartSchema>;
export type SessionUpdate = z.infer<typeof sessionUpdateSchema>;
