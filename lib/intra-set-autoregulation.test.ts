import { describe, expect, it } from 'vitest';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { defaultIntraSetConfig, recommendNextIntraSet } from '@/lib/intra-set-autoregulation';

const squat: Exercise = {
  id: 'squat',
  userId: 'u',
  name: 'Back Squat',
  muscleGroup: 'QUADS',
  category: 'COMPOUND',
  defaultRestSec: 180,
  notes: null,
  usesBodyweight: false,
  equipmentType: 'BARBELL',
  isFavorite: false,
  createdAt: new Date(),
};

const curl: Exercise = {
  ...squat,
  id: 'curl',
  name: 'Cable Curl',
  muscleGroup: 'BICEPS',
  category: 'ISOLATION',
  defaultRestSec: 60,
};

function makePe(
  exercise: Exercise,
  overrides: Partial<ProgramExercise> = {},
): ProgramExercise & { exercise: Exercise } {
  return {
    id: 'pe',
    workoutId: 'w',
    exerciseId: exercise.id,
    order: 1,
    targetSets: 5,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetRIR: 2,
    restSec: 120,
    tempo: null,
    notes: null,
    supersetGroup: null,
    autoregulationMode: 'PRESERVE_RIR',
    fatigueRate: null,
    loadAdjustmentPct: null,
    targetDurationSec: null,
    targetDistanceM: null,
    ...overrides,
    exercise,
  };
}

describe('intra-set autoregulation defaults', () => {
  it('assigns more fatigue to lower-body compounds than isolation work', () => {
    expect(defaultIntraSetConfig(squat).fatigueRate).toBeGreaterThan(
      defaultIntraSetConfig(curl).fatigueRate,
    );
  });
});

describe('recommendNextIntraSet', () => {
  it('preserves RIR by lowering the rep target as fatigue accumulates', () => {
    const result = recommendNextIntraSet({
      programExercise: makePe(squat, { fatigueRate: 1 }),
      completedSets: [{ weight: 100, reps: 12, rir: 2 }],
      recoverySec: 120,
    });

    expect(result).toMatchObject({
      mode: 'PRESERVE_RIR',
      weight: 100,
      reps: 11,
      rir: 2,
      reason: 'adjust-reps',
    });
  });

  it('preserves reps by reducing load when predicted capacity falls', () => {
    const result = recommendNextIntraSet({
      programExercise: makePe(squat, {
        autoregulationMode: 'PRESERVE_REPS',
        fatigueRate: 1,
        loadAdjustmentPct: 2.5,
      }),
      completedSets: [{ weight: 100, reps: 12, rir: 2 }],
      recoverySec: 120,
    });

    expect(result).toMatchObject({
      mode: 'PRESERVE_REPS',
      weight: 97.5,
      reps: 12,
      rir: 2,
      reason: 'reduce-load',
    });
  });

  it('penalizes short rest more than full rest', () => {
    const pe = makePe(squat, { fatigueRate: 1 });
    const set = [{ weight: 100, reps: 12, rir: 2 }];
    const short = recommendNextIntraSet({
      programExercise: pe,
      completedSets: set,
      recoverySec: 60,
    });
    const full = recommendNextIntraSet({
      programExercise: pe,
      completedSets: set,
      recoverySec: 120,
    });

    expect(short!.fatigueLoss).toBeGreaterThan(full!.fatigueLoss);
  });

  it('adds fatigue for a same-muscle superset', () => {
    const pe = makePe(squat, { fatigueRate: 1 });
    const set = [{ weight: 100, reps: 12, rir: 2 }];
    const normal = recommendNextIntraSet({
      programExercise: pe,
      completedSets: set,
      recoverySec: 120,
    });
    const superset = recommendNextIntraSet({
      programExercise: pe,
      completedSets: set,
      recoverySec: 120,
      sameMuscleSuperset: true,
    });

    expect(superset!.fatigueLoss).toBeGreaterThan(normal!.fatigueLoss);
  });

  it('never increases load when recovery logic forbids it', () => {
    const result = recommendNextIntraSet({
      programExercise: makePe(curl, {
        targetRepsMin: 8,
        targetRepsMax: 10,
        autoregulationMode: 'PRESERVE_REPS',
        fatigueRate: 0.25,
      }),
      completedSets: [{ weight: 20, reps: 10, rir: 5 }],
      recoverySec: 120,
      allowLoadIncrease: false,
    });

    expect(result!.weight).toBe(20);
  });

  it('does not jump above a return-session ceiling across a gym inventory gap', () => {
    const result = recommendNextIntraSet({
      programExercise: makePe(curl, {
        targetRepsMin: 8,
        targetRepsMax: 10,
        autoregulationMode: 'PRESERVE_REPS',
        fatigueRate: 0.25,
      }),
      completedSets: [{ weight: 16, reps: 10, rir: 5 }],
      recoverySec: 120,
      maxWeight: 17,
      loadConstraints: {
        equipmentType: 'DUMBBELL',
        dumbbellWeights: [10, 12, 14, 16, 19],
      },
    });

    expect(result!.weight).toBe(16);
  });

  it('adjusts reps instead of attempting a negative bodyweight load', () => {
    const bodyweightExercise = { ...squat, usesBodyweight: true };
    const result = recommendNextIntraSet({
      programExercise: makePe(bodyweightExercise, {
        autoregulationMode: 'PRESERVE_REPS',
        fatigueRate: 1,
      }),
      completedSets: [{ weight: 0, reps: 12, rir: 2 }],
      recoverySec: 120,
    });

    expect(result).toMatchObject({
      weight: 0,
      reps: 11,
      reason: 'bodyweight-adjust-reps',
    });
  });

  it('ignores warmups and drop sets when selecting the reference set', () => {
    const result = recommendNextIntraSet({
      programExercise: makePe(squat, { fatigueRate: 1 }),
      completedSets: [
        { weight: 60, reps: 5, rir: 5, isWarmup: true },
        { weight: 100, reps: 12, rir: 2 },
        { weight: 80, reps: 15, rir: 0, isDropSet: true },
      ],
      recoverySec: 120,
    });

    expect(result).toMatchObject({ weight: 100, reps: 11 });
  });
});
