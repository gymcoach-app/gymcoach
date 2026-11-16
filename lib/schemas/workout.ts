import { z } from 'zod';

const dayOfWeekSchema = z
  .union([z.coerce.number().int().min(1).max(7), z.literal('').transform(() => null), z.null()])
  .transform((v) => (typeof v === 'number' ? v : null))
  .optional()
  .nullable();

export const workoutInputSchema = z.object({
  name: z.string().trim().min(1, 'Name required').max(120),
  dayOfWeek: dayOfWeekSchema,
});

export type WorkoutInput = z.infer<typeof workoutInputSchema>;

// PUT /api/workouts/[id]/order (issue #557): the complete list of the
// workout's ProgramExercise ids in their new order. The route checks that it
// is exactly a permutation of the workout's current rows; the bounds here
// only keep a hostile body small.
export const workoutOrderInputSchema = z.object({
  programExerciseIds: z.array(z.string().min(1).max(64)).max(200),
});

export type WorkoutOrderInput = z.infer<typeof workoutOrderInputSchema>;

export const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
