import { z } from 'zod';
import { SetAutoregulationMode } from '@/lib/prisma-client';
import {
  MAX_FATIGUE_RATE,
  MAX_LOAD_ADJUSTMENT_PCT,
  MIN_FATIGUE_RATE,
  MIN_LOAD_ADJUSTMENT_PCT,
} from '@/lib/intra-set-autoregulation';
import { MAX_SUPERSET_GROUP, MIN_SUPERSET_GROUP } from '@/lib/supersets';
import { MAX_DISTANCE_M, MAX_DURATION_SEC } from '@/lib/cardio';
import { TARGET_HR_MAX, TARGET_HR_MIN, TARGET_RPE_MAX, TARGET_RPE_MIN } from '@/lib/cardio-target';

export const programExerciseInputSchema = z
  .object({
    exerciseId: z.string().min(1, 'Exercise required'),
    targetSets: z.coerce.number().int().min(1).max(20),
    targetRepsMin: z.coerce.number().int().min(1).max(50),
    targetRepsMax: z.coerce.number().int().min(1).max(50),
    targetRIR: z.coerce.number().int().min(0).max(5),
    restSec: z.coerce.number().int().min(15).max(600),
    autoregulationMode: z.nativeEnum(SetAutoregulationMode).optional(),
    fatigueRate: z
      .union([z.coerce.number().min(MIN_FATIGUE_RATE).max(MAX_FATIGUE_RATE), z.null()])
      .optional(),
    loadAdjustmentPct: z
      .union([
        z.coerce.number().min(MIN_LOAD_ADJUSTMENT_PCT).max(MAX_LOAD_ADJUSTMENT_PCT),
        z.null(),
      ])
      .optional(),
    tempo: z.string().trim().max(20).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
    // Superset pairing (issue #146, slice 1): exercises of one workout sharing
    // a group number form a superset. null clears the pairing; ABSENT leaves
    // it unchanged on update (so the edit form never wipes a pairing).
    supersetGroup: z
      .number()
      .int()
      .min(MIN_SUPERSET_GROUP)
      .max(MAX_SUPERSET_GROUP)
      .nullable()
      .optional(),
    // Cardio target (issue #558, slice 1): duration in seconds and optional
    // distance in meters, same bounds as a logged cardio set. Only a CARDIO
    // exercise may carry them - the routes refuse them on any other category,
    // since the category is not known here. null clears the value; ABSENT
    // leaves it unchanged on update (so a caller that only knows the strength
    // fields, like the superset pairing, never wipes a target).
    targetDurationSec: z.number().int().min(1).max(MAX_DURATION_SEC).nullable().optional(),
    targetDistanceM: z.number().positive().max(MAX_DISTANCE_M).nullable().optional(),
    // Cardio intensity (issue #558, slice 2): a target effort on the 1 to 10
    // RPE scale and a target heart rate range in bpm. Same rules as above:
    // cardio only (checked by the routes), null clears, ABSENT leaves the
    // stored value unchanged. The two heart rate bounds travel together.
    targetRpe: z.number().int().min(TARGET_RPE_MIN).max(TARGET_RPE_MAX).nullable().optional(),
    targetHrMin: z.number().int().min(TARGET_HR_MIN).max(TARGET_HR_MAX).nullable().optional(),
    targetHrMax: z.number().int().min(TARGET_HR_MIN).max(TARGET_HR_MAX).nullable().optional(),
  })
  .refine((v) => v.targetRepsMax >= v.targetRepsMin, {
    message: 'Reps max must be >= reps min',
    path: ['targetRepsMax'],
  })
  // A distance is only a target next to a duration: clearing the duration
  // while sending a distance is contradictory.
  .refine((v) => !(v.targetDistanceM != null && v.targetDurationSec === null), {
    message: 'A distance target needs a duration target',
    path: ['targetDistanceM'],
  })
  // Same for the intensity: an effort or a heart rate is held for a duration.
  .refine(
    (v) =>
      !(
        (v.targetRpe != null || v.targetHrMin != null || v.targetHrMax != null) &&
        v.targetDurationSec === null
      ),
    { message: 'An intensity target needs a duration target', path: ['targetDurationSec'] },
  )
  // A heart rate target is a range: both bounds sent or both absent, both
  // null or both numbers, the lower one first. So a stored row never holds
  // half a range, and an update never has to merge one bound with the other.
  .refine(
    (v) =>
      (v.targetHrMin === undefined) === (v.targetHrMax === undefined) &&
      (v.targetHrMin === null) === (v.targetHrMax === null),
    { message: 'A heart rate target needs both bounds', path: ['targetHrMax'] },
  )
  .refine((v) => v.targetHrMin == null || v.targetHrMax == null || v.targetHrMax >= v.targetHrMin, {
    message: 'Heart rate max must be >= heart rate min',
    path: ['targetHrMax'],
  });

export type ProgramExerciseInput = z.infer<typeof programExerciseInputSchema>;
