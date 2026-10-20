import { z } from 'zod';
import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  MAX_HR_MAX,
  MAX_HR_MIN,
} from '@/lib/cardio';
import {
  asNumber,
  headerKey,
  IMPORT_CSV_MAX_BYTES,
  IMPORT_CSV_MAX_ROWS,
  readCsvRecords,
  type CsvLineError,
} from '@/lib/import/csv';
import { MAX_EXERCISE_BLOCK } from '@/lib/exercise-blocks';
import type { NormalizedImportRow } from '@/lib/import/strong-import';

// ============================================================
// GymCoach native CSV import parser (issue #270) - pure, no DB
// ============================================================
// The symmetric inverse of the history CSV export (lib/csv.ts +
// app/api/history/csv/route.ts): the same column names in, normalized rows
// out. A user can re-import GymCoach's own export, or bulk-load a spreadsheet
// that uses the same columns. Mirrors lib/import/strong-csv.ts and
// lib/import/hevy-csv.ts: the file content is UNTRUSTED user data - no eval,
// the same hard size and row caps, every value Zod-validated before it leaves
// this module. Bad lines become per-line errors; only an unrecognized header
// or a blown cap is fatal.
//
// Column contract (HISTORY_CSV_HEADERS in lib/csv.ts):
// - Required: session_date, exercise, set_number, external_load_kg, reps.
// - Honored when present: session_id (keeps two same-day sessions separate),
//   session_started_at / session_finished_at (real times), workout, rir,
//   is_warmup, is_drop_set, set_notes, duration_sec, distance_m, avg_hr,
//   max_hr, block (issue #475; an older export without the column reads as
//   no block, which is what it meant).
// - Ignored (derived on export, recomputed after import): duration_min,
//   program, muscle_group, uses_bodyweight, effective_weight_kg, volume_kg,
//   estimated_1rm_kg.

export const GYMCOACH_CSV_MAX_BYTES = IMPORT_CSV_MAX_BYTES;
export const GYMCOACH_CSV_MAX_ROWS = IMPORT_CSV_MAX_ROWS;

// One normalized row: the shared NormalizedImportRow with the GymCoach
// extras always present.
export interface GymcoachCsvRow extends NormalizedImportRow {
  isWarmup: boolean;
  isDropSet: boolean;
  rir: number | null;
  notes: string | null;
  avgHr: number | null;
  maxHr: number | null;
  startedAtIso: string | null;
  finishedAtIso: string | null;
  block: number | null;
}

export interface GymcoachCsvParseResult {
  // False when the file as a whole is unusable (bad header, cap exceeded).
  ok: boolean;
  fatalError: string | null;
  rows: GymcoachCsvRow[];
  errors: CsvLineError[];
}

// Bounds mirror lib/schemas/set.ts so imported sets satisfy the same contract
// as manually logged ones. Unlike the Strong/Hevy parsers, reps 0 is allowed:
// the native set schema allows it, so the export can contain it.
const strengthSchema = z.object({
  weightKg: z.number().min(0).max(500),
  reps: z.number().int().min(0).max(100),
});

const cardioSchema = z.object({
  weightKg: z.number().min(0).max(500),
  reps: z.number().int().min(0).max(100),
  durationSec: z.number().int().min(1).max(MAX_DURATION_SEC),
  distanceM: z.number().min(0).max(MAX_DISTANCE_M).nullable(),
  avgHr: z.number().int().min(AVG_HR_MIN).max(AVG_HR_MAX).nullable(),
  maxHr: z.number().int().min(MAX_HR_MIN).max(MAX_HR_MAX).nullable(),
});

const commonSchema = z.object({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  workoutName: z.string().trim().min(1).max(200),
  exerciseName: z.string().trim().min(1).max(120),
  setOrder: z.number().int().min(1).max(50),
  // Same bound as lib/schemas/set.ts.
  block: z.number().int().min(0).max(MAX_EXERCISE_BLOCK).nullable(),
  rir: z.number().int().min(0).max(5).nullable(),
  notes: z.string().trim().max(500).nullable(),
});

interface HeaderMap {
  sessionId: number | null;
  sessionDate: number;
  startedAt: number | null;
  finishedAt: number | null;
  workout: number | null;
  exercise: number;
  setNumber: number;
  weight: number;
  reps: number;
  rir: number | null;
  isWarmup: number | null;
  isDropSet: number | null;
  notes: number | null;
  durationSec: number | null;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  block: number | null;
}

// Recognize the GymCoach export header (extra columns are fine, order does
// not matter). The names are the HISTORY_CSV_HEADERS contract.
function mapHeader(cells: string[]): HeaderMap | null {
  const keys = cells.map(headerKey);
  const find = (name: string) => {
    const idx = keys.indexOf(name);
    return idx === -1 ? null : idx;
  };

  const sessionDate = find('session_date');
  const exercise = find('exercise');
  const setNumber = find('set_number');
  const weight = find('external_load_kg');
  const reps = find('reps');
  if (
    sessionDate === null ||
    exercise === null ||
    setNumber === null ||
    weight === null ||
    reps === null
  ) {
    return null;
  }
  return {
    sessionId: find('session_id'),
    sessionDate,
    startedAt: find('session_started_at'),
    finishedAt: find('session_finished_at'),
    workout: find('workout'),
    exercise,
    setNumber,
    weight,
    reps,
    rir: find('rir'),
    isWarmup: find('is_warmup'),
    isDropSet: find('is_drop_set'),
    notes: find('set_notes'),
    durationSec: find('duration_sec'),
    distanceM: find('distance_m'),
    avgHr: find('avg_hr'),
    maxHr: find('max_hr'),
    block: find('block'),
  };
}

// Inverse of the export's formula-injection neutralization (lib/csv.ts):
// csvEscape prefixes a leading = + - @ tab or CR with a single quote so the
// cell reads as literal text in a spreadsheet. Stripping that prefix here
// makes export -> import a true round-trip; the raw value is stored, and the
// next export neutralizes it again. Values that do not carry the marker are
// untouched.
export function stripFormulaGuard(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

// 'YYYY-MM-DD' day key; a time suffix is tolerated. Returns null when the
// cell is not a real calendar date.
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

// The export writes full ISO instants (2026-05-02T09:13:00.000Z). Accept an
// ISO-like date-time; anything else degrades to null (noon-UTC fallback),
// like Hevy's optional end_time. A hand-edited zoneless value (no Z or
// offset) is read as UTC - the same wall-clock-as-UTC convention as the Hevy
// parser - never as server-local time.
function toIso(cell: string | undefined): string | null {
  let trimmed = (cell ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed)) return null;
  trimmed = trimmed.replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) trimmed += 'Z';
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// The export writes 'true' / 'false'; hand-edited spreadsheets get a little
// slack. Anything unrecognized reads as false.
function toBool(cell: string | undefined): boolean {
  const key = (cell ?? '').trim().toLowerCase();
  return key === 'true' || key === '1' || key === 'yes';
}

// Empty/absent optional numeric cell reads as null; garbage as NaN so Zod
// rejects it with a per-line error.
function asOptionalNumber(cell: string | undefined): number | null {
  if (cell === undefined || cell.trim() === '') return null;
  return asNumber(cell);
}

const firstIssue = (error: z.ZodError): string => {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid row.';
};

// Parse a GymCoach history CSV. Weight is already kg (the export's storage
// unit), so there is no unit toggle.
export function parseGymcoachCsv(text: string): GymcoachCsvParseResult {
  const fail = (fatalError: string): GymcoachCsvParseResult => ({
    ok: false,
    fatalError,
    rows: [],
    errors: [],
  });

  if (text.length > GYMCOACH_CSV_MAX_BYTES) {
    return fail('File too large: the limit is 5 MB.');
  }

  // The export prepends a UTF-8 BOM for Excel; drop it before the header read.
  const records = readCsvRecords(text.replace(/^﻿/, ''));
  const header = records[0];
  if (!header) return fail('Empty file.');
  const map = mapHeader(header.fields);
  if (!map) {
    return fail(
      'Unrecognized format: expected a GymCoach history CSV with the columns ' +
        'session_date, exercise, set_number, external_load_kg, reps.',
    );
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length > GYMCOACH_CSV_MAX_ROWS) {
    return fail(
      `Too many rows: ${dataRecords.length} (the limit is ${GYMCOACH_CSV_MAX_ROWS}). Split the export and import in parts.`,
    );
  }

  const rows: GymcoachCsvRow[] = [];
  const errors: CsvLineError[] = [];

  for (const record of dataRecords) {
    const get = (idx: number | null) =>
      idx === null ? undefined : record.fields[idx];

    const dateKey = toDateKey(get(map.sessionDate) ?? '');
    if (!dateKey) {
      errors.push({ line: record.line, reason: 'Invalid or missing session_date.' });
      continue;
    }

    const notesRaw = stripFormulaGuard(get(map.notes) ?? '').trim();
    const common = commonSchema.safeParse({
      dateKey,
      // An export of a free session has an empty workout cell; the honest
      // grouping label mirrors the export's own granularity.
      workoutName: stripFormulaGuard(get(map.workout) ?? '').trim() || 'Workout',
      exerciseName: stripFormulaGuard(get(map.exercise) ?? '').trim(),
      setOrder: asNumber(get(map.setNumber)),
      block: asOptionalNumber(get(map.block)),
      rir: asOptionalNumber(get(map.rir)),
      notes: notesRaw === '' ? null : notesRaw,
    });
    if (!common.success) {
      errors.push({ line: record.line, reason: firstIssue(common.error) });
      continue;
    }

    const durationSec = asOptionalNumber(get(map.durationSec));
    const avgHr = asOptionalNumber(get(map.avgHr));
    const maxHr = asOptionalNumber(get(map.maxHr));

    const base = {
      ...common.data,
      isWarmup: toBool(get(map.isWarmup)),
      isDropSet: toBool(get(map.isDropSet)),
      startedAtIso: toIso(get(map.startedAt)),
      finishedAtIso: toIso(get(map.finishedAt)),
      // session_id keeps two same-day sessions with the same workout name
      // apart; it is only a grouping key, never stored.
      ...(get(map.sessionId)?.trim()
        ? { sessionKey: `id:${get(map.sessionId)!.trim().slice(0, 100)}` }
        : {}),
    };

    // A non-empty duration_sec marks a cardio set (the export writes it on
    // cardio sets only); duration/distance/HR then follow the #133 bounds.
    if (durationSec !== null) {
      const repsCell = asOptionalNumber(get(map.reps));
      const cardio = cardioSchema.safeParse({
        weightKg: asNumber(get(map.weight)),
        // Imported cardio sets are stored as reps 1 by convention; an
        // explicit value in the file is validated and kept.
        reps: repsCell === null ? 1 : repsCell,
        durationSec,
        distanceM: asOptionalNumber(get(map.distanceM)),
        avgHr,
        maxHr,
      });
      if (!cardio.success) {
        errors.push({ line: record.line, reason: firstIssue(cardio.error) });
        continue;
      }
      rows.push({ ...base, ...cardio.data });
      continue;
    }

    // Strength row: duration/distance must stay empty, and heart rate is a
    // cardio-only signal (lib/schemas/set.ts) - reject instead of silently
    // dropping data.
    if (asOptionalNumber(get(map.distanceM)) !== null) {
      errors.push({
        line: record.line,
        reason: 'distance_m requires a cardio row (non-empty duration_sec).',
      });
      continue;
    }
    if (avgHr !== null || maxHr !== null) {
      errors.push({
        line: record.line,
        reason: 'avg_hr/max_hr require a cardio row (non-empty duration_sec).',
      });
      continue;
    }

    const strength = strengthSchema.safeParse({
      weightKg: asNumber(get(map.weight)),
      reps: asNumber(get(map.reps)),
    });
    if (!strength.success) {
      errors.push({ line: record.line, reason: firstIssue(strength.error) });
      continue;
    }

    rows.push({
      ...base,
      ...strength.data,
      durationSec: null,
      distanceM: null,
      avgHr: null,
      maxHr: null,
    });
  }

  return { ok: true, fatalError: null, rows, errors };
}
