import { describe, expect, it } from 'vitest';
import type { Exercise } from '@/lib/prisma-client';
import { defaultIntraSetConfig } from '@/lib/intra-set-autoregulation';
import { addedExerciseTargets, toRunnerExercises, type FreestyleRow } from './freestyle';

const bench = {
  id: 'bench',
  name: 'Bench Press',
  muscleGroup: 'CHEST',
  category: 'COMPOUND',
  usesBodyweight: false,
  defaultRestSec: 150,
} as Exercise;
const bike = {
  ...bench,
  id: 'bike',
  name: 'Bike',
  muscleGroup: 'OTHER',
  category: 'CARDIO',
  defaultRestSec: 60,
} as Exercise;

function row(id: string, exercise: Exercise, order: number): FreestyleRow {
  return {
    id,
    sessionId: 's1',
    exerciseId: exercise.id,
    exercise,
    order,
    targetSets: 3,
    targetRepsMin: 6,
    targetRepsMax: 10,
    targetRIR: 1,
    restSec: 90,
  };
}

describe('addedExerciseTargets (issue #388)', () => {
  it('gives a strength exercise a 4x8-12 prescription with its own rest', () => {
    expect(addedExerciseTargets(bench)).toEqual({
      exerciseId: 'bench',
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      restSec: 150,
    });
  });

  it('gives cardio one continuous set', () => {
    expect(addedExerciseTargets(bike)).toEqual({
      exerciseId: 'bike',
      targetSets: 1,
      targetRepsMin: 1,
      targetRepsMax: 1,
      targetRIR: 0,
      restSec: 60,
    });
  });
});

describe('toRunnerExercises (issue #388)', () => {
  it('returns nothing for an empty list', () => {
    expect(toRunnerExercises([])).toEqual([]);
  });

  it('keeps the row id, exercise and targets, in list order', () => {
    const out = toRunnerExercises([row('b', bike, 2), row('a', bench, 1)]);
    expect(out.map((pe) => [pe.id, pe.exerciseId, pe.order])).toEqual([
      ['a', 'bench', 1],
      ['b', 'bike', 2],
    ]);
    expect(out[0]).toMatchObject({
      targetSets: 3,
      targetRepsMin: 6,
      targetRepsMax: 10,
      targetRIR: 1,
      restSec: 90,
      exercise: bench,
    });
  });

  it('fills the program-only fields with the defaults of a freshly added row', () => {
    const [pe] = toRunnerExercises([row('a', bench, 1)]);
    expect(pe).toMatchObject({
      // No workout exists: nothing may address one through this value.
      workoutId: '',
      supersetGroup: null,
      tempo: null,
      notes: null,
      autoregulationMode: 'PRESERVE_RIR',
      ...defaultIntraSetConfig(bench),
    });
  });

  it('does not reorder the caller array', () => {
    const rows = [row('b', bike, 2), row('a', bench, 1)];
    toRunnerExercises(rows);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});
