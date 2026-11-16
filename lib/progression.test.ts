import { describe, expect, it } from 'vitest';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import {
  READINESS_DELOAD_FRACTION,
  READINESS_RECENCY_HOURS,
  readinessForSuggestion,
  suggestNextWeight,
  weightIncrement,
  type ReadinessSignal,
} from './progression';

const compoundExo: Exercise = {
  id: 'e1',
  userId: 'u',
  name: 'Squat',
  muscleGroup: 'QUADS',
  category: 'COMPOUND',
  defaultRestSec: 120,
  notes: null,
  usesBodyweight: false,
  equipmentType: 'BARBELL',
  isFavorite: false,
  createdAt: new Date(),
};

const isolationExo: Exercise = {
  id: 'e2',
  userId: 'u',
  name: 'Curl',
  muscleGroup: 'BICEPS',
  category: 'ISOLATION',
  defaultRestSec: 60,
  notes: null,
  usesBodyweight: false,
  equipmentType: 'DUMBBELL',
  isFavorite: false,
  createdAt: new Date(),
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
    targetSets: 3,
    targetRepsMin: 6,
    targetRepsMax: 10,
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

describe('weightIncrement', () => {
  it('returns 2.5 for compound', () => {
    expect(weightIncrement('COMPOUND')).toBe(2.5);
  });
  it('returns 1 for isolation', () => {
    expect(weightIncrement('ISOLATION')).toBe(1);
  });
});

describe('suggestNextWeight', () => {
  it('returns no-history when there are no previous sets', () => {
    const res = suggestNextWeight(makePe(compoundExo), []);
    expect(res).toEqual({ weight: null, reason: 'no-history' });
  });

  it('progresses a compound by +2.5 kg when every working set hit the top of the range', () => {
    const res = suggestNextWeight(makePe(compoundExo), [
      { weight: 80, reps: 10, rir: 2 },
      { weight: 80, reps: 10, rir: 2 },
      { weight: 80, reps: 10, rir: 2 },
    ]);
    expect(res).toMatchObject({
      weight: 82.5,
      reason: 'progression',
      delta: 2.5,
      workingWeight: 80,
      targetRepsMax: 10,
    });
  });

  it('keeps the same load when at least one working set fell short', () => {
    const res = suggestNextWeight(makePe(compoundExo), [
      { weight: 80, reps: 10, rir: 2 },
      { weight: 80, reps: 9, rir: 2 },
      { weight: 80, reps: 10, rir: 2 },
    ]);
    expect(res).toMatchObject({
      weight: 80,
      reason: 'same-as-last',
      workingWeight: 80,
    });
  });

  it('progresses an isolation by +1 kg at the top of the range', () => {
    const res = suggestNextWeight(makePe(isolationExo, { targetRepsMin: 8, targetRepsMax: 12 }), [
      { weight: 14, reps: 12, rir: 1 },
      { weight: 14, reps: 12, rir: 1 },
      { weight: 14, reps: 12, rir: 1 },
    ]);
    expect(res).toMatchObject({ weight: 15, reason: 'progression', delta: 1 });
  });

  it('ignores drop sets (lighter than working weight) when deciding', () => {
    const res = suggestNextWeight(makePe(compoundExo), [
      { weight: 80, reps: 10, rir: 2 },
      { weight: 80, reps: 10, rir: 2 },
      { weight: 80, reps: 10, rir: 2 },
      { weight: 70, reps: 8, rir: 0 },
    ]);
    expect(res).toMatchObject({ weight: 82.5, reason: 'progression' });
  });

  it('still progresses when reps strictly exceed the top of the range', () => {
    const res = suggestNextWeight(makePe(compoundExo), [
      { weight: 80, reps: 11, rir: 1 },
      { weight: 80, reps: 11, rir: 1 },
      { weight: 80, reps: 10, rir: 2 },
    ]);
    expect(res).toMatchObject({ weight: 82.5, reason: 'progression' });
  });

  it('handles bodyweight (0 kg) as a normal working weight', () => {
    const res = suggestNextWeight(makePe(isolationExo, { targetRepsMin: 8, targetRepsMax: 12 }), [
      { weight: 0, reps: 12, rir: 0 },
      { weight: 0, reps: 12, rir: 0 },
      { weight: 0, reps: 12, rir: 0 },
    ]);
    expect(res).toMatchObject({ weight: 1, reason: 'progression', delta: 1 });
  });
});

describe('suggestNextWeight - readiness auto-regulation (issue #53)', () => {
  // Sets that, with no readiness signal, progress the compound (QUADS) to 82.5.
  const progressingSets = [
    { weight: 80, reps: 10, rir: 2 },
    { weight: 80, reps: 10, rir: 2 },
    { weight: 80, reps: 10, rir: 2 },
  ];
  // Sets that, with no readiness signal, hold the compound at 80 (one fell short).
  const holdingSets = [
    { weight: 80, reps: 10, rir: 2 },
    { weight: 80, reps: 9, rir: 2 },
    { weight: 80, reps: 10, rir: 2 },
  ];

  // ----- Backward compatibility: no data => identical to today -----

  it('is byte-for-byte identical when no readiness arg is passed (progression)', () => {
    const withArg = suggestNextWeight(makePe(compoundExo), progressingSets);
    const withUndefined = suggestNextWeight(makePe(compoundExo), progressingSets, undefined);
    const withNull = suggestNextWeight(makePe(compoundExo), progressingSets, null);
    const expected = {
      weight: 82.5,
      reason: 'progression',
      delta: 2.5,
      workingWeight: 80,
      targetRepsMax: 10,
    };
    expect(withArg).toEqual(expected);
    expect(withUndefined).toEqual(expected);
    expect(withNull).toEqual(expected);
  });

  it('is identical to today on the no-history path even with a readiness signal', () => {
    const readiness: ReadinessSignal = { readiness: 1, soreness: { QUADS: 5 }, ageHours: 1 };
    expect(suggestNextWeight(makePe(compoundExo), [], readiness)).toEqual({
      weight: null,
      reason: 'no-history',
    });
  });

  it('ignores a stale check-in outside the recency window (unchanged output)', () => {
    const stale: ReadinessSignal = {
      readiness: 1,
      soreness: { QUADS: 5 },
      ageHours: READINESS_RECENCY_HOURS + 1,
    };
    expect(suggestNextWeight(makePe(compoundExo), progressingSets, stale)).toEqual(
      suggestNextWeight(makePe(compoundExo), progressingSets),
    );
  });

  it('ignores a recent but good check-in (unchanged output)', () => {
    const good: ReadinessSignal = { readiness: 5, soreness: { QUADS: 1 }, ageHours: 2 };
    expect(suggestNextWeight(makePe(compoundExo), progressingSets, good)).toEqual(
      suggestNextWeight(makePe(compoundExo), progressingSets),
    );
  });

  // ----- Hold: poor recovery skips the increment -----

  it('holds the load when soreness on the worked group is high (>= 4)', () => {
    const sore: ReadinessSignal = { readiness: 4, soreness: { QUADS: 4 }, ageHours: 5 };
    const res = suggestNextWeight(makePe(compoundExo), progressingSets, sore);
    expect(res).toEqual({
      weight: 80,
      reason: 'readiness-hold',
      workingWeight: 80,
      targetRepsMax: 10,
    });
  });

  it('holds the load when overall readiness is low (<= 2)', () => {
    const drained: ReadinessSignal = { readiness: 2, soreness: null, ageHours: 10 };
    const res = suggestNextWeight(makePe(compoundExo), progressingSets, drained);
    expect(res).toMatchObject({ weight: 80, reason: 'readiness-hold' });
  });

  it('only checks soreness for the exercise primary muscle group', () => {
    // High soreness on CHEST must not hold a QUADS exercise.
    const otherGroupSore: ReadinessSignal = {
      readiness: 4,
      soreness: { CHEST: 5 },
      ageHours: 5,
    };
    expect(suggestNextWeight(makePe(compoundExo), progressingSets, otherGroupSore)).toEqual(
      suggestNextWeight(makePe(compoundExo), progressingSets),
    );
  });

  // ----- Deload: very poor recovery steps down once -----

  it('steps down once when soreness on the worked group is severe (5)', () => {
    const severe: ReadinessSignal = { readiness: 3, soreness: { QUADS: 5 }, ageHours: 3 };
    const res = suggestNextWeight(makePe(compoundExo), progressingSets, severe);
    expect(res).toEqual({
      weight: +(80 * (1 - READINESS_DELOAD_FRACTION)).toFixed(2),
      reason: 'readiness-deload',
      workingWeight: 80,
      targetRepsMax: 10,
    });
  });

  it('steps down once when overall readiness is drained (1)', () => {
    const drained: ReadinessSignal = { readiness: 1, soreness: null, ageHours: 3 };
    const res = suggestNextWeight(makePe(compoundExo), progressingSets, drained);
    expect(res).toMatchObject({ weight: 72, reason: 'readiness-deload', workingWeight: 80 });
  });

  // ----- Invariant: readiness NEVER raises the suggestion -----

  it('never raises the suggestion: every recovery state stays at or below baseline', () => {
    const baseline = suggestNextWeight(makePe(compoundExo), progressingSets).weight as number;
    const signals: ReadinessSignal[] = [
      { readiness: 1, soreness: { QUADS: 5 }, ageHours: 1 }, // worst case
      { readiness: 2, soreness: { QUADS: 4 }, ageHours: 1 },
      { readiness: 1, soreness: null, ageHours: 1 },
      { readiness: 5, soreness: { QUADS: 5 }, ageHours: 1 },
      { readiness: 5, soreness: { QUADS: 1 }, ageHours: 1 }, // good -> baseline
    ];
    for (const sig of signals) {
      const res = suggestNextWeight(makePe(compoundExo), progressingSets, sig);
      expect(res.weight as number).toBeLessThanOrEqual(baseline);
    }
  });

  it('never raises even when the baseline was already a hold (same-as-last)', () => {
    const baseline = suggestNextWeight(makePe(compoundExo), holdingSets).weight as number;
    const deloadSignal: ReadinessSignal = { readiness: 1, soreness: { QUADS: 5 }, ageHours: 1 };
    const res = suggestNextWeight(makePe(compoundExo), holdingSets, deloadSignal);
    expect(res.weight as number).toBeLessThanOrEqual(baseline);
    expect(res.reason).toBe('readiness-deload');
  });
});

describe('readinessForSuggestion - auto-regulation preference gate (issue #61)', () => {
  const progressingSets = [
    { weight: 80, reps: 10, rir: 2 },
    { weight: 80, reps: 10, rir: 2 },
    { weight: 80, reps: 10, rir: 2 },
  ];
  // A worst-case in-window check-in: with #55 on, this forces a step-down.
  const drained: ReadinessSignal = { readiness: 1, soreness: { QUADS: 5 }, ageHours: 1 };

  it('passes the signal through unchanged when the preference is on', () => {
    expect(readinessForSuggestion(drained, true)).toBe(drained);
    expect(readinessForSuggestion(null, true)).toBeNull();
  });

  it('drops the signal entirely when the preference is off', () => {
    expect(readinessForSuggestion(drained, false)).toBeNull();
    expect(readinessForSuggestion(null, false)).toBeNull();
  });

  it('OFF: readiness has no effect, identical to the pre-#55 (no-signal) suggestion', () => {
    // Pre-#55 behavior is exactly "no readiness arg": pure programmed progression.
    const pre55 = suggestNextWeight(makePe(compoundExo), progressingSets);
    const gatedOff = suggestNextWeight(
      makePe(compoundExo),
      progressingSets,
      readinessForSuggestion(drained, false),
    );
    expect(gatedOff).toEqual(pre55);
    expect(gatedOff.reason).toBe('progression');
    expect(gatedOff.weight).toBe(82.5);
  });

  it('ON: readiness applies the #55 step-down for the same drained check-in', () => {
    const gatedOn = suggestNextWeight(
      makePe(compoundExo),
      progressingSets,
      readinessForSuggestion(drained, true),
    );
    const direct = suggestNextWeight(makePe(compoundExo), progressingSets, drained);
    expect(gatedOn).toEqual(direct);
    expect(gatedOn.reason).toBe('readiness-deload');
    expect(gatedOn.weight).toBe(+(80 * (1 - READINESS_DELOAD_FRACTION)).toFixed(2));
  });
});

// Planned deload week (issue #112). The boolean is resolved by the caller from
// User.deloadUntil (lib/deload.ts isDeloadActive); these tests pin the
// step-down, its precedence over progression/hold, and the no-stacking rule
// against a simultaneous readiness deload.
describe('suggestNextWeight planned deload', () => {
  const progressingSets = [
    { weight: 80, reps: 10, rir: 2 },
    { weight: 80, reps: 10, rir: 2 },
    { weight: 80, reps: 10, rir: 2 },
  ];

  it('steps the working load down 10% with the planned-deload reason', () => {
    const res = suggestNextWeight(makePe(compoundExo), progressingSets, null, true);
    expect(res).toMatchObject({
      weight: 72,
      reason: 'planned-deload',
      workingWeight: 80,
      targetRepsMax: 10,
    });
  });

  it('takes precedence over a programmed increment', () => {
    // Without the deload these sets progress to 82.5.
    const baseline = suggestNextWeight(makePe(compoundExo), progressingSets);
    expect(baseline.reason).toBe('progression');
    const deload = suggestNextWeight(makePe(compoundExo), progressingSets, null, true);
    expect(deload.reason).toBe('planned-deload');
    expect(deload.weight).toBeLessThan(baseline.weight!);
  });

  it('does not stack with a readiness deload: one 10% reduction, never both', () => {
    const drained: ReadinessSignal = { readiness: 1, soreness: null, ageHours: 1 };
    const readinessOnly = suggestNextWeight(makePe(compoundExo), progressingSets, drained);
    expect(readinessOnly.reason).toBe('readiness-deload');
    const both = suggestNextWeight(makePe(compoundExo), progressingSets, drained, true);
    // The same single reduction is applied (80 * 0.9 = 72, not 80 * 0.81).
    expect(both.weight).toBe(readinessOnly.weight);
    expect(both.weight).toBe(+(80 * (1 - READINESS_DELOAD_FRACTION)).toFixed(2));
    expect(both.reason).toBe('planned-deload');
  });

  it('wins over a readiness hold (the larger reduction applies)', () => {
    const poor: ReadinessSignal = { readiness: 2, soreness: null, ageHours: 1 };
    const holdOnly = suggestNextWeight(makePe(compoundExo), progressingSets, poor);
    expect(holdOnly).toMatchObject({ reason: 'readiness-hold', weight: 80 });
    const withDeload = suggestNextWeight(makePe(compoundExo), progressingSets, poor, true);
    expect(withDeload).toMatchObject({ reason: 'planned-deload', weight: 72 });
  });

  it('inactive (false/omitted) leaves the suggestion byte-identical to before', () => {
    const before = suggestNextWeight(makePe(compoundExo), progressingSets);
    const explicit = suggestNextWeight(makePe(compoundExo), progressingSets, null, false);
    expect(explicit).toEqual(before);
  });

  it('still reports no-history when there are no previous sets', () => {
    const res = suggestNextWeight(makePe(compoundExo), [], null, true);
    expect(res).toEqual({ weight: null, reason: 'no-history' });
  });
});
