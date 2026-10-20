import { describe, it, expect } from 'vitest';
import {
  buildStrongImportPlan,
  sessionDateFromKey,
  setDuplicateKey,
  type NormalizedImportRow,
} from './strong-import';
import type { StrongCsvRow } from './strong-csv';

function row(over: Partial<StrongCsvRow> = {}): StrongCsvRow {
  return {
    dateKey: '2026-05-02',
    workoutName: 'Push',
    exerciseName: 'Bench',
    setOrder: 1,
    weightKg: 80,
    reps: 8,
    ...over,
  };
}

describe('buildStrongImportPlan', () => {
  it('groups rows by (date, workout name) into sessions', () => {
    const plan = buildStrongImportPlan(
      [
        row({ setOrder: 1 }),
        row({ setOrder: 2 }),
        row({ dateKey: '2026-05-03', workoutName: 'Pull', exerciseName: 'Row' }),
        row({ dateKey: '2026-05-02', workoutName: 'Evening', exerciseName: 'Curl' }),
      ],
      [],
      new Set(),
    );
    expect(plan.sessions.map((s) => `${s.dateKey}|${s.workoutName}`)).toEqual([
      '2026-05-02|Push',
      '2026-05-02|Evening',
      '2026-05-03|Pull',
    ]);
    expect(plan.totalSets).toBe(4);
  });

  it('matches existing exercises case-insensitively and lists only missing ones', () => {
    const plan = buildStrongImportPlan(
      [row({ exerciseName: 'bench' }), row({ exerciseName: 'New Lift', setOrder: 2 })],
      ['Bench'],
      new Set(),
    );
    expect(plan.newExerciseNames).toEqual(['New Lift']);
  });

  it('deduplicates new exercise names case-insensitively within the file', () => {
    const plan = buildStrongImportPlan(
      [
        row({ exerciseName: 'New Lift', setOrder: 1 }),
        row({ exerciseName: 'new lift', setOrder: 2 }),
      ],
      [],
      new Set(),
    );
    expect(plan.newExerciseNames).toEqual(['New Lift']);
  });

  it('skips exact duplicates of existing sets and counts them', () => {
    const existing = new Set([setDuplicateKey('2026-05-02', 'Bench', 1, 80, 8)]);
    const plan = buildStrongImportPlan(
      [row({ setOrder: 1 }), row({ setOrder: 2 })],
      ['Bench'],
      existing,
    );
    expect(plan.duplicateCount).toBe(1);
    expect(plan.totalSets).toBe(1);
    expect(plan.sessions[0]?.sets.map((s) => s.setOrder)).toEqual([2]);
  });

  it('skips exact duplicate rows within the file itself', () => {
    const plan = buildStrongImportPlan([row(), row()], [], new Set());
    expect(plan.duplicateCount).toBe(1);
    expect(plan.totalSets).toBe(1);
  });

  it('creates no session when every set of it is a duplicate', () => {
    const existing = new Set([setDuplicateKey('2026-05-02', 'Bench', 1, 80, 8)]);
    const plan = buildStrongImportPlan([row()], ['Bench'], existing);
    expect(plan.sessions).toEqual([]);
    expect(plan.totalSets).toBe(0);
  });
});

describe('sessionDateFromKey', () => {
  it('pins the session to noon UTC of its day', () => {
    expect(sessionDateFromKey('2026-05-02').toISOString()).toBe(
      '2026-05-02T12:00:00.000Z',
    );
  });
});

// Cardio rows in the plan (issue #134).
describe('buildStrongImportPlan - cardio sets', () => {
  const cardioRow = (over: Partial<StrongCsvRow> = {}): StrongCsvRow =>
    row({
      exerciseName: 'Running',
      weightKg: 0,
      reps: 1,
      durationSec: 1800,
      distanceM: 5000,
      ...over,
    });

  it('carries duration/distance onto planned sets and counts them', () => {
    const plan = buildStrongImportPlan([cardioRow(), row({ setOrder: 2 })], [], new Set());
    expect(plan.totalSets).toBe(2);
    expect(plan.cardioSetCount).toBe(1);
    const sets = plan.sessions[0]!.sets;
    const cardio = sets.find((s) => s.exerciseName === 'Running')!;
    expect(cardio.durationSec).toBe(1800);
    expect(cardio.distanceM).toBe(5000);
    const strength = sets.find((s) => s.exerciseName === 'Bench')!;
    expect(strength).not.toHaveProperty('durationSec');
  });

  it('flags a new exercise as cardio only when every row of it is cardio', () => {
    const plan = buildStrongImportPlan(
      [
        cardioRow(),
        cardioRow({ exerciseName: 'Rowing', setOrder: 2, distanceM: null }),
        // Mixed: one cardio row and one strength row for the same name.
        cardioRow({ exerciseName: 'Mixed Thing', setOrder: 3 }),
        row({ exerciseName: 'Mixed Thing', setOrder: 4 }),
      ],
      [],
      new Set(),
    );
    expect(plan.newExerciseNames).toEqual(['Mixed Thing', 'Rowing', 'Running']);
    expect(plan.newCardioExerciseNames).toEqual(['Rowing', 'Running']);
  });

  it('does not collapse two different cardio efforts at the same set order as duplicates', () => {
    const plan = buildStrongImportPlan(
      [
        cardioRow({ workoutName: 'AM Run' }),
        cardioRow({ workoutName: 'PM Run', durationSec: 2400, distanceM: 7000 }),
      ],
      [],
      new Set(),
    );
    expect(plan.duplicateCount).toBe(0);
    expect(plan.totalSets).toBe(2);
  });

  it('still skips an exact cardio duplicate (same duration and distance)', () => {
    const key = setDuplicateKey('2026-05-02', 'Running', 1, 0, 1, 1800, 5000);
    const plan = buildStrongImportPlan([cardioRow()], [], new Set([key]));
    expect(plan.duplicateCount).toBe(1);
    expect(plan.totalSets).toBe(0);
  });

  it('keeps a later block of a repeated lift apart, block 0 on the historical key', () => {
    // Issue #475: a 5/3/1 BBB set 1 is not a duplicate of the heavy set 1.
    expect(setDuplicateKey('2026-05-02', 'Bench', 1, 80, 8, null, null, 1)).toBe(
      '2026-05-02|bench|1|80|8|b1',
    );
    expect(setDuplicateKey('2026-05-02', 'Bench', 1, 80, 8, null, null, 0)).toBe(
      '2026-05-02|bench|1|80|8',
    );
    const plan = buildStrongImportPlan(
      [0, 1].map((block): NormalizedImportRow => ({ ...row(), block })),
      [],
      new Set(),
    );
    expect(plan.duplicateCount).toBe(0);
    expect(plan.sessions[0]?.sets.map((x) => x.block)).toEqual([0, 1]);
  });

  it('keeps strength duplicate keys byte-identical to the pre-cardio format', () => {
    expect(setDuplicateKey('2026-05-02', 'Bench', 1, 80, 8)).toBe(
      '2026-05-02|bench|1|80|8',
    );
    expect(setDuplicateKey('2026-05-02', 'Bench', 1, 80, 8, null, null)).toBe(
      '2026-05-02|bench|1|80|8',
    );
  });
});

describe('buildStrongImportPlan - GymCoach extras (issue #270)', () => {
  // Rows shaped like the GymCoach CSV parser emits: the shared normalized row
  // with the issue #270 extras (sessionKey, rir, notes, heart rate).
  function nrow(over: Partial<NormalizedImportRow> = {}): NormalizedImportRow {
    return { ...row(), ...over };
  }

  it('keeps two same-day sessions with the same workout name apart via sessionKey', () => {
    const plan = buildStrongImportPlan(
      [nrow({ sessionKey: 'id:a' }), nrow({ sessionKey: 'id:b', setOrder: 2 })],
      [],
      new Set(),
    );
    expect(plan.sessions).toHaveLength(2);
  });

  it('falls back to the historical (date, workout name) grouping without a sessionKey', () => {
    const plan = buildStrongImportPlan([nrow(), nrow({ setOrder: 2 })], [], new Set());
    expect(plan.sessions).toHaveLength(1);
  });

  it('carries rir, notes and heart rate onto the planned sets', () => {
    const plan = buildStrongImportPlan(
      [
        nrow({ rir: 2, notes: 'felt strong' }),
        nrow({ setOrder: 2, durationSec: 1800, distanceM: 5000, avgHr: 150, maxHr: 172 }),
        nrow({ setOrder: 3 }),
      ],
      [],
      new Set(),
    );
    const sets = plan.sessions[0]!.sets;
    expect(sets[0]).toMatchObject({ rir: 2, notes: 'felt strong' });
    expect(sets[1]).toMatchObject({ avgHr: 150, maxHr: 172, durationSec: 1800 });
    // Untouched Strong/Hevy-shaped rows plan without the extra keys.
    expect(sets[2]).not.toHaveProperty('rir');
    expect(sets[2]).not.toHaveProperty('notes');
  });
});
