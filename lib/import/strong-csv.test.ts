import { describe, it, expect } from 'vitest';
import {
  parseStrongCsv,
  STRONG_CSV_MAX_BYTES,
  STRONG_CSV_MAX_ROWS,
} from './strong-csv';

const HEADER =
  'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds';

function csv(...lines: string[]) {
  return [HEADER, ...lines].join('\n');
}

describe('parseStrongCsv happy path', () => {
  it('parses working sets into normalized kg rows', () => {
    const res = parseStrongCsv(
      csv(
        '2026-05-02 09:13:00,Push Day,Bench Press (Barbell),1,80,8,0,0',
        '2026-05-02 09:13:00,Push Day,Bench Press (Barbell),2,80,7,0,0',
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.rows).toEqual([
      {
        dateKey: '2026-05-02',
        workoutName: 'Push Day',
        exerciseName: 'Bench Press (Barbell)',
        setOrder: 1,
        weightKg: 80,
        reps: 8,
      },
      {
        dateKey: '2026-05-02',
        workoutName: 'Push Day',
        exerciseName: 'Bench Press (Barbell)',
        setOrder: 2,
        weightKg: 80,
        reps: 7,
      },
    ]);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    const res = parseStrongCsv(
      csv('2026-05-02,"Push, heavy","Press ""Smith"" machine",1,60,10,0,0'),
    );
    expect(res.rows[0]?.workoutName).toBe('Push, heavy');
    expect(res.rows[0]?.exerciseName).toBe('Press "Smith" machine');
  });

  it('tolerates extra columns and a different column order', () => {
    const res = parseStrongCsv(
      [
        'Workout Name,Date,Duration,Exercise Name,Set Order,Weight,Reps,RPE',
        'Pull,2026-05-03,1h,Row,1,70,10,8',
      ].join('\n'),
    );
    expect(res.ok).toBe(true);
    expect(res.rows[0]).toMatchObject({ exerciseName: 'Row', weightKg: 70 });
  });

  it('accepts an empty weight as 0 (bodyweight movement in Strong)', () => {
    const res = parseStrongCsv(csv('2026-05-02,Push,Push-up,1,,15,0,0'));
    expect(res.rows[0]?.weightKg).toBe(0);
  });
});

describe('parseStrongCsv units', () => {
  it('converts from lb when the toggle says the export is in lb', () => {
    const res = parseStrongCsv(csv('2026-05-02,Push,Bench,1,225,5,0,0'), 'LB');
    expect(res.rows[0]?.weightKg).toBeCloseTo(102.06, 2);
  });

  it('honors a kg suffix in the header over the toggle', () => {
    const res = parseStrongCsv(
      [
        'Date,Workout Name,Exercise Name,Set Order,Weight (kg),Reps',
        '2026-05-02,Push,Bench,1,80,5',
      ].join('\n'),
      'LB',
    );
    expect(res.rows[0]?.weightKg).toBe(80);
  });

  it('honors an lbs suffix in the header over the toggle', () => {
    const res = parseStrongCsv(
      [
        'Date,Workout Name,Exercise Name,Set Order,Weight (lbs),Reps',
        '2026-05-02,Push,Bench,1,225,5',
      ].join('\n'),
      'KG',
    );
    expect(res.rows[0]?.weightKg).toBeCloseTo(102.06, 2);
  });
});

describe('parseStrongCsv malformed input', () => {
  it('rejects an unrecognized header as fatal', () => {
    const res = parseStrongCsv('foo,bar\n1,2');
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/unrecognized format/i);
    expect(res.rows).toEqual([]);
  });

  it('rejects an empty file as fatal', () => {
    expect(parseStrongCsv('').ok).toBe(false);
  });

  it('collects per-line errors with line numbers instead of throwing', () => {
    const res = parseStrongCsv(
      csv(
        'not-a-date,Push,Bench,1,80,8,0,0', // line 2: bad date
        '2026-05-02,Push,Bench,one,80,8,0,0', // line 3: bad set order
        '2026-05-02,Push,Bench,2,80,8,0,0', // line 4: fine
        '2026-13-40,Push,Bench,3,80,8,0,0', // line 5: impossible date
        '2026-05-02,Push,Bench,4,9999,8,0,0', // line 6: weight above cap
        '2026-05-02,Push,,5,80,8,0,0', // line 7: empty exercise
      ),
    );
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(1);
    expect(res.errors.map((e) => e.line)).toEqual([2, 3, 5, 6, 7]);
  });

  // Cardio rows are imported as duration/distance sets since issue #134
  // (they were skipped with a count before).
  it('maps cardio rows (duration, optional distance) onto cardio sets', () => {
    const res = parseStrongCsv(
      csv(
        '2026-05-02,Cardio,Running,1,0,0,5000,1800',
        '2026-05-02,Cardio,Plank,1,0,0,0,60',
        '2026-05-02,Push,Bench,1,80,8,0,0',
      ),
    );
    expect(res.cardioSkipped).toBe(0);
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(3);
    // Metric export: Distance is in meters.
    expect(res.rows[0]).toEqual({
      dateKey: '2026-05-02',
      workoutName: 'Cardio',
      exerciseName: 'Running',
      setOrder: 1,
      weightKg: 0,
      reps: 1,
      durationSec: 1800,
      distanceM: 5000,
    });
    // Duration-only cardio: distance stays null.
    expect(res.rows[1]).toMatchObject({
      exerciseName: 'Plank',
      durationSec: 60,
      distanceM: null,
    });
    // The strength row is untouched (no cardio keys at all).
    expect(res.rows[2]).toEqual({
      dateKey: '2026-05-02',
      workoutName: 'Push',
      exerciseName: 'Bench',
      setOrder: 1,
      weightKg: 80,
      reps: 8,
    });
  });

  it('converts cardio distance from miles when the export unit is LB', () => {
    const res = parseStrongCsv(csv('2026-05-02,Cardio,Running,1,0,0,3,1800'), 'LB');
    expect(res.rows[0]).toMatchObject({
      durationSec: 1800,
      distanceM: +(3 * 1609.34).toFixed(2),
    });
  });

  it('still skips unrepresentable cardio rows with a count (no usable duration)', () => {
    const res = parseStrongCsv(
      csv(
        '2026-05-02,Cardio,Rowing,1,0,0,5000,0', // distance-only, no duration
        '2026-05-02,Cardio,Running,1,0,0,0,90000', // duration above the 24h cap
      ),
    );
    expect(res.cardioSkipped).toBe(2);
    expect(res.rows).toHaveLength(0);
    expect(res.errors).toEqual([]);
  });

  it('skips a cardio row whose converted distance exceeds the 1000 km cap', () => {
    const res = parseStrongCsv(csv('2026-05-02,Cardio,Cycling,1,0,0,2000000,3600'));
    expect(res.cardioSkipped).toBe(1);
    expect(res.rows).toHaveLength(0);
  });

  it('reports a cardio row with a bad set order as a line error', () => {
    const res = parseStrongCsv(csv('2026-05-02,Cardio,Running,zero,0,0,0,1800'));
    expect(res.cardioSkipped).toBe(0);
    expect(res.rows).toHaveLength(0);
    expect(res.errors).toHaveLength(1);
  });

  it('reports a 0-rep row with no duration as an error, not cardio', () => {
    const res = parseStrongCsv(csv('2026-05-02,Push,Bench,1,80,0,0,0'));
    expect(res.cardioSkipped).toBe(0);
    expect(res.errors).toHaveLength(1);
  });
});

describe('parseStrongCsv caps (untrusted input)', () => {
  it('rejects a file above the size cap', () => {
    const big = 'a'.repeat(STRONG_CSV_MAX_BYTES + 1);
    const res = parseStrongCsv(big);
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/too large/i);
  });

  it('rejects a file above the row cap', () => {
    // Tiny rows so the row cap fires before the size cap.
    const lines = new Array(STRONG_CSV_MAX_ROWS + 1).fill('x');
    const res = parseStrongCsv(csv(...lines));
    expect(res.ok).toBe(false);
    expect(res.fatalError).toMatch(/too many rows/i);
  });

  it('never evaluates content: a formula-looking cell is just a bad row', () => {
    const res = parseStrongCsv(
      csv('2026-05-02,Push,=cmd|calc,1,80,8,0,0'),
    );
    // The exercise name is kept as an inert string, never interpreted.
    expect(res.rows[0]?.exerciseName).toBe('=cmd|calc');
  });
});

// Issue #571: Strong writes letter markers in Set Order ('W' warm-up, 'F'
// failure, 'D' drop set) and rows that are not sets ('Rest Timer', 'Note').
describe('parseStrongCsv set markers and non-set rows (issue #571)', () => {
  // A realistic export shape: extra Notes column, rest timer rows carrying
  // their length in Seconds, a note row with no weight and no reps.
  const MARKER_HEADER =
    'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes';
  const MARKER_FIXTURE = [
    MARKER_HEADER,
    '2026-05-02 09:00:00,Push Day,Bench Press,W,40,10,0,0,', // line 2
    '2026-05-02 09:00:00,Push Day,Bench Press,Rest Timer,,,,60,', // line 3
    '2026-05-02 09:00:00,Push Day,Bench Press,W,60,5,0,0,', // line 4
    '2026-05-02 09:00:00,Push Day,Bench Press,1,80,8,0,0,', // line 5
    '2026-05-02 09:00:00,Push Day,Bench Press,Rest Timer,,,,120,', // line 6
    '2026-05-02 09:00:00,Push Day,Bench Press,2,80,7,0,0,', // line 7
    '2026-05-02 09:00:00,Push Day,Bench Press,F,80,5,0,0,', // line 8
    '2026-05-02 09:00:00,Push Day,Bench Press,D,60,9,0,0,', // line 9
    '2026-05-02 09:00:00,Push Day,Bench Press,Note,,,,,"Felt strong, elbows fine"', // line 10
    '2026-05-02 09:00:00,Push Day,Overhead Press,1,40,8,0,0,', // line 11
    '2026-05-02 09:00:00,Push Day,Overhead Press,2,40,7,0,0,', // line 12
  ].join('\n');

  it('imports W, F and D sets in file order and skips Rest Timer and Note rows', () => {
    const res = parseStrongCsv(MARKER_FIXTURE);
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.cardioSkipped).toBe(0);
    expect(res.nonSetSkipped).toBe(3);

    const bench = res.rows.filter((r) => r.exerciseName === 'Bench Press');
    // The exercise carries markers, so its sets are numbered by position.
    expect(bench.map((r) => [r.setOrder, r.weightKg, r.reps])).toEqual([
      [1, 40, 10],
      [2, 60, 5],
      [3, 80, 8],
      [4, 80, 7],
      [5, 80, 5],
      [6, 60, 9],
    ]);
    // W maps to the warm-up flag, D to the drop-set flag; F has no notion in
    // the Set model and is a normal set.
    expect(bench.map((r) => r.isWarmup)).toEqual([
      true,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(bench.map((r) => r.isDropSet)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    ]);
    // No rest timer row became a cardio set.
    expect(res.rows.some((r) => r.durationSec !== undefined)).toBe(false);
  });

  it('leaves an exercise without a marker untouched in the same file', () => {
    const res = parseStrongCsv(MARKER_FIXTURE);
    expect(res.rows.filter((r) => r.exerciseName === 'Overhead Press')).toStrictEqual([
      {
        dateKey: '2026-05-02',
        workoutName: 'Push Day',
        exerciseName: 'Overhead Press',
        setOrder: 1,
        weightKg: 40,
        reps: 8,
      },
      {
        dateKey: '2026-05-02',
        workoutName: 'Push Day',
        exerciseName: 'Overhead Press',
        setOrder: 2,
        weightKg: 40,
        reps: 7,
      },
    ]);
  });

  it('reads the markers whatever their case and spacing', () => {
    const res = parseStrongCsv(
      csv(
        '2026-05-02,Push,Bench, w ,40,10,0,0',
        '2026-05-02,Push,Bench,rest  timer,,,,90',
        '2026-05-02,Push,Bench,f,80,5,0,0',
        '2026-05-02,Push,Bench,NOTE,,,,',
        '2026-05-02,Push,Bench,d,60,9,0,0',
      ),
    );
    expect(res.errors).toEqual([]);
    expect(res.nonSetSkipped).toBe(2);
    expect(res.rows.map((r) => r.setOrder)).toEqual([1, 2, 3]);
    expect(res.rows[0]?.isWarmup).toBe(true);
    expect(res.rows[2]?.isDropSet).toBe(true);
  });

  it('numbers each workout of the same exercise on its own', () => {
    const res = parseStrongCsv(
      csv(
        '2026-05-02,Push,Bench,W,40,10,0,0',
        '2026-05-02,Push,Bench,1,80,8,0,0',
        // Same exercise, another day, no marker: file numbers kept (3, 4).
        '2026-05-04,Push,Bench,3,80,8,0,0',
        '2026-05-04,Push,Bench,4,80,7,0,0',
      ),
    );
    expect(res.rows.map((r) => [r.dateKey, r.setOrder])).toEqual([
      ['2026-05-02', 1],
      ['2026-05-02', 2],
      ['2026-05-04', 3],
      ['2026-05-04', 4],
    ]);
  });

  it('keeps a marked cardio set and gives it its position', () => {
    const res = parseStrongCsv(
      csv(
        '2026-05-02,Cardio,Rowing,W,0,0,500,120',
        '2026-05-02,Cardio,Rowing,1,0,0,2000,480',
      ),
    );
    expect(res.errors).toEqual([]);
    expect(res.rows).toMatchObject([
      { setOrder: 1, durationSec: 120, distanceM: 500, isWarmup: true },
      { setOrder: 2, durationSec: 480, distanceM: 2000 },
    ]);
  });

  it('still reports a damaged marked set and an unknown marker as line errors', () => {
    const res = parseStrongCsv(
      csv(
        '2026-05-02,Push,Bench,W,40,,0,0', // line 2: warm-up with no reps
        '2026-05-02,Push,Bench,X,80,8,0,0', // line 3: not a known marker
        '2026-05-02,Push,Bench,,80,8,0,0', // line 4: empty set order
        '2026-05-02,Push,Bench,F,80,5,0,0', // line 5: fine
      ),
    );
    expect(res.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(res.nonSetSkipped).toBe(0);
    // Positions count the accepted sets only.
    expect(res.rows.map((r) => r.setOrder)).toEqual([1]);
  });

  it('reports the sets beyond 50 of a marked exercise as line errors, in file order', () => {
    const lines = ['not-a-date,Push,Bench,1,80,8,0,0']; // line 2
    lines.push('2026-05-02,Push,Bench,W,40,10,0,0'); // line 3
    for (let i = 1; i <= 51; i++) lines.push(`2026-05-02,Push,Bench,${i},80,8,0,0`);
    const res = parseStrongCsv(csv(...lines));
    // 52 sets: the warm-up and 49 numbered ones fit. Line 53 (number 50) is
    // the 51st set; line 54 (number 51) is already out of the file's bound.
    expect(res.rows).toHaveLength(50);
    expect(res.rows.at(-1)?.setOrder).toBe(50);
    expect(res.errors.map((e) => e.line)).toEqual([2, 53, 54]);
  });

  it('gives a plain numeric file exactly the result it had before', () => {
    const res = parseStrongCsv(
      csv(
        '2026-05-02 09:13:00,Push Day,Bench Press (Barbell),1,80,8,0,0',
        '2026-05-02 09:13:00,Push Day,Bench Press (Barbell),3,80,7,0,0',
        '2026-05-02 09:13:00,Push Day,Bench Press (Barbell),2,82.5,6,0,0',
        '2026-05-02,Cardio,Running,1,0,0,5000,1800',
        '2026-05-02,Push,Bench,one,80,8,0,0',
      ),
    );
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]?.line).toBe(6);
    expect(res.errors[0]?.reason).toMatch(/^setOrder: /);
    // toStrictEqual: no extra key (not even an undefined one) on any row, and
    // the numbers of the file are kept as written, gaps and order included.
    expect({ ...res, errors: [] }).toStrictEqual({
      ok: true,
      fatalError: null,
      rows: [
        {
          dateKey: '2026-05-02',
          workoutName: 'Push Day',
          exerciseName: 'Bench Press (Barbell)',
          setOrder: 1,
          weightKg: 80,
          reps: 8,
        },
        {
          dateKey: '2026-05-02',
          workoutName: 'Push Day',
          exerciseName: 'Bench Press (Barbell)',
          setOrder: 3,
          weightKg: 80,
          reps: 7,
        },
        {
          dateKey: '2026-05-02',
          workoutName: 'Push Day',
          exerciseName: 'Bench Press (Barbell)',
          setOrder: 2,
          weightKg: 82.5,
          reps: 6,
        },
        {
          dateKey: '2026-05-02',
          workoutName: 'Cardio',
          exerciseName: 'Running',
          setOrder: 1,
          weightKg: 0,
          reps: 1,
          durationSec: 1800,
          distanceM: 5000,
        },
      ],
      errors: [],
      cardioSkipped: 0,
      nonSetSkipped: 0,
    });
  });
});
