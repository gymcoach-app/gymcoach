import { describe, it, expect } from 'vitest';
import { workoutInputSchema, workoutOrderInputSchema } from './workout';

describe('workoutOrderInputSchema (issue #557)', () => {
  it('accepts a list of ids, an empty one included', () => {
    expect(workoutOrderInputSchema.parse({ programExerciseIds: ['a', 'b'] })).toEqual({
      programExerciseIds: ['a', 'b'],
    });
    expect(workoutOrderInputSchema.safeParse({ programExerciseIds: [] }).success).toBe(true);
  });

  it('rejects a missing list, non-string ids, empty ids and oversized input', () => {
    expect(workoutOrderInputSchema.safeParse({}).success).toBe(false);
    expect(workoutOrderInputSchema.safeParse({ programExerciseIds: 'a' }).success).toBe(false);
    expect(workoutOrderInputSchema.safeParse({ programExerciseIds: [1] }).success).toBe(false);
    expect(workoutOrderInputSchema.safeParse({ programExerciseIds: [''] }).success).toBe(false);
    expect(
      workoutOrderInputSchema.safeParse({ programExerciseIds: ['x'.repeat(65)] }).success,
    ).toBe(false);
    expect(
      workoutOrderInputSchema.safeParse({
        programExerciseIds: Array.from({ length: 201 }, (_, i) => `id-${i}`),
      }).success,
    ).toBe(false);
  });
});

describe('workoutInputSchema', () => {
  it('accepts a name with a valid day of week', () => {
    const parsed = workoutInputSchema.parse({ name: 'Push', dayOfWeek: 1 });
    expect(parsed).toEqual({ name: 'Push', dayOfWeek: 1 });
  });

  it('trims the name and rejects an empty one', () => {
    expect(workoutInputSchema.parse({ name: '  Pull  ' }).name).toBe('Pull');
    expect(workoutInputSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('normalizes an empty-string day of week to null', () => {
    expect(workoutInputSchema.parse({ name: 'Legs', dayOfWeek: '' }).dayOfWeek).toBeNull();
  });

  it('coerces a numeric-string day and rejects out-of-range days', () => {
    expect(workoutInputSchema.parse({ name: 'Legs', dayOfWeek: '3' }).dayOfWeek).toBe(3);
    expect(workoutInputSchema.safeParse({ name: 'Legs', dayOfWeek: 8 }).success).toBe(false);
    expect(workoutInputSchema.safeParse({ name: 'Legs', dayOfWeek: 0 }).success).toBe(false);
  });
});
