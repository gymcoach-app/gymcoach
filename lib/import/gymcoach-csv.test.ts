import { describe, it, expect } from 'vitest';
import { csvEscape, HISTORY_CSV_HEADERS } from '@/lib/csv';
import {
  GYMCOACH_CSV_MAX_BYTES,
  GYMCOACH_CSV_MAX_ROWS,
  parseGymcoachCsv,
  stripFormulaGuard,
} from './gymcoach-csv';

// Minimal header: only the required columns, in a shuffled order to prove the
// mapping is name-based, plus workout for grouping.
const MIN_HEADER = 'reps,external_load_kg,set_number,exercise,session_date,workout';

function minRow(over: Partial<Record<string, string>> = {}): string {
  const cells = {
    reps: '8',
    external_load_kg: '80',
    set_number: '1',
    exercise: 'Bench Press',
    session_date: '2026-05-02',
    workout: 'Push Day',
    ...over,
  };
  return [
    cells.reps,
    cells.external_load_kg,
    cells.set_number,
    cells.exercise,
    cells.session_date,
    cells.workout,
  ].join(',');
}

// Build a full export-shaped row (all HISTORY_CSV_HEADERS columns) the same
// way app/api/history/csv/route.ts does: csvEscape on every cell.
function exportRow(over: Partial<Record<(typeof HISTORY_CSV_HEADERS)[number], string>> = {}): string {
  const defaults: Record<(typeof HISTORY_CSV_HEADERS)[number], string> = {
    session_id: 'sess-1',
    session_date: '2026-05-02',
    session_started_at: '2026-05-02T09:13:00.000Z',
    session_finished_at: '2026-05-02T10:05:00.000Z',
    duration_min: '52',
    program: 'PPL',
    workout: 'Push Day',
    exercise: 'Bench Press',
    muscle_group: 'CHEST',
    uses_bodyweight: 'false',
    set_number: '1',
    external_load_kg: '80',
    effective_weight_kg: '80',
    reps: '8',
    rir: '2',
    is_warmup: 'false',
    is_drop_set: 'false',
    volume_kg: '640',
    estimated_1rm_kg: '101.28',
    set_notes: 'felt strong',
    duration_sec: '',
    distance_m: '',
    avg_hr: '',
    max_hr: '',
    block: '',
  };
  const cells = { ...defaults, ...over };
  return HISTORY_CSV_HEADERS.map((h) => csvEscape(cells[h])).join(',');
}

const EXPORT_HEADER = HISTORY_CSV_HEADERS.join(',');

describe('parseGymcoachCsv - header handling', () => {
  it('accepts the full export header (BOM included) and the minimal one', () => {
    const full = parseGymcoachCsv('﻿' + [EXPORT_HEADER, exportRow()].join('\n'));
    expect(full.ok).toBe(true);
    expect(full.rows).toHaveLength(1);

    const minimal = parseGymcoachCsv([MIN_HEADER, minRow()].join('\n'));
    expect(minimal.ok).toBe(true);
    expect(minimal.rows).toHaveLength(1);
  });

  it('rejects a header missing a required column', () => {
    const res = parseGymcoachCsv('session_date,exercise,set_number,reps\n2026-05-02,Bench,1,8');
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/unrecognized format/i);
  });

  it('rejects a Strong-format file (formats are not interchangeable)', () => {
    const res = parseGymcoachCsv(
      'Date,Workout Name,Exercise Name,Set Order,Weight,Reps\n2026-05-02,Push,Bench,1,80,8',
    );
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/unrecognized format/i);
  });

  it('rejects an empty file and enforces the hard caps', () => {
    expect(parseGymcoachCsv('').ok).toBe(false);

    const big = 'x'.repeat(GYMCOACH_CSV_MAX_BYTES + 1);
    expect(parseGymcoachCsv(big).fatalError).toMatch(/too large/i);

    const rows = Array.from({ length: GYMCOACH_CSV_MAX_ROWS + 1 }, () => minRow());
    const res = parseGymcoachCsv([MIN_HEADER, ...rows].join('\n'));
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/too many rows/i);
  });
});

describe('parseGymcoachCsv - export round-trip', () => {
  it('reads back what the history export writes (strength row)', () => {
    const res = parseGymcoachCsv([EXPORT_HEADER, exportRow()].join('\n'));
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toEqual({
      dateKey: '2026-05-02',
      workoutName: 'Push Day',
      exerciseName: 'Bench Press',
      setOrder: 1,
      weightKg: 80,
      reps: 8,
      rir: 2,
      notes: 'felt strong',
      isWarmup: false,
      isDropSet: false,
      durationSec: null,
      distanceM: null,
      avgHr: null,
      maxHr: null,
      block: null,
      startedAtIso: '2026-05-02T09:13:00.000Z',
      finishedAtIso: '2026-05-02T10:05:00.000Z',
      sessionKey: 'id:sess-1',
    });
  });

  it('reads back a cardio row with duration, distance and heart rate', () => {
    const res = parseGymcoachCsv(
      [
        EXPORT_HEADER,
        exportRow({
          exercise: 'Running',
          external_load_kg: '0',
          reps: '1',
          rir: '',
          set_notes: '',
          duration_sec: '1800',
          distance_m: '5000',
          avg_hr: '150',
          max_hr: '172',
        }),
      ].join('\n'),
    );
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({
      exerciseName: 'Running',
      weightKg: 0,
      reps: 1,
      durationSec: 1800,
      distanceM: 5000,
      avgHr: 150,
      maxHr: 172,
      rir: null,
      notes: null,
    });
  });

  it('un-escapes the formula-injection guard the export adds (true round-trip)', () => {
    // csvEscape turns '=2+2' into "'=2+2"; importing the export must restore
    // the raw stored value, not keep growing quote prefixes.
    const res = parseGymcoachCsv(
      [
        EXPORT_HEADER,
        exportRow({ exercise: '=2+2', workout: '+DDE', set_notes: '@cmd' }),
      ].join('\n'),
    );
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({
      exerciseName: '=2+2',
      workoutName: '+DDE',
      notes: '@cmd',
    });
  });

  it('keeps quoted fields with commas and newlines intact', () => {
    const res = parseGymcoachCsv(
      [EXPORT_HEADER, exportRow({ set_notes: 'line one\nwith, comma' })].join('\n'),
    );
    expect(res.errors).toEqual([]);
    expect(res.rows[0]?.notes).toBe('line one\nwith, comma');
  });
});

describe('parseGymcoachCsv - block column (issue #475)', () => {
  it('reads back the block of a repeated lift from the export', () => {
    const res = parseGymcoachCsv([EXPORT_HEADER, exportRow({ block: '1' })].join('\n'));
    expect(res.errors).toEqual([]);
    expect(res.rows[0]?.block).toBe(1);
  });

  it('reads an empty cell or a file without the column as no block', () => {
    const empty = parseGymcoachCsv([EXPORT_HEADER, exportRow({ block: '' })].join('\n'));
    expect(empty.rows[0]?.block).toBeNull();
    expect(empty.hasBlockColumn).toBe(true);
    // An export written before the column existed (issue #475).
    const old = parseGymcoachCsv([MIN_HEADER, minRow()].join('\n'));
    expect(old.errors).toEqual([]);
    expect(old.rows[0]?.block).toBeNull();
    expect(old.hasBlockColumn).toBe(false);
  });

  it('rejects an out-of-range or malformed block with a per-line error', () => {
    const res = parseGymcoachCsv(
      [EXPORT_HEADER, exportRow({ block: '20' }), exportRow({ block: '-1' }), exportRow({ block: 'x' })].join(
        '\n',
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.rows).toEqual([]);
    expect(res.errors).toHaveLength(3);
    expect(res.errors.every((e) => /block/.test(e.reason))).toBe(true);
  });
});

describe('stripFormulaGuard', () => {
  it('strips the guard quote only when it hides a formula character', () => {
    expect(stripFormulaGuard("'=SUM(A1)")).toBe('=SUM(A1)');
    expect(stripFormulaGuard("'+1")).toBe('+1');
    expect(stripFormulaGuard("'-1")).toBe('-1');
    expect(stripFormulaGuard("'@cmd")).toBe('@cmd');
    // A legitimate leading apostrophe stays.
    expect(stripFormulaGuard("'til failure")).toBe("'til failure");
    expect(stripFormulaGuard('plain')).toBe('plain');
  });
});

describe('parseGymcoachCsv - lenient optional columns', () => {
  it('works without session_id / times / flags: noon fallback and defaults', () => {
    const res = parseGymcoachCsv([MIN_HEADER, minRow()].join('\n'));
    expect(res.rows[0]).toMatchObject({
      startedAtIso: null,
      finishedAtIso: null,
      isWarmup: false,
      isDropSet: false,
      rir: null,
      notes: null,
    });
    expect(res.rows[0]).not.toHaveProperty('sessionKey');
  });

  it('defaults an empty workout cell to a generic name', () => {
    const res = parseGymcoachCsv([MIN_HEADER, minRow({ workout: '' })].join('\n'));
    expect(res.rows[0]?.workoutName).toBe('Workout');
  });

  it('reads a hand-edited zoneless timestamp as UTC, never server-local', () => {
    const res = parseGymcoachCsv(
      [
        EXPORT_HEADER,
        exportRow({
          session_started_at: '2026-05-02 09:13',
          session_finished_at: '2026-05-02T10:05:30',
        }),
      ].join('\n'),
    );
    expect(res.errors).toEqual([]);
    expect(res.rows[0]?.startedAtIso).toBe('2026-05-02T09:13:00.000Z');
    expect(res.rows[0]?.finishedAtIso).toBe('2026-05-02T10:05:30.000Z');
  });

  it('degrades a malformed timestamp to null instead of failing the row', () => {
    const res = parseGymcoachCsv(
      [EXPORT_HEADER, exportRow({ session_started_at: 'yesterday-ish' })].join('\n'),
    );
    expect(res.errors).toEqual([]);
    expect(res.rows[0]?.startedAtIso).toBeNull();
  });

  it('allows reps 0 on a strength row (the native set schema allows it)', () => {
    const res = parseGymcoachCsv([MIN_HEADER, minRow({ reps: '0' })].join('\n'));
    expect(res.errors).toEqual([]);
    expect(res.rows[0]?.reps).toBe(0);
  });

  it('parses warmup/dropset flags from the export booleans', () => {
    const res = parseGymcoachCsv(
      [EXPORT_HEADER, exportRow({ is_warmup: 'true', is_drop_set: 'TRUE' })].join('\n'),
    );
    expect(res.rows[0]).toMatchObject({ isWarmup: true, isDropSet: true });
  });
});

describe('parseGymcoachCsv - hostile and malformed rows', () => {
  it('collects per-line errors without failing the file', () => {
    const res = parseGymcoachCsv(
      [
        MIN_HEADER,
        minRow(),
        minRow({ session_date: 'not-a-date' }),
        minRow({ session_date: '2026-13-40' }),
        minRow({ reps: 'DROP TABLE' }),
        minRow({ reps: '101' }),
        minRow({ external_load_kg: '-5' }),
        minRow({ external_load_kg: '9001' }),
        minRow({ set_number: '0' }),
        minRow({ exercise: '' }),
        minRow({ exercise: 'x'.repeat(121) }),
      ].join('\n'),
    );
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(res.errors).toHaveLength(9);
    // 1-based file lines: header is line 1, the first bad row is line 3.
    expect(res.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('rejects out-of-range rir and heart rate with per-line errors', () => {
    const res = parseGymcoachCsv(
      [
        EXPORT_HEADER,
        exportRow({ rir: '9' }),
        exportRow({ duration_sec: '1800', avg_hr: '400', rir: '' }),
        exportRow({ duration_sec: '0' }),
        exportRow({ duration_sec: '1800', distance_m: '-10', rir: '' }),
      ].join('\n'),
    );
    expect(res.rows).toHaveLength(0);
    expect(res.errors).toHaveLength(4);
  });

  it('rejects cardio-only fields on a strength row instead of dropping them', () => {
    const res = parseGymcoachCsv(
      [
        EXPORT_HEADER,
        exportRow({ avg_hr: '150' }),
        exportRow({ distance_m: '5000' }),
      ].join('\n'),
    );
    expect(res.rows).toHaveLength(0);
    expect(res.errors.map((e) => e.reason)).toEqual([
      'avg_hr/max_hr require a cardio row (non-empty duration_sec).',
      'distance_m requires a cardio row (non-empty duration_sec).',
    ]);
  });

  it('neutralizes formula payloads only via the guard, never evaluates', () => {
    // A hostile cell is just data: it round-trips as a string.
    const res = parseGymcoachCsv(
      [MIN_HEADER, minRow({ exercise: '=HYPERLINK(evil)' })].join('\n'),
    );
    expect(res.errors).toEqual([]);
    expect(res.rows[0]?.exerciseName).toBe('=HYPERLINK(evil)');
  });
});
