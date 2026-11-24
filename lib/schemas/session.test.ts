import { describe, it, expect } from 'vitest';
import {
  pastSessionSchema,
  sessionDeleteQuerySchema,
  sessionExerciseInputSchema,
  sessionStartSchema,
  sessionTimingSchema,
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

describe('sessionTimingSchema and pastSessionSchema (issue #389)', () => {
  const timing = { startedAt: '2026-11-03T17:30:00.000Z', durationMin: 60 };

  it('reads the start as an instant, with or without a UTC offset', () => {
    expect(sessionTimingSchema.parse(timing)).toEqual({
      startedAt: new Date('2026-11-03T17:30:00.000Z'),
      durationMin: 60,
    });
    expect(
      sessionTimingSchema.parse({ ...timing, startedAt: '2026-11-03T18:30:00+01:00' }).startedAt,
    ).toEqual(new Date('2026-11-03T17:30:00.000Z'));
  });

  it('refuses a start without a zone: the server never guesses one', () => {
    for (const startedAt of ['2026-11-03', '2026-11-03T18:30:00', '03/11/2026', '', 1762191000000]) {
      expect(sessionTimingSchema.safeParse({ ...timing, startedAt }).success).toBe(false);
    }
    expect(sessionTimingSchema.safeParse({ durationMin: 60 }).success).toBe(false);
    expect(
      sessionTimingSchema.safeParse({ ...timing, startedAt: '1969-12-31T23:00:00.000Z' }).success,
    ).toBe(false);
  });

  it('bounds the duration to whole minutes between 1 and 24 hours', () => {
    for (const durationMin of [1, 60, 1440]) {
      expect(sessionTimingSchema.safeParse({ ...timing, durationMin }).success).toBe(true);
    }
    for (const durationMin of [0, -5, 1441, 12.5, '60', null, undefined]) {
      expect(sessionTimingSchema.safeParse({ ...timing, durationMin }).success).toBe(false);
    }
  });

  it('logs a past session on a workout or as a freestyle one', () => {
    expect(pastSessionSchema.parse({ ...timing, workoutId: 'w1' }).workoutId).toBe('w1');
    expect(pastSessionSchema.parse({ ...timing, workoutId: null }).workoutId).toBeNull();
    expect(pastSessionSchema.parse(timing).workoutId).toBeUndefined();
    expect(pastSessionSchema.safeParse({ ...timing, workoutId: '' }).success).toBe(false);
    expect(pastSessionSchema.safeParse({ workoutId: 'w1' }).success).toBe(false);
  });
});
