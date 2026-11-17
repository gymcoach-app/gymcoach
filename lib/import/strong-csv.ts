import { z } from 'zod';
import type { WeightUnit } from '@/lib/prisma-client';
import { MAX_DISTANCE_M, MAX_DURATION_SEC, MILES_TO_METERS } from '@/lib/cardio';
import { lbToKg, roundWeight } from '@/lib/units';
import {
  asNumber,
  headerKey,
  IMPORT_CSV_MAX_BYTES,
  IMPORT_CSV_MAX_ROWS,
  readCsvRecords,
} from '@/lib/import/csv';

// ============================================================
// Strong app CSV export parser (issue #100) - pure, no DB
// ============================================================
// CSV text in, normalized rows out. The file content is UNTRUSTED user data:
// no eval, hard size and row caps, and every value Zod-validated before it is
// allowed out of this module. Bad lines are collected as per-line errors
// instead of failing the whole file; only an unrecognized header or a blown
// cap is fatal.

// Hard caps on the untrusted input (shared across import formats).
export const STRONG_CSV_MAX_BYTES = IMPORT_CSV_MAX_BYTES;
export const STRONG_CSV_MAX_ROWS = IMPORT_CSV_MAX_ROWS;

// One normalized working-set row. Weight is in kg, like everything stored.
export interface StrongCsvRow {
  // The session day, as 'YYYY-MM-DD' (Strong's export has no reliable times).
  dateKey: string;
  workoutName: string;
  exerciseName: string;
  setOrder: number;
  weightKg: number;
  reps: number;
  // Cardio rows (issue #134): duration in seconds, optional distance in
  // meters (the #133 set model). Absent on strength rows.
  durationSec?: number;
  distanceM?: number | null;
  // Set markers (issue #571): present (true) only on a row whose Set Order
  // cell is 'W' (warm-up) or 'D' (drop set). Absent on every other row, so a
  // plain numeric file produces the same rows as before.
  isWarmup?: boolean;
  isDropSet?: boolean;
}

export interface StrongCsvLineError {
  // 1-based line number in the file (header is line 1).
  line: number;
  reason: string;
}

export interface StrongCsvParseResult {
  // False when the file as a whole is unusable (bad header, cap exceeded).
  ok: boolean;
  fatalError: string | null;
  rows: StrongCsvRow[];
  errors: StrongCsvLineError[];
  // Cardio rows that still cannot be represented (issue #134: zero/negative
  // or out-of-bounds duration), skipped with a counted notice. Representable
  // cardio rows are imported as duration/distance sets since #133.
  cardioSkipped: number;
  // Rows that are not sets at all (issue #571): Strong's 'Rest Timer' and
  // 'Note' rows, skipped with a count instead of a per-line error.
  nonSetSkipped: number;
}

// The 1..50 bound on a set's order, shared by the Zod schemas below and by
// the renumbering of an exercise that carries a letter marker.
const MAX_SET_ORDER = 50;

// ------------------------------------------------------------
// What the Set Order cell says about a row (issue #571)
// ------------------------------------------------------------
// Strong writes more than integers in Set Order:
// - 'W' (warm-up), 'F' (failure) and, in some versions, 'D' (drop set) on a
//   real set, in place of its number;
// - 'Rest Timer' and 'Note' on rows that are not sets: a rest timer row
//   carries the rest length in Seconds, a note row carries its text in Notes.
//
// The rule: the Set Order cell ALONE decides the kind of row (trimmed, case
// and inner spacing ignored). Empty weight and reps are deliberately not used
// as a signal: a rest timer row has Seconds > 0 and no reps, exactly the
// shape of a cardio set, so it would be imported as a bogus cardio set of the
// exercise it follows; and a real set with a blank Reps cell is a damaged
// line the user should see as an error, not have silently dropped. Anything
// else in the cell goes to Zod as before: an integer is kept, garbage (or a
// marker this parser does not know) stays a per-line error.
type SetOrderCell =
  | { kind: 'number' }
  | { kind: 'marker'; marker: 'W' | 'F' | 'D' }
  | { kind: 'not-a-set' };

function readSetOrderCell(cell: string | undefined): SetOrderCell {
  switch (headerKey(cell ?? '')) {
    case 'w':
      return { kind: 'marker', marker: 'W' };
    case 'f':
      return { kind: 'marker', marker: 'F' };
    case 'd':
      return { kind: 'marker', marker: 'D' };
    case 'rest timer':
    case 'note':
      return { kind: 'not-a-set' };
    default:
      return { kind: 'number' };
  }
}

// Bounds mirror lib/schemas/set.ts so imported sets satisfy the same contract
// as manually logged ones.
const rowSchema = z.object({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  workoutName: z.string().trim().min(1).max(200),
  exerciseName: z.string().trim().min(1).max(120),
  setOrder: z.coerce.number().int().min(1).max(MAX_SET_ORDER),
  weightKg: z.coerce.number().min(0).max(500),
  reps: z.coerce.number().int().min(1).max(100),
});

// Cardio rows (issue #134): same identity fields, plus the #133 set bounds
// on duration/distance. weight/reps are forced to the cardio convention.
const cardioRowSchema = z.object({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  workoutName: z.string().trim().min(1).max(200),
  exerciseName: z.string().trim().min(1).max(120),
  setOrder: z.coerce.number().int().min(1).max(MAX_SET_ORDER),
  durationSec: z.number().int().min(1).max(MAX_DURATION_SEC),
  distanceM: z.number().min(0).max(MAX_DISTANCE_M).nullable(),
});

interface HeaderMap {
  date: number;
  workoutName: number;
  exerciseName: number;
  setOrder: number;
  weight: number;
  reps: number;
  distance: number | null;
  seconds: number | null;
  // Unit forced by the header itself ("Weight (kg)" / "Weight (lbs)"), if any.
  forcedUnit: WeightUnit | null;
}

// Recognize Strong's export header (with minor variants: extra columns are
// fine, order does not matter, a unit suffix on Weight is honored).
function mapHeader(cells: string[]): HeaderMap | null {
  const keys = cells.map(headerKey);
  const find = (...names: string[]) => {
    for (const name of names) {
      const idx = keys.indexOf(name);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const date = find('date');
  const workoutName = find('workout name');
  const exerciseName = find('exercise name');
  const setOrder = find('set order');
  const reps = find('reps');
  let forcedUnit: WeightUnit | null = null;
  let weight = find('weight');
  if (weight === -1) {
    weight = find('weight (kg)');
    if (weight !== -1) forcedUnit = 'KG';
  }
  if (weight === -1) {
    weight = find('weight (lbs)', 'weight (lb)');
    if (weight !== -1) forcedUnit = 'LB';
  }

  if (
    date === -1 ||
    workoutName === -1 ||
    exerciseName === -1 ||
    setOrder === -1 ||
    weight === -1 ||
    reps === -1
  ) {
    return null;
  }
  const distance = find('distance');
  const seconds = find('seconds', 'duration (sec)');
  return {
    date,
    workoutName,
    exerciseName,
    setOrder,
    weight,
    reps,
    distance: distance === -1 ? null : distance,
    seconds: seconds === -1 ? null : seconds,
    forcedUnit,
  };
}

// 'YYYY-MM-DD' day key from Strong's date cell ('YYYY-MM-DD HH:MM:SS' or just
// the date). Returns null when the cell is not a real calendar date.
function toDateKey(cell: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})([ T].*)?$/.exec(cell.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(mo) - 1 ||
    date.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}

// Parse a Strong CSV export. `unit` is the unit the Strong app was set to
// (user-chosen toggle, default kg); a unit suffix in the header overrides it.
export function parseStrongCsv(
  text: string,
  unit: WeightUnit = 'KG',
): StrongCsvParseResult {
  const fail = (fatalError: string): StrongCsvParseResult => ({
    ok: false,
    fatalError,
    rows: [],
    errors: [],
    cardioSkipped: 0,
    nonSetSkipped: 0,
  });

  if (text.length > STRONG_CSV_MAX_BYTES) {
    return fail('File too large: the limit is 5 MB.');
  }

  const records = readCsvRecords(text);
  const header = records[0];
  if (!header) return fail('Empty file.');
  const map = mapHeader(header.fields);
  if (!map) {
    return fail(
      'Unrecognized format: expected a Strong CSV export with the columns ' +
        'Date, Workout Name, Exercise Name, Set Order, Weight, Reps.',
    );
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length > STRONG_CSV_MAX_ROWS) {
    return fail(
      `Too many rows: ${dataRecords.length} (the limit is ${STRONG_CSV_MAX_ROWS}). Split the export and import in parts.`,
    );
  }

  const effectiveUnit = map.forcedUnit ?? unit;
  const rows: StrongCsvRow[] = [];
  const errors: StrongCsvLineError[] = [];
  let cardioSkipped = 0;
  let nonSetSkipped = 0;
  // Parallel to `rows`: the file line of each accepted row and whether its
  // Set Order was a letter marker, for the renumbering pass below.
  const rowLines: number[] = [];
  const rowHasMarker: boolean[] = [];

  for (const record of dataRecords) {
    const get = (idx: number | null) =>
      idx === null ? undefined : record.fields[idx];

    // Rest Timer / Note rows are not sets: counted and skipped before any
    // other check, so they neither fail the line nor reach the cardio branch.
    const setOrderCell = readSetOrderCell(get(map.setOrder));
    if (setOrderCell.kind === 'not-a-set') {
      nonSetSkipped++;
      continue;
    }
    // A letter marker has no number of its own: it validates with a
    // placeholder and gets its real order from its position (pass below).
    const hasMarker = setOrderCell.kind === 'marker';
    const setOrderInput = hasMarker ? 1 : get(map.setOrder);
    // W maps to the Set model's warm-up flag, D to its drop-set flag. The
    // model has no failure notion, so F is imported as a normal set.
    const markerFlags =
      setOrderCell.kind === 'marker' && setOrderCell.marker === 'W'
        ? { isWarmup: true }
        : setOrderCell.kind === 'marker' && setOrderCell.marker === 'D'
          ? { isDropSet: true }
          : {};
    const accept = (row: StrongCsvRow) => {
      rows.push({ ...row, ...markerFlags });
      rowLines.push(record.line);
      rowHasMarker.push(hasMarker);
    };

    const dateKey = toDateKey(get(map.date) ?? '');
    if (!dateKey) {
      errors.push({ line: record.line, reason: 'Invalid or missing date.' });
      continue;
    }

    const reps = asNumber(get(map.reps));
    const weightRaw = asNumber(get(map.weight));
    const distance = asNumber(get(map.distance));
    const seconds = asNumber(get(map.seconds));

    // Cardio / duration-only rows (no reps, but distance or time) become
    // duration/distance sets (issue #134). The qualifying condition is
    // exactly the pre-#134 skip branch; only what happens to the row changed.
    // Strong's Distance follows the export's unit setting: meters when the
    // app is metric (kg), miles when imperial (lbs).
    if (!(reps >= 1) && (distance > 0 || seconds > 0)) {
      // A representable cardio set needs a duration (the #133 model); a
      // distance-only or out-of-bounds row stays a counted skip notice.
      if (!(seconds >= 1) || seconds > MAX_DURATION_SEC) {
        cardioSkipped++;
        continue;
      }
      const distanceM =
        distance > 0
          ? +(effectiveUnit === 'LB' ? distance * MILES_TO_METERS : distance).toFixed(2)
          : null;
      if (distanceM !== null && distanceM > MAX_DISTANCE_M) {
        cardioSkipped++;
        continue;
      }
      const cardioParsed = cardioRowSchema.safeParse({
        dateKey,
        workoutName: get(map.workoutName) ?? '',
        exerciseName: get(map.exerciseName) ?? '',
        setOrder: setOrderInput,
        durationSec: Math.round(seconds),
        distanceM,
      });
      if (!cardioParsed.success) {
        const issue = cardioParsed.error.issues[0];
        errors.push({
          line: record.line,
          reason: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid row.',
        });
        continue;
      }
      accept({ ...cardioParsed.data, weightKg: 0, reps: 1 });
      continue;
    }

    const weightKg =
      effectiveUnit === 'LB' ? roundWeight(lbToKg(weightRaw), 2) : weightRaw;

    const parsed = rowSchema.safeParse({
      dateKey,
      workoutName: get(map.workoutName) ?? '',
      exerciseName: get(map.exerciseName) ?? '',
      setOrder: setOrderInput,
      weightKg,
      reps,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({
        line: record.line,
        reason: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid row.',
      });
      continue;
    }
    accept(parsed.data);
  }

  if (!rowHasMarker.includes(true)) {
    return { ok: true, fatalError: null, rows, errors, cardioSkipped, nonSetSkipped };
  }

  // Renumbering pass (issue #571), only reached when the file has a letter
  // marker. Strong numbers the working sets of an exercise on their own
  // (W, W, 1, 2, 3), so giving a number to the marked rows alone would
  // collide with the numbered ones: two sets with order 1, displayed in the
  // wrong sequence, and collapsed as duplicates when weight and reps match.
  // So every exercise of a workout (same day, workout name and exercise) that
  // carries at least one marker is renumbered 1..n in file order, which keeps
  // each set at the position it has in the export. An exercise without a
  // marker keeps the numbers of the file untouched.
  const groupKey = (row: StrongCsvRow) =>
    `${row.dateKey}\u0000${row.workoutName}\u0000${row.exerciseName.toLowerCase()}`;
  const markedGroups = new Set<string>();
  rows.forEach((row, i) => {
    if (rowHasMarker[i]) markedGroups.add(groupKey(row));
  });
  const nextOrder = new Map<string, number>();
  const kept: StrongCsvRow[] = [];
  rows.forEach((row, i) => {
    const key = groupKey(row);
    if (!markedGroups.has(key)) {
      kept.push(row);
      return;
    }
    const order = (nextOrder.get(key) ?? 0) + 1;
    nextOrder.set(key, order);
    if (order > MAX_SET_ORDER) {
      errors.push({
        line: rowLines[i]!,
        reason: `setOrder: more than ${MAX_SET_ORDER} sets for one exercise in a workout.`,
      });
      return;
    }
    kept.push({ ...row, setOrder: order });
  });
  // Errors found by this pass come after the per-line ones: back to file order.
  errors.sort((a, b) => a.line - b.line);

  return { ok: true, fatalError: null, rows: kept, errors, cardioSkipped, nonSetSkipped };
}
