// CSV field escaping for the history export.
//
// Two concerns, both required:
// - RFC 4180: quote any field containing , " \n or \r, doubling inner quotes.
// - Formula injection: a field starting with = + - @ tab or CR executes as a
//   formula/DDE when the exported file is opened in Excel or LibreOffice.
//   Field values can be third-party-authored (a bulk import can plant
//   exercise names and notes), so leading formula characters are neutralized
//   with a single-quote prefix, the spreadsheet convention for "literal text".
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

// Column order of the history export (app/api/history/csv/route.ts).
// Downstream scripts key on column positions, so the order is a contract:
// only append new columns at the end (pinned by lib/csv.test.ts).
export const HISTORY_CSV_HEADERS = [
  'session_id',
  'session_date',
  'session_started_at',
  'session_finished_at',
  'duration_min',
  'program',
  'workout',
  'exercise',
  'muscle_group',
  'uses_bodyweight',
  'set_number',
  'external_load_kg', // entered value (added weight for bodyweight exercises, total load otherwise)
  'effective_weight_kg', // = bodyweight + external for bodyweight exercises, otherwise = external
  'reps',
  'rir',
  'is_warmup',
  'is_drop_set',
  'volume_kg', // based on effective weight
  'estimated_1rm_kg', // based on effective weight
  'set_notes',
  'duration_sec', // cardio sets only (raw seconds); empty on strength sets
  'distance_m', // cardio sets only (raw meters); empty on strength sets
  'avg_hr', // cardio sets only (bpm); empty on strength sets and cardio without HR
  'max_hr', // cardio sets only (bpm); empty on strength sets and cardio without HR
  'block', // 0-based block of a deliberately repeated exercise (issue #475); empty otherwise
] as const;

export function csvEscape(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
