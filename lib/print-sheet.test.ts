import { describe, expect, it } from 'vitest';
import {
  buildPrintSheet,
  buildSetCells,
  cellsBySet,
  type PrintSheetExerciseInput,
} from './print-sheet';

function pe(overrides: Partial<PrintSheetExerciseInput> & { id: string }): PrintSheetExerciseInput {
  return {
    order: 1,
    supersetGroup: null,
    exercise: { name: `Exercise ${overrides.id}` },
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetRIR: 2,
    restSec: 90,
    tempo: null,
    notes: null,
    ...overrides,
  };
}

describe('buildSetCells', () => {
  it('yields weight, reps and RIR per planned set, set-major', () => {
    expect(buildSetCells(2)).toEqual([
      { set: 1, kind: 'weight' },
      { set: 1, kind: 'reps' },
      { set: 1, kind: 'rir' },
      { set: 2, kind: 'weight' },
      { set: 2, kind: 'reps' },
      { set: 2, kind: 'rir' },
    ]);
  });

  it('yields nothing for a non-positive or fractional-zero set count', () => {
    expect(buildSetCells(0)).toEqual([]);
    expect(buildSetCells(-2)).toEqual([]);
    expect(buildSetCells(0.9)).toEqual([]);
  });
});

describe('buildPrintSheet', () => {
  it('builds one row per exercise with sets x 3 empty cells and the widest set count', () => {
    const sheet = buildPrintSheet([
      pe({ id: 'a', order: 1, targetSets: 3 }),
      pe({ id: 'b', order: 2, targetSets: 5 }),
      pe({ id: 'c', order: 3, targetSets: 2 }),
    ]);

    expect(sheet.rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(sheet.rows.map((row) => row.cells.length)).toEqual([9, 15, 6]);
    expect(sheet.maxSets).toBe(5);
    expect(sheet.cellCount).toBe(30);
    expect(sheet.rows.every((row) => row.supersetLabel === null)).toBe(true);
  });

  it('carries the plan (reps range, RIR, rest, tempo, notes) and the exercise name', () => {
    const sheet = buildPrintSheet([
      pe({
        id: 'a',
        exercise: { name: 'Back Squat' },
        targetRepsMin: 5,
        targetRepsMax: 5,
        targetRIR: 1,
        restSec: 180,
        tempo: '3-1-1',
        notes: 'Belt on the top set',
      }),
    ]);
    const row = sheet.rows[0];
    expect(row).toBeDefined();
    expect(row?.name).toBe('Back Squat');
    expect(row?.targetRepsMin).toBe(5);
    expect(row?.targetRepsMax).toBe(5);
    expect(row?.targetRIR).toBe(1);
    expect(row?.restSec).toBe(180);
    expect(row?.tempo).toBe('3-1-1');
    expect(row?.notes).toBe('Belt on the top set');
  });

  it('orders superset members together and labels them A1/A2 like the builder', () => {
    const sheet = buildPrintSheet([
      pe({ id: 'bench', order: 1, supersetGroup: 1 }),
      pe({ id: 'curl', order: 2 }),
      pe({ id: 'row', order: 3, supersetGroup: 1 }),
    ]);

    expect(sheet.rows.map((row) => row.id)).toEqual(['bench', 'row', 'curl']);
    expect(sheet.rows.map((row) => row.supersetLabel)).toEqual(['A1', 'A2', null]);
  });

  it('is empty for a workout with no exercises', () => {
    expect(buildPrintSheet([])).toEqual({ rows: [], maxSets: 0, cellCount: 0 });
  });

  // Cardio target (issue #558, slice 1).
  it('marks a cardio row and carries its target text', () => {
    const sheet = buildPrintSheet([
      pe({ id: 'bench', order: 1, exercise: { name: 'Bench', category: 'COMPOUND' } }),
      pe({
        id: 'run',
        order: 2,
        exercise: { name: 'Running', category: 'CARDIO' },
        targetSets: 1,
        targetDurationSec: 1200,
        targetDistanceM: 5000,
      }),
      pe({ id: 'bike', order: 3, exercise: { name: 'Bike', category: 'CARDIO' }, targetSets: 1 }),
    ]);

    expect(sheet.rows.map((row) => row.cardio)).toEqual([false, true, true]);
    expect(sheet.rows.map((row) => row.cardioTarget)).toEqual([null, '20 min · 5 km', null]);
  });

  it('never reads a target on a strength row, and treats a missing category as strength', () => {
    const sheet = buildPrintSheet([
      pe({
        id: 'bench',
        exercise: { name: 'Bench', category: 'COMPOUND' },
        targetDurationSec: 1200,
      }),
      pe({ id: 'legacy', order: 2, targetDurationSec: 1200 }),
    ]);
    expect(sheet.rows.map((row) => row.cardio)).toEqual([false, false]);
    expect(sheet.rows.map((row) => row.cardioTarget)).toEqual([null, null]);
  });
});

describe('cellsBySet', () => {
  it('returns the three cells of one set and nothing beyond the planned sets', () => {
    const sheet = buildPrintSheet([pe({ id: 'a', targetSets: 2 })]);
    const row = sheet.rows[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(cellsBySet(row, 2).map((cell) => cell.kind)).toEqual(['weight', 'reps', 'rir']);
    expect(cellsBySet(row, 3)).toEqual([]);
  });
});
