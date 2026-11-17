import { describe, expect, it } from 'vitest';
import {
  buildCardioCells,
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

// Cardio boxes (issue #576).
describe('buildCardioCells', () => {
  it('yields a duration and a distance cell per planned set, without a target key', () => {
    expect(buildCardioCells(2)).toEqual([
      { set: 1, kind: 'duration' },
      { set: 1, kind: 'distance' },
      { set: 2, kind: 'duration' },
      { set: 2, kind: 'distance' },
    ]);
    expect(Object.keys(buildCardioCells(1)[0]!)).toEqual(['set', 'kind']);
  });

  it('carries each half of the target on its own cell', () => {
    expect(buildCardioCells(1, { duration: '20 min', distance: '5 km' })).toEqual([
      { set: 1, kind: 'duration', target: '20 min' },
      { set: 1, kind: 'distance', target: '5 km' },
    ]);
    expect(buildCardioCells(1, { duration: '20 min', distance: null })).toEqual([
      { set: 1, kind: 'duration', target: '20 min' },
      { set: 1, kind: 'distance' },
    ]);
  });

  it('yields nothing for a non-positive set count', () => {
    expect(buildCardioCells(0)).toEqual([]);
    expect(buildCardioCells(-1)).toEqual([]);
  });
});

describe('buildPrintSheet cardio boxes (issue #576)', () => {
  const bench = pe({ id: 'bench', order: 1, exercise: { name: 'Bench', category: 'COMPOUND' } });
  const run = pe({
    id: 'run',
    order: 2,
    exercise: { name: 'Running', category: 'CARDIO' },
    targetSets: 1,
    targetRepsMin: 1,
    targetRepsMax: 1,
    targetDurationSec: 1200,
    targetDistanceM: 5000,
  });

  it('gives a cardio row duration and distance cells with the target, never weight, reps or RIR', () => {
    const sheet = buildPrintSheet([bench, run]);
    expect(sheet.rows[1]?.cells).toEqual([
      { set: 1, kind: 'duration', target: '20 min' },
      { set: 1, kind: 'distance', target: '5 km' },
    ]);
    // 3 strength sets x 3 cells + 1 cardio set x 2 cells; 3 set columns.
    expect(sheet.cellCount).toBe(11);
    expect(sheet.maxSets).toBe(3);
  });

  it('leaves the distance box, or both boxes, empty when that target is not set', () => {
    const sheet = buildPrintSheet([
      { ...run, id: 'timed', targetDistanceM: null },
      { ...run, id: 'legacy', order: 3, targetDurationSec: null, targetDistanceM: null },
    ]);
    expect(sheet.rows[0]?.cells).toEqual([
      { set: 1, kind: 'duration', target: '20 min' },
      { set: 1, kind: 'distance' },
    ]);
    expect(sheet.rows[1]?.cells).toEqual([
      { set: 1, kind: 'duration' },
      { set: 1, kind: 'distance' },
    ]);
  });

  it('counts set columns per set, not per three cells, on a cardio-only sheet', () => {
    const sheet = buildPrintSheet([{ ...run, targetSets: 4 }]);
    expect(sheet.rows[0]?.cells).toHaveLength(8);
    expect(sheet.maxSets).toBe(4);
    expect(cellsBySet(sheet.rows[0]!, 4).map((cell) => cell.kind)).toEqual([
      'duration',
      'distance',
    ]);
  });

  it('leaves a strength row exactly as it was, with or without a cardio row next to it', () => {
    const alone = buildPrintSheet([bench]).rows[0];
    const mixed = buildPrintSheet([bench, run], { locale: 'de', distanceUnit: 'mi' }).rows[0];
    expect(mixed).toEqual(alone);
    expect(JSON.stringify(mixed)).toBe(JSON.stringify(alone));
    expect(alone?.cells).toEqual(buildSetCells(3));
    expect(alone?.cells.every((cell) => !('target' in cell))).toBe(true);
  });

  it('writes the target in the locale and the distance unit it is given', () => {
    const de = buildPrintSheet([{ ...run, targetDistanceM: 2500 }], { locale: 'de' }).rows[0];
    expect(de?.cardioTarget).toBe('20 Min. · 2,5 km');
    expect(de?.cells.map((cell) => cell.target)).toEqual(['20 Min.', '2,5 km']);

    const miles = buildPrintSheet([run], { distanceUnit: 'mi' }).rows[0];
    expect(miles?.cardioTarget).toBe('20 min · 3.11 mi');
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
