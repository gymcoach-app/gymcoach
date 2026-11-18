import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  MAX_HR_MAX,
  MAX_HR_MIN,
  MILES_TO_METERS,
} from '@/lib/cardio';
import { IMPORT_DUPLICATE_WINDOW_MS } from '@/lib/import/duplicate-window';
import { lbToKg } from '@/lib/units';

// ============================================================
// Apple Health export scanner (issue #582) - pure, no DB, no DOM
// ============================================================
// The Health app exports one export.xml that can weigh hundreds of MB and
// holds millions of <Record/> lines. It is read in the browser as a stream and
// never loaded whole: this module is the small tolerant scanner the stream is
// fed into. It keeps only what the import needs:
//
// - <Workout> elements (activity type, start, duration, distance, and the
//   nested <WorkoutStatistics> for heart rate and distance), and
// - <Record type="HKQuantityTypeIdentifierBodyMass"> (body weight).
//
// Every other element is skipped without being buffered. The scanner is not an
// XML parser: it never resolves a DTD or a custom entity (only the five
// predefined entities and numeric character references are decoded in the
// attribute values it reads), so a hostile file has nothing to expand. Every
// value that leaves this module is range-checked with the bounds of the cardio
// set contract (lib/cardio.ts), and the server re-validates all of it.

// Bodyweight bounds in kg. Same values as lib/schemas/bodyweight.ts, repeated
// here so the browser bundle of the scanner does not pull Zod in.
const BODY_MASS_MIN_KG = 20;
const BODY_MASS_MAX_KG = 300;
const KG_PER_STONE = 6.35029318;

// Sane window for a workout start, same as the FIT/TCX/GPX imports: nothing
// before consumer wearables existed, nothing past tomorrow.
export const APPLE_HEALTH_MIN_DATE = new Date('2000-01-01T00:00:00.000Z');
export const APPLE_HEALTH_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

// A tag longer than this is not one of ours (a real Workout or Record tag is a
// few hundred characters): the scanner stops waiting for its end and moves on,
// so a broken file cannot make it buffer without bound.
const MAX_TAG_CHARS = 64 * 1024;

// The scanner works through its input in slices of at most this many bytes
// (or characters, for text), whatever the size of the chunk it is handed: one
// huge chunk (a deflate stream can turn 64 KB into tens of MB) is then never
// decoded into one string, and the scan buffer stays under one slice plus one
// pending tag.
export const APPLE_HEALTH_SCAN_SLICE = 256 * 1024;

// Hard caps on what one file can yield (memory bound in the browser). Twenty
// thousand workouts is ten a day for five years.
export const APPLE_HEALTH_MAX_WORKOUTS = 20_000;
const MAX_BODY_MASS_DAYS = 20_000;

const ACTIVITY_PREFIX = 'HKWorkoutActivityType';

// Strength-type workouts are skipped (with a count): an Apple Health workout
// has no exercises, sets or loads, and GymCoach logs strength per set, so an
// empty "strength" shell would only pollute the history. High-intensity
// interval training is NOT in this list: it is a timed, heart-rate driven
// conditioning effort, so it imports as generic cardio.
const STRENGTH_TYPES: ReadonlySet<string> = new Set([
  'TraditionalStrengthTraining',
  'FunctionalStrengthTraining',
  'CoreTraining',
]);

// The exercise each activity type is logged under. 'Running' and 'Cycling' are
// the names the FIT/TCX/GPX imports use and 'Rowing machine' and 'Jump rope'
// are the built-in catalog entries, so an import lands on the user's existing
// exercises. Everything not listed goes to the same generic exercise as a FIT
// activity of an unknown sport.
export const APPLE_HEALTH_GENERIC_EXERCISE = 'Cardio (imported)';
const EXERCISE_BY_TYPE: Readonly<Record<string, string>> = {
  Running: 'Running',
  Walking: 'Walking',
  Hiking: 'Hiking',
  Cycling: 'Cycling',
  HandCycling: 'Cycling',
  Swimming: 'Swimming',
  Rowing: 'Rowing machine',
  Elliptical: 'Elliptical',
  StairClimbing: 'Stair climbing',
  Stairs: 'Stair climbing',
  JumpRope: 'Jump rope',
};

// 'HKWorkoutActivityTypeRunning' -> 'Running'. Returns null when the value is
// not a plausible activity type (the server schema applies the same shape).
export function appleHealthActivityType(raw: string | undefined): string | null {
  if (!raw) return null;
  const type = raw.startsWith(ACTIVITY_PREFIX) ? raw.slice(ACTIVITY_PREFIX.length) : raw;
  return /^[A-Za-z0-9]{1,60}$/.test(type) ? type : null;
}

export function isAppleHealthStrengthType(type: string): boolean {
  return STRENGTH_TYPES.has(type);
}

// The cardio exercise name for a (prefix-less) activity type.
export function appleHealthExerciseName(type: string): string {
  return Object.hasOwn(EXERCISE_BY_TYPE, type)
    ? EXERCISE_BY_TYPE[type]!
    : APPLE_HEALTH_GENERIC_EXERCISE;
}

// Apple writes dates as '2024-03-05 07:12:44 +0100'. Also accepts the ISO
// spellings (T separator, colon in the offset, Z, fractional seconds). A date
// without an offset is refused: guessing a time zone would shift the session.
const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})$/;

// The widest UTC offsets in use are -12:00 and +14:00. The server refuses
// anything outside this range (lib/schemas/import.ts).
export const APPLE_HEALTH_MAX_UTC_OFFSET_MIN = 14 * 60;

// The instant a date string names, and the UTC offset it was written in
// (minutes east of UTC: '+0100' is 60, '-0500' is -300, 'Z' is 0). An offset
// no time zone uses reads as 0, so such an entry falls back to its UTC day.
function parseDateWithOffset(raw: string | undefined): { date: Date; utcOffsetMin: number } | null {
  if (!raw) return null;
  const m = DATE_RE.exec(raw.trim());
  if (!m) return null;
  const zone = m[7]!;
  const offset = zone === 'Z' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset}`);
  if (Number.isNaN(date.getTime())) return null;
  let utcOffsetMin = 0;
  if (zone !== 'Z') {
    const minutes = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2));
    if (minutes > 0 && minutes <= APPLE_HEALTH_MAX_UTC_OFFSET_MIN) {
      utcOffsetMin = zone[0] === '-' ? -minutes : minutes;
    }
  }
  return { date, utcOffsetMin };
}

export function parseAppleHealthDate(raw: string | undefined): Date | null {
  return parseDateWithOffset(raw)?.date ?? null;
}

function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const text = raw.trim();
  if (!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// Duration in seconds, or null for an unknown unit / unreadable value.
function toSeconds(value: number | null, unit: string | undefined): number | null {
  if (value === null) return null;
  switch ((unit ?? 'min').trim().toLowerCase()) {
    case 'min':
      return value * 60;
    case 's':
    case 'sec':
      return value;
    case 'hr':
    case 'h':
      return value * 3600;
    default:
      return null;
  }
}

// Distance in meters, or null for an unknown unit / unreadable value.
function toMeters(value: number | null, unit: string | undefined): number | null {
  if (value === null || unit === undefined) return null;
  switch (unit.trim().toLowerCase()) {
    case 'km':
      return value * 1000;
    case 'm':
      return value;
    case 'mi':
      return value * MILES_TO_METERS;
    case 'yd':
      return value * 0.9144;
    case 'ft':
      return value * 0.3048;
    case 'cm':
      return value / 100;
    default:
      return null;
  }
}

// Body mass in kg, or null for an unknown unit / unreadable value.
function toKilograms(value: number | null, unit: string | undefined): number | null {
  if (value === null || unit === undefined) return null;
  switch (unit.trim().toLowerCase()) {
    case 'kg':
      return value;
    case 'lb':
    case 'lbs':
      return lbToKg(value);
    case 'g':
      return value / 1000;
    case 'st':
      return value * KG_PER_STONE;
    default:
      return null;
  }
}

function heartRate(value: number | null, min: number, max: number): number | null {
  if (value === null) return null;
  const bpm = Math.round(value);
  return bpm >= min && bpm <= max ? bpm : null;
}

// The attributes of one <Workout> plus what its nested <WorkoutStatistics>
// carried, exactly as written in the file (strings, not yet trusted).
export interface RawAppleHealthWorkout {
  workoutActivityType?: string;
  startDate?: string;
  endDate?: string;
  duration?: string;
  durationUnit?: string;
  totalDistance?: string;
  totalDistanceUnit?: string;
  hrAverage?: string;
  hrMaximum?: string;
  statDistanceSum?: string;
  statDistanceUnit?: string;
}

// One cardio workout, normalized: what the client posts to the import route.
export interface AppleHealthWorkout {
  // Activity type without its HKWorkoutActivityType prefix, e.g. 'Running'.
  activityType: string;
  // ISO 8601 instant (UTC).
  startedAt: string;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
}

export type NormalizedWorkout =
  | { kind: 'cardio'; workout: AppleHealthWorkout }
  | { kind: 'strength' }
  | { kind: 'invalid' };

// Turn one raw workout into a bounded cardio activity. 'invalid' covers an
// unreadable type or start date, a start outside the sane window, and a
// duration that is missing or outside 1 s .. 24 h. A distance or heart rate
// outside its bounds only degrades to "absent", like the other importers.
export function normalizeAppleHealthWorkout(
  raw: RawAppleHealthWorkout,
  now: Date = new Date(),
): NormalizedWorkout {
  const activityType = appleHealthActivityType(raw.workoutActivityType);
  if (!activityType) return { kind: 'invalid' };
  if (isAppleHealthStrengthType(activityType)) return { kind: 'strength' };

  const start = parseAppleHealthDate(raw.startDate);
  if (
    !start ||
    start.getTime() < APPLE_HEALTH_MIN_DATE.getTime() ||
    start.getTime() > now.getTime() + APPLE_HEALTH_FUTURE_SLACK_MS
  ) {
    return { kind: 'invalid' };
  }

  let seconds = toSeconds(toNumber(raw.duration), raw.durationUnit);
  if (seconds === null || seconds <= 0) {
    const end = parseAppleHealthDate(raw.endDate);
    seconds = end ? (end.getTime() - start.getTime()) / 1000 : null;
  }
  if (seconds === null) return { kind: 'invalid' };
  const durationSec = Math.round(seconds);
  if (durationSec < 1 || durationSec > MAX_DURATION_SEC) return { kind: 'invalid' };

  let meters = toMeters(toNumber(raw.totalDistance), raw.totalDistanceUnit);
  if (meters === null || meters <= 0) {
    meters = toMeters(toNumber(raw.statDistanceSum), raw.statDistanceUnit);
  }
  const distanceM =
    meters !== null && meters > 0 && meters <= MAX_DISTANCE_M ? Math.round(meters) : null;

  return {
    kind: 'cardio',
    workout: {
      // A fresh copy: a substring of the scan buffer would keep that whole
      // chunk of the file alive for as long as the workout is.
      activityType: activityType.split('').join(''),
      startedAt: start.toISOString(),
      durationSec,
      distanceM: distanceM !== null && distanceM > 0 ? distanceM : null,
      avgHr: heartRate(toNumber(raw.hrAverage), AVG_HR_MIN, AVG_HR_MAX),
      maxHr: heartRate(toNumber(raw.hrMaximum), MAX_HR_MIN, MAX_HR_MAX),
    },
  };
}

// One body weight measurement, normalized to kg.
export interface AppleHealthBodyMass {
  // ISO 8601 instant (UTC).
  measuredAt: string;
  weightKg: number;
  // The UTC offset the export wrote this timestamp in, in minutes east of UTC.
  // It is what tells which calendar day the measurement was taken on, see
  // appleHealthLocalDayStart.
  utcOffsetMin: number;
}

// Returns null when the record is unreadable or outside the bodyweight bounds.
export function normalizeAppleHealthBodyMass(
  attrs: Record<string, string>,
  now: Date = new Date(),
): AppleHealthBodyMass | null {
  const parsed = parseDateWithOffset(attrs.startDate);
  if (
    !parsed ||
    parsed.date.getTime() < APPLE_HEALTH_MIN_DATE.getTime() ||
    parsed.date.getTime() > now.getTime() + APPLE_HEALTH_FUTURE_SLACK_MS
  ) {
    return null;
  }
  const kg = toKilograms(toNumber(attrs.value), attrs.unit);
  if (kg === null) return null;
  const weightKg = Math.round(kg * 100) / 100;
  if (weightKg < BODY_MASS_MIN_KG || weightKg > BODY_MASS_MAX_KG) return null;
  return { measuredAt: parsed.date.toISOString(), weightKg, utcOffsetMin: parsed.utcOffsetMin };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The "same day" rule of the body weight dedup, on the client and on the
// server: the calendar day is the entry's own local day, read in the UTC
// offset its Apple timestamp carries (the Health app writes the dates of an
// export with the offset of the phone), not the UTC day. A weigh-in at
// '2024-03-05 23:30:00 -0800' belongs to March 5th, although its UTC instant
// is on the 6th.
//
// Returns the instant (epoch ms) that local day starts at; the day is the 24
// hours from there. Another instant is on the same day as the entry when it
// falls in that range.
export function appleHealthLocalDayStart(atMs: number, utcOffsetMin: number): number {
  const offsetMs = utcOffsetMin * 60_000;
  return Math.floor((atMs + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
}

// The local calendar day of an entry as text ('2024-03-05').
export function appleHealthLocalDayKey(entry: {
  measuredAt: string | Date;
  utcOffsetMin: number;
}): string {
  const at =
    typeof entry.measuredAt === 'string' ? Date.parse(entry.measuredAt) : entry.measuredAt.getTime();
  return new Date(at + entry.utcOffsetMin * 60_000).toISOString().slice(0, 10);
}

// Drop the workouts that start within the duplicate window (2 minutes) of an
// earlier one of the same list: Apple Health often holds one effort twice,
// once from the watch and once from an app that synced it. This is the rule
// the server applies inside a batch (planWorkouts in the import route: oldest
// first, the first of a pair wins), applied here to the whole scan before it
// is cut into batches, so a pair that straddles two batches is counted as a
// duplicate in the preview too, and what is left never collides with itself
// at confirm.
export function dedupeAppleHealthWorkouts(workouts: readonly AppleHealthWorkout[]): {
  workouts: AppleHealthWorkout[];
  duplicates: number;
} {
  const sorted = [...workouts].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const kept: AppleHealthWorkout[] = [];
  let lastKept = Number.NEGATIVE_INFINITY;
  let duplicates = 0;
  for (const workout of sorted) {
    const at = Date.parse(workout.startedAt);
    if (at - lastKept <= IMPORT_DUPLICATE_WINDOW_MS) {
      duplicates += 1;
    } else {
      kept.push(workout);
      lastKept = at;
    }
  }
  return { workouts: kept, duplicates };
}

export interface AppleHealthScanResult {
  // Cardio workouts, oldest first.
  workouts: AppleHealthWorkout[];
  // Strength-type workouts left out on purpose.
  skippedStrength: number;
  // Workouts left out because the type, start or duration was unusable (or the
  // per-file cap was reached).
  skippedInvalid: number;
  // Body weight, one entry per local day (the last measurement of the day,
  // see appleHealthLocalDayStart), oldest first.
  bodyMass: AppleHealthBodyMass[];
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

// Decode the predefined XML entities and numeric character references of an
// attribute value. Anything else (a custom entity) is left as written.
export function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-z]{2,4});/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body]! : whole;
  });
}

const ATTR_RE = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

// The attributes of one start tag (the text between '<' and '>').
function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
  ATTR_RE.lastIndex = 0;
  for (let m = ATTR_RE.exec(tag); m !== null; m = ATTR_RE.exec(tag)) {
    attrs[m[1]!] = decodeXmlEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const CH_LT = 60; // <
const CH_GT = 62; // >
const CH_SLASH = 47; // /
const CH_BANG = 33; // !
const CH_DQUOTE = 34; // "
const CH_SQUOTE = 39; // '
const CH_UPPER_R = 82; // R
const CH_UPPER_W = 87; // W

// What findTagEnd answers when it finds no '>': the buffer ended first, or a
// '<' came first.
const TAG_UNFINISHED = -1;
const TAG_BROKEN = -2;

// True when `name` sits at `at` and is followed by a name boundary (so
// 'Workout' does not match 'WorkoutStatistics').
function nameAt(buf: string, at: number, name: string): boolean {
  if (!buf.startsWith(name, at)) return false;
  const c = buf.charCodeAt(at + name.length);
  return c === CH_GT || c === CH_SLASH || c === 32 || c === 9 || c === 10 || c === 13;
}

// The longest prefix the classifier has to see after a '<' before it can tell
// what the tag is ('</WorkoutActivity' plus its boundary character).
const LOOKAHEAD = 24;

// Streaming scanner. Feed it the file in chunks of any size (bytes or text;
// tags and multi-byte characters may be split anywhere), then call end().
export class AppleHealthScanner {
  private buf = '';
  private readonly decoder = new TextDecoder('utf-8');
  // Terminator of the comment or CDATA section being skipped, if any.
  private skipUntil: string | null = null;
  private current: RawAppleHealthWorkout | null = null;
  // Depth inside <WorkoutActivity> (a segment of a multi-sport workout): its
  // statistics are a part of the workout, not the workout's own totals.
  private activityDepth = 0;
  private readonly workouts: AppleHealthWorkout[] = [];
  private skippedStrength = 0;
  private skippedInvalid = 0;
  private readonly bodyMassByDay = new Map<string, AppleHealthBodyMass>();
  private ended = false;
  // Where the search for the end of the unfinished tag at the start of `buf`
  // resumes on the next push (0: no such tag), and the quote it was inside.
  private tagCursor = 0;
  private tagQuote = 0;

  constructor(private readonly now: Date = new Date()) {}

  push(chunk: Uint8Array | string): void {
    if (this.ended) return;
    for (let offset = 0; offset < chunk.length; offset += APPLE_HEALTH_SCAN_SLICE) {
      const end = offset + APPLE_HEALTH_SCAN_SLICE;
      const text =
        typeof chunk === 'string'
          ? chunk.slice(offset, end)
          : this.decoder.decode(chunk.subarray(offset, end), { stream: true });
      if (text.length === 0) continue;
      this.buf = this.buf.length > 0 ? this.buf + text : text;
      this.scan(false);
    }
  }

  end(): AppleHealthScanResult {
    if (!this.ended) {
      const tail = this.decoder.decode();
      if (tail.length > 0) this.buf += tail;
      this.scan(true);
      this.buf = '';
      // A file cut off inside a <Workout> still yields what its tag carried.
      this.closeWorkout();
      this.ended = true;
    }
    // Both keys are toISOString() output, so they sort as text.
    return {
      workouts: [...this.workouts].sort((a, b) => compareText(a.startedAt, b.startedAt)),
      skippedStrength: this.skippedStrength,
      skippedInvalid: this.skippedInvalid,
      bodyMass: [...this.bodyMassByDay.values()].sort((a, b) =>
        compareText(a.measuredAt, b.measuredAt),
      ),
    };
  }

  private closeWorkout(): void {
    const raw = this.current;
    this.current = null;
    this.activityDepth = 0;
    if (!raw) return;
    const normalized = normalizeAppleHealthWorkout(raw, this.now);
    if (normalized.kind === 'strength') {
      this.skippedStrength += 1;
    } else if (normalized.kind === 'invalid' || this.workouts.length >= APPLE_HEALTH_MAX_WORKOUTS) {
      this.skippedInvalid += 1;
    } else {
      this.workouts.push(normalized.workout);
    }
  }

  private addBodyMass(attrs: Record<string, string>): void {
    const entry = normalizeAppleHealthBodyMass(attrs, this.now);
    if (!entry) return;
    const day = appleHealthLocalDayKey(entry);
    const known = this.bodyMassByDay.get(day);
    if (!known) {
      if (this.bodyMassByDay.size >= MAX_BODY_MASS_DAYS) return;
      this.bodyMassByDay.set(day, entry);
    } else if (entry.measuredAt >= known.measuredAt) {
      this.bodyMassByDay.set(day, entry);
    }
  }

  private addStatistics(attrs: Record<string, string>): void {
    const workout = this.current;
    if (!workout) return;
    const type = attrs.type ?? '';
    if (type === 'HKQuantityTypeIdentifierHeartRate') {
      if (attrs.average !== undefined) workout.hrAverage = attrs.average;
      if (attrs.maximum !== undefined) workout.hrMaximum = attrs.maximum;
    } else if (
      type.startsWith('HKQuantityTypeIdentifierDistance') &&
      attrs.sum !== undefined &&
      workout.statDistanceSum === undefined
    ) {
      workout.statDistanceSum = attrs.sum;
      workout.statDistanceUnit = attrs.unit;
    }
  }

  // Index of the '>' that closes the tag being read, searching from `from`
  // and honouring quoted attribute values (a '>' is legal inside one).
  // TAG_BROKEN when a '<' comes first: a raw '<' is not legal anywhere inside
  // a tag, quoted or not (XML requires &lt;), so the tag is not one we can
  // read and the scan goes on from that '<'. TAG_UNFINISHED when the buffer
  // ends first; the quote state is then kept for the next push.
  //
  // Both rules are what keeps the scan linear: a tag is searched once, up to
  // the next '<' at most, and an unfinished one is resumed where the search
  // stopped instead of being searched again from its start on every push.
  private findTagEnd(buf: string, from: number, startQuote: number): number {
    let quote = startQuote;
    for (let i = from; i < buf.length; i++) {
      const c = buf.charCodeAt(i);
      if (c === CH_LT) return TAG_BROKEN;
      if (quote !== 0) {
        if (c === quote) quote = 0;
      } else if (c === CH_DQUOTE || c === CH_SQUOTE) {
        quote = c;
      } else if (c === CH_GT) {
        return i;
      }
    }
    this.tagQuote = quote;
    return TAG_UNFINISHED;
  }

  // Walk the buffer from one '<' to the next. A raw '<' never appears inside
  // an attribute value (XML requires &lt; there), so outside comments and
  // CDATA every '<' starts a tag, and a tag we do not care about is skipped by
  // simply looking for the next one: nothing of it is parsed or kept.
  private scan(final: boolean): void {
    const buf = this.buf;
    let pos = 0;
    let keepFrom = buf.length;

    for (;;) {
      if (this.skipUntil !== null) {
        const stop = buf.indexOf(this.skipUntil, pos);
        if (stop < 0) {
          // Keep only a tail short enough to hold a split terminator.
          keepFrom = Math.max(pos, buf.length - (this.skipUntil.length - 1));
          break;
        }
        pos = stop + this.skipUntil.length;
        this.skipUntil = null;
      }

      const lt = buf.indexOf('<', pos);
      if (lt < 0) break;
      if (!final && buf.length - lt < LOOKAHEAD) {
        keepFrom = lt;
        break;
      }

      const c = buf.charCodeAt(lt + 1);
      if (c === CH_BANG) {
        if (buf.startsWith('<!--', lt)) {
          this.skipUntil = '-->';
          pos = lt + 4;
        } else if (buf.startsWith('<![CDATA[', lt)) {
          this.skipUntil = ']]>';
          pos = lt + 9;
        } else {
          pos = lt + 1;
        }
        continue;
      }

      if (c === CH_SLASH) {
        if (nameAt(buf, lt + 2, 'Workout')) {
          this.closeWorkout();
        } else if (nameAt(buf, lt + 2, 'WorkoutActivity')) {
          if (this.activityDepth > 0) this.activityDepth -= 1;
        }
        pos = lt + 1;
        continue;
      }

      let name: 'Workout' | 'WorkoutStatistics' | 'WorkoutActivity' | 'Record' | null = null;
      if (c === CH_UPPER_W) {
        if (nameAt(buf, lt + 1, 'Workout')) name = 'Workout';
        else if (this.current && nameAt(buf, lt + 1, 'WorkoutStatistics')) {
          name = 'WorkoutStatistics';
        } else if (this.current && nameAt(buf, lt + 1, 'WorkoutActivity')) {
          name = 'WorkoutActivity';
        }
      } else if (c === CH_UPPER_R && nameAt(buf, lt + 1, 'Record')) {
        name = 'Record';
      }
      if (name === null) {
        pos = lt + 1;
        continue;
      }

      // An unfinished tag is always kept at the start of the buffer.
      const resumed = lt === 0 && this.tagCursor > 0;
      const end = resumed
        ? this.findTagEnd(buf, this.tagCursor, this.tagQuote)
        : this.findTagEnd(buf, lt + 1 + name.length, 0);
      this.tagCursor = 0;
      if (end < 0) {
        if (end === TAG_BROKEN || final || buf.length - lt > MAX_TAG_CHARS) {
          // Malformed, truncated or absurdly long: not a tag we can read.
          // Move on.
          pos = lt + 1;
          continue;
        }
        keepFrom = lt;
        this.tagCursor = buf.length - lt;
        break;
      }
      const selfClosing = buf.charCodeAt(end - 1) === CH_SLASH;
      pos = end + 1;

      if (name === 'Record') {
        // Millions of these: only a body mass record is worth parsing.
        const tag = buf.slice(lt, end);
        if (tag.includes('HKQuantityTypeIdentifierBodyMass')) {
          const attrs = parseAttributes(tag);
          if (attrs.type === 'HKQuantityTypeIdentifierBodyMass') this.addBodyMass(attrs);
        }
      } else if (name === 'Workout') {
        // An unclosed previous <Workout> ends where the next one starts.
        this.closeWorkout();
        const attrs = parseAttributes(buf.slice(lt, end));
        this.current = {
          workoutActivityType: attrs.workoutActivityType,
          startDate: attrs.startDate,
          endDate: attrs.endDate,
          duration: attrs.duration,
          durationUnit: attrs.durationUnit,
          totalDistance: attrs.totalDistance,
          totalDistanceUnit: attrs.totalDistanceUnit,
        };
        if (selfClosing) this.closeWorkout();
      } else if (name === 'WorkoutActivity') {
        if (!selfClosing) this.activityDepth += 1;
      } else if (this.activityDepth === 0) {
        this.addStatistics(parseAttributes(buf.slice(lt, end)));
      }
    }

    this.buf = keepFrom < buf.length ? buf.slice(keepFrom) : '';
  }
}

// Convenience for tests and small inputs: scan a whole text or byte buffer.
export function scanAppleHealthExport(
  input: Uint8Array | string,
  now: Date = new Date(),
): AppleHealthScanResult {
  const scanner = new AppleHealthScanner(now);
  scanner.push(input);
  return scanner.end();
}
