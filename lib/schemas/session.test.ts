import { describe, it, expect } from 'vitest';
import {
  sessionDeleteQuerySchema,
  sessionExerciseInputSchema,
  sessionStartSchema,
  sessionUpdateSchema,
} from './session';

describe('sessionStartSchema', () => {
  it('takes a non-empty workoutId', () => {
    expect(sessionStartSchema.parse({ workoutId: 'w1' }).workoutId).toBe('w1');
    expect(sessionStartSchema.safeParse({ workoutId: '' }).success).toBe(false);
    expect(sessionStartSchema.safeParse({ workoutId: 7 }).success).toBe(false);
  });

  // Freestyle session (issue #388): no workout at all.
  it('accepts a missing or null workoutId as a freestyle start', () => {
    expect(sessionStartSchema.parse({}).workoutId).toBeUndefined();
    expect(sessionStartSchema.parse({ workoutId: null }).workoutId).toBeNull();
    expect(sessionStartSchema.parse({ gymId: 'g1' })).toEqual({ gymId: 'g1' });
  });
});

describe('sessionExerciseInputSchema (issue #388)', () => {
  const valid = {
    exerciseId: 'e1',
    targetSets: 4,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetRIR: 2,
    restSec: 120,
  };

  it('accepts the targets of an added exercise and drops unknown keys', () => {
    expect(sessionExerciseInputSchema.parse({ ...valid, workoutId: 'w1' })).toEqual(valid);
  });

  it('keeps the bounds of a program exercise', () => {
    for (const bad of [
      { ...valid, exerciseId: '' },
      { ...valid, targetSets: 0 },
      { ...valid, targetSets: 21 },
      { ...valid, targetRepsMax: 51 },
      { ...valid, targetRIR: 6 },
      { ...valid, restSec: 14 },
      { ...valid, restSec: 601 },
      { ...valid, targetRepsMin: 12, targetRepsMax: 8 },
    ]) {
      expect(sessionExerciseInputSchema.safeParse(bad).success).toBe(false);
    }
    expect(sessionExerciseInputSchema.safeParse({ ...valid, targetRepsMin: 10, targetRepsMax: 10 }).success).toBe(true);
  });
});

describe('sessionUpdateSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(sessionUpdateSchema.safeParse({}).success).toBe(true);
  });

  it('trims notes and accepts a finish flag', () => {
    const parsed = sessionUpdateSchema.parse({ notes: '  good session  ', finish: true });
    expect(parsed.notes).toBe('good session');
    expect(parsed.finish).toBe(true);
  });

  it('rejects notes longer than 2000 characters', () => {
    expect(sessionUpdateSchema.safeParse({ notes: 'x'.repeat(2001) }).success).toBe(false);
  });
});

describe('sessionDeleteQuerySchema (issue #388)', () => {
  it('accepts no flag (plain delete) and the literal discardEmpty=1', () => {
    expect(sessionDeleteQuerySchema.parse({})).toEqual({});
    expect(sessionDeleteQuerySchema.parse({ discardEmpty: '1' })).toEqual({ discardEmpty: '1' });
  });

  it('refuses any other value, so a typo never falls back to the plain delete', () => {
    for (const value of ['0', 'true', '', 'yes']) {
      expect(sessionDeleteQuerySchema.safeParse({ discardEmpty: value }).success).toBe(false);
    }
  });
});
