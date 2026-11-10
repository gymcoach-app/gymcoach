import type { Exercise, ProgramExercise, SessionExercise } from '@/lib/prisma-client';
import { defaultIntraSetConfig } from '@/lib/intra-set-autoregulation';

// Freestyle sessions (issue #388): a session started without a workout keeps
// its own exercise list (SessionExercise). The live runner was written for the
// rows of a workout, so the list is presented to it in that shape. Pure and
// client-safe: no database access here.

export type FreestyleRow = SessionExercise & { exercise: Exercise };
export type RunnerExercise = ProgramExercise & { exercise: Exercise };

// Targets for an exercise added while training. Cardio follows the repo rule:
// one continuous effort is one set, logged as duration and distance.
export function addedExerciseTargets(exercise: Pick<Exercise, 'id' | 'category' | 'defaultRestSec'>) {
  const cardio = exercise.category === 'CARDIO';
  return {
    exerciseId: exercise.id,
    targetSets: cardio ? 1 : 4,
    targetRepsMin: cardio ? 1 : 8,
    targetRepsMax: cardio ? 1 : 12,
    targetRIR: cardio ? 0 : 2,
    restSec: exercise.defaultRestSec,
  };
}

// The runner reads a row's id (as its key and in navigation), its targets and
// its exercise. The fields a freestyle row does not store take the defaults a
// freshly added program exercise would get; `workoutId` is empty because no
// workout exists, and nothing may send it to a workout route.
export function toRunnerExercises(rows: FreestyleRow[]): RunnerExercise[] {
  return [...rows]
    .sort((a, b) => a.order - b.order)
    .map((row) => {
      const autoregulation = defaultIntraSetConfig(row.exercise);
      return {
        id: row.id,
        workoutId: '',
        exerciseId: row.exerciseId,
        exercise: row.exercise,
        order: row.order,
        targetSets: row.targetSets,
        targetRepsMin: row.targetRepsMin,
        targetRepsMax: row.targetRepsMax,
        targetRIR: row.targetRIR,
        restSec: row.restSec,
        tempo: null,
        notes: null,
        supersetGroup: null,
        autoregulationMode: 'PRESERVE_RIR' as const,
        fatigueRate: autoregulation.fatigueRate,
        loadAdjustmentPct: autoregulation.loadAdjustmentPct,
      };
    });
}
