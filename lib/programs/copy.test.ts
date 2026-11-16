import { describe, expect, it } from 'vitest';
import { Prisma } from '@/prisma/generated/client';
import type { ProgramExercise } from '@/lib/prisma-client';
import {
  copyName,
  programExerciseCopyData,
  workoutRowsFromSession,
  type SessionSetForWorkout,
} from '@/lib/programs/copy';

const programExercise: ProgramExercise = {
  id: 'pe1',
  workoutId: 'w1',
  exerciseId: 'bench',
  order: 2,
  targetSets: 5,
  targetRepsMin: 6,
  targetRepsMax: 8,
  targetRIR: 1,
  restSec: 150,
  tempo: '3-1-1',
  notes: 'Pause on the chest',
  supersetGroup: 3,
  autoregulationMode: 'PRESERVE_REPS',
  fatigueRate: 0.04,
  loadAdjustmentPct: 2.5,
  targetDurationSec: null,
  targetDistanceM: null,
};

describe('programExerciseCopyData (issue #394)', () => {
  it('copies every ProgramExercise column except its id and its workout', () => {
    const copy = programExerciseCopyData(programExercise);
    // Driven by the generated column list, so a column added to the model
    // later fails here until the copy carries it.
    const columns = Object.values(Prisma.ProgramExerciseScalarFieldEnum).filter(
      (column) => column !== 'id' && column !== 'workoutId',
    );
    expect(Object.keys(copy).sort()).toEqual([...columns].sort());
    for (const column of columns) {
      expect(copy[column as keyof typeof copy]).toEqual(programExercise[column]);
    }
  });
});

describe('copyName', () => {
  it('appends a copy suffix and stays within the 120-character name limit', () => {
    expect(copyName('Upper')).toBe('Upper (copy)');
    const long = copyName('x'.repeat(120));
    expect(long).toHaveLength(120);
    expect(long.endsWith(' (copy)')).toBe(true);
  });

  it('uses the given localized suffix and still fits the limit', () => {
    expect(copyName('Upper', '(copie)')).toBe('Upper (copie)');
    const long = copyName(`${'y'.repeat(115)} tail`, '(копия)');
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith(' (копия)')).toBe(true);
  });

  it('trims a space left at the cut and never halves an emoji', () => {
    // ' (copy)' is 7 characters, so 113 of the name are kept.
    expect(copyName(`${'a'.repeat(112)} next`)).toBe(`${'a'.repeat(112)} (copy)`);
    expect(copyName(`${'a'.repeat(112)}\u{1F600}zz`)).toBe(`${'a'.repeat(112)} (copy)`);
  });
});

function set(overrides: Partial<SessionSetForWorkout>): SessionSetForWorkout {
  return {
    exerciseId: 'bench',
    reps: 8,
    rir: 2,
    isWarmup: false,
    isDropSet: false,
    completedAt: new Date('2026-10-01T10:00:00Z'),
    setNumber: 1,
    ...overrides,
  };
}

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 10, minute));

describe('workoutRowsFromSession (issue #394)', () => {
  it('programs what was done: working-set count, rep range and mean RIR, in training order', () => {
    const rows = workoutRowsFromSession(
      [
        // Squat was trained second although its sets come first in the list.
        set({ exerciseId: 'squat', reps: 5, rir: 2, completedAt: at(20), setNumber: 1 }),
        set({ exerciseId: 'squat', reps: 5, rir: 1, completedAt: at(24), setNumber: 2 }),
        set({ exerciseId: 'bench', reps: 10, rir: 1, completedAt: at(0), isWarmup: true }),
        set({ exerciseId: 'bench', reps: 8, rir: 3, completedAt: at(5), setNumber: 2 }),
        set({ exerciseId: 'bench', reps: 6, rir: 1, completedAt: at(8), setNumber: 3 }),
        set({ exerciseId: 'bench', reps: 12, rir: 0, completedAt: at(9), isDropSet: true }),
      ],
      new Map([
        ['bench', 120],
        ['squat', 180],
      ]),
      [],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        exerciseId: 'bench',
        order: 1,
        targetSets: 2,
        targetRepsMin: 6,
        targetRepsMax: 8,
        targetRIR: 2,
        restSec: 120,
      }),
      expect.objectContaining({
        exerciseId: 'squat',
        order: 2,
        targetSets: 2,
        targetRepsMin: 5,
        targetRepsMax: 5,
        // Mean of 2 and 1, rounded.
        targetRIR: 2,
        restSec: 180,
      }),
    ]);
  });

  it('skips an exercise with only warm-ups and drop sets', () => {
    const rows = workoutRowsFromSession(
      [set({ exerciseId: 'curl', isWarmup: true }), set({ exerciseId: 'curl', isDropSet: true })],
      new Map(),
      [],
    );
    expect(rows).toEqual([]);
  });

  it('defaults the RIR when none was logged and keeps a cardio row valid', () => {
    const [row] = workoutRowsFromSession(
      // A cardio set logs reps = 1 by convention (lib/cardio.ts).
      [set({ exerciseId: 'bike', reps: 1, rir: null })],
      new Map([['bike', 5]]),
      [],
    );
    expect(row).toMatchObject({
      targetRIR: 2,
      targetRepsMin: 1,
      targetRepsMax: 1,
      // The default rest is clamped into the programmed range.
      restSec: 15,
    });
  });

  it("reuses the session's own programmed settings for an exercise it kept", () => {
    const [row] = workoutRowsFromSession([set({})], new Map([['bench', 90]]), [
      {
        exerciseId: 'bench',
        restSec: 150,
        tempo: '3-1-1',
        notes: 'Pause',
        autoregulationMode: 'PRESERVE_REPS',
        fatigueRate: 0.04,
        loadAdjustmentPct: 2.5,
        targetDurationSec: null,
        targetDistanceM: null,
      },
      {
        exerciseId: 'bench',
        restSec: 60,
        tempo: null,
        notes: null,
        autoregulationMode: 'PRESERVE_RIR',
        fatigueRate: null,
        loadAdjustmentPct: null,
        targetDurationSec: null,
        targetDistanceM: null,
      },
    ]);
    // The first programmed row of the exercise wins.
    expect(row).toMatchObject({
      restSec: 150,
      tempo: '3-1-1',
      notes: 'Pause',
      autoregulationMode: 'PRESERVE_REPS',
      fatigueRate: 0.04,
      loadAdjustmentPct: 2.5,
    });
  });
});
