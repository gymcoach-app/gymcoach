import { describe, it, expect } from 'vitest';
import { programExerciseInputSchema } from './program-exercise';

describe('programExerciseInputSchema', () => {
  const valid = {
    exerciseId: 'ex1',
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetRIR: 2,
    restSec: 120,
    autoregulationMode: 'PRESERVE_RIR' as const,
    fatigueRate: 0.75,
    loadAdjustmentPct: 2.5,
  };

  it('accepts a valid program exercise and coerces numeric strings', () => {
    const parsed = programExerciseInputSchema.parse({ ...valid, targetSets: '4' });
    expect(parsed.targetSets).toBe(4);
  });

  it('allows an equal rep range (min === max)', () => {
    expect(
      programExerciseInputSchema.safeParse({ ...valid, targetRepsMin: 10, targetRepsMax: 10 })
        .success,
    ).toBe(true);
  });

  it('rejects targetRepsMax below targetRepsMin (cross-field refine)', () => {
    const res = programExerciseInputSchema.safeParse({
      ...valid,
      targetRepsMin: 12,
      targetRepsMax: 8,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes('targetRepsMax'))).toBe(true);
    }
  });

  it('enforces bounds on sets, RIR, and rest', () => {
    expect(programExerciseInputSchema.safeParse({ ...valid, targetSets: 21 }).success).toBe(false);
    expect(programExerciseInputSchema.safeParse({ ...valid, targetRIR: 6 }).success).toBe(false);
    expect(programExerciseInputSchema.safeParse({ ...valid, restSec: 14 }).success).toBe(false);
  });

  // Superset pairing (issue #146, slice 1).
  it('accepts a superset group within bounds, null, or absent (distinct states)', () => {
    const withGroup = programExerciseInputSchema.parse({ ...valid, supersetGroup: 3 });
    expect(withGroup.supersetGroup).toBe(3);

    const cleared = programExerciseInputSchema.parse({ ...valid, supersetGroup: null });
    expect(cleared.supersetGroup).toBeNull();

    // Absent stays absent (undefined), so an update can leave it unchanged.
    const absent = programExerciseInputSchema.parse(valid);
    expect(absent.supersetGroup).toBeUndefined();
  });

  it('rejects out-of-bounds or non-integer superset groups', () => {
    expect(programExerciseInputSchema.safeParse({ ...valid, supersetGroup: 0 }).success).toBe(
      false,
    );
    expect(programExerciseInputSchema.safeParse({ ...valid, supersetGroup: 10 }).success).toBe(
      false,
    );
    expect(programExerciseInputSchema.safeParse({ ...valid, supersetGroup: 1.5 }).success).toBe(
      false,
    );
  });

  it('accepts both next-set autoregulation modes', () => {
    expect(
      programExerciseInputSchema.parse({
        ...valid,
        autoregulationMode: 'PRESERVE_REPS',
      }).autoregulationMode,
    ).toBe('PRESERVE_REPS');
  });

  it('rejects unsafe autoregulation coefficients', () => {
    expect(programExerciseInputSchema.safeParse({ ...valid, fatigueRate: 2.1 }).success).toBe(
      false,
    );
    expect(programExerciseInputSchema.safeParse({ ...valid, loadAdjustmentPct: 0.5 }).success).toBe(
      false,
    );
  });

  // Cardio target (issue #558, slice 1).
  it('accepts a cardio target, null, or absent (distinct states)', () => {
    const withTarget = programExerciseInputSchema.parse({
      ...valid,
      targetDurationSec: 1200,
      targetDistanceM: 5000,
    });
    expect(withTarget.targetDurationSec).toBe(1200);
    expect(withTarget.targetDistanceM).toBe(5000);

    const durationOnly = programExerciseInputSchema.parse({ ...valid, targetDurationSec: 1200 });
    expect(durationOnly.targetDistanceM).toBeUndefined();

    const cleared = programExerciseInputSchema.parse({
      ...valid,
      targetDurationSec: null,
      targetDistanceM: null,
    });
    expect(cleared.targetDurationSec).toBeNull();
    expect(cleared.targetDistanceM).toBeNull();

    // Absent stays absent (undefined), so an update can leave it unchanged.
    const absent = programExerciseInputSchema.parse(valid);
    expect(absent.targetDurationSec).toBeUndefined();
    expect(absent.targetDistanceM).toBeUndefined();
  });

  it('bounds the cardio target like a logged cardio set', () => {
    const ok = (extra: Record<string, unknown>) =>
      programExerciseInputSchema.safeParse({ ...valid, ...extra }).success;
    expect(ok({ targetDurationSec: 1 })).toBe(true);
    expect(ok({ targetDurationSec: 86400 })).toBe(true);
    expect(ok({ targetDurationSec: 0 })).toBe(false);
    expect(ok({ targetDurationSec: 86401 })).toBe(false);
    expect(ok({ targetDurationSec: 90.5 })).toBe(false);
    expect(ok({ targetDurationSec: '1200' })).toBe(false);
    expect(ok({ targetDurationSec: 1200, targetDistanceM: 1000000 })).toBe(true);
    expect(ok({ targetDurationSec: 1200, targetDistanceM: 1000001 })).toBe(false);
    expect(ok({ targetDurationSec: 1200, targetDistanceM: 0 })).toBe(false);
    expect(ok({ targetDurationSec: 1200, targetDistanceM: -5 })).toBe(false);
  });

  it('refuses a distance sent while the duration is cleared', () => {
    const res = programExerciseInputSchema.safeParse({
      ...valid,
      targetDurationSec: null,
      targetDistanceM: 5000,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes('targetDistanceM'))).toBe(true);
    }
  });
});
