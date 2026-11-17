import { z } from 'zod';
import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  MAX_HR_MAX,
  MAX_HR_MIN,
} from '@/lib/cardio';
import { IMPORT_CSV_MAX_BYTES } from '@/lib/import/csv';
import { cleanTrackPoint, downsampleTrack, type TrackPoint } from '@/lib/import/track';

// ============================================================
// FIT activity file parser (issue #249) - pure, no DB
// ============================================================
// A FIT (Flexible and Interoperable Data Transfer) file is the BINARY format
// Garmin and other watches export natively. This is an untrusted binary blob
// from an arbitrary device, so the decoder is hand-rolled (no third-party FIT
// library, whose own parsing is an extra attack surface) and treats the input
// strictly: every offset and length is bounds-checked against the buffer, the
// declared data size and a hard record cap bound the work, the trailing FIT
// CRC is verified, and every value that reaches the database is range-checked.
//
// We decode only the SESSION summary message (global message number 18) - the
// one roll-up a device writes per activity - and map it onto the same single
// cardio set the TCX/GPX imports produce (duration, distance, avg/max HR,
// sport). Per-record GPS/HR streams are intentionally ignored.

export const FIT_MAX_BYTES = IMPORT_CSV_MAX_BYTES;

// Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z); FIT
// timestamps are uint32 seconds past that.
const FIT_EPOCH_OFFSET_SEC = 631065600;

// Global message numbers and the field definition numbers we read (per the FIT
// profile). The session summary rolls up the activity; record messages are the
// per-sample stream we downsample into a track (issue #254).
const MESG_SESSION = 18;
const FIELD_START_TIME = 2;
const FIELD_SPORT = 5;
const FIELD_TOTAL_ELAPSED_TIME = 7; // scale 1000 -> seconds
const FIELD_TOTAL_TIMER_TIME = 8; // scale 1000 -> seconds (preferred)
const FIELD_TOTAL_DISTANCE = 9; // scale 100 -> meters
const FIELD_AVG_HEART_RATE = 16; // bpm
const FIELD_MAX_HEART_RATE = 17; // bpm

const MESG_RECORD = 20;
const FIELD_TIMESTAMP = 253; // uint32 FIT seconds
const FIELD_RECORD_DISTANCE = 5; // scale 100 -> meters
const FIELD_RECORD_HEART_RATE = 3; // bpm

// Collect at most this many raw records (a ~28h activity at 1 Hz) so a hostile
// record count cannot blow up memory; the shared downsampleTrack then caps the
// stored points (MAX_TRACK_POINTS).
const MAX_RAW_RECORDS = 100_000;

// Defence-in-depth bound on how many records we will walk even within the
// declared data size (a 5 MB file of 1-byte headers is ~5e6 records).
const MAX_RECORDS = 2_000_000;

// FIT sport enum values we surface; everything else is "Other".
const SPORT_RUNNING = 1;
const SPORT_CYCLING = 2;

export type FitSport = 'Running' | 'Biking' | 'Other';

export type { TrackPoint };

export interface FitActivity {
  startedAt: Date;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  sport: FitSport;
  // Downsampled pace/HR samples (issue #254), or null when the file carried no
  // usable record stream.
  track: TrackPoint[] | null;
}

// Optional extras of a parse. `samples: true` also returns every sanitized
// sample at full resolution (before the downsample to MAX_TRACK_POINTS), for
// a caller that needs the real peak or a per-set split (issue #576). Bounded
// by the raw sample cap of the parser.
export interface FitParseOptions {
  samples?: boolean;
}

export interface FitParseResult {
  ok: boolean;
  fatalError: string | null;
  activity: FitActivity | null;
  // Only when asked for with `samples: true` and the parse succeeded.
  samples?: TrackPoint[];
}

const fatal = (msg: string): FitParseResult => ({
  ok: false,
  fatalError: msg,
  activity: null,
});

// Bounds identical to the cardio set contract (lib/schemas/set.ts), mirroring
// the GPX/TCX importers: anything outside these is treated as absent or fatal.
const activitySchema = z.object({
  startedAt: z.date(),
  durationSec: z.number().int().min(1).max(MAX_DURATION_SEC),
  distanceM: z.number().min(0).max(MAX_DISTANCE_M).nullable(),
  avgHr: z.number().int().min(AVG_HR_MIN).max(AVG_HR_MAX).nullable(),
  maxHr: z.number().int().min(MAX_HR_MIN).max(MAX_HR_MAX).nullable(),
  sport: z.enum(['Running', 'Biking', 'Other']),
});

// Sane window for the activity start (same as TCX/GPX): nothing before consumer
// wearables existed, nothing past tomorrow (small clock skew is fine).
export const FIT_MIN_STARTED_AT = new Date('2000-01-01T00:00:00.000Z');
const STARTED_AT_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

// FIT CRC-16 (the nibble-table variant from the FIT spec). Used to verify the
// trailing file CRC so a corrupt or truncated file is rejected cleanly.
const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
];
function fitCrc(buf: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    const byte = buf[i]!;
    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[byte & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!;
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf]!;
  }
  return crc & 0xffff;
}

// Read an unsigned big/little-endian integer of `size` bytes. Uses multiply
// (not bit-shift) so uint32 values stay exact in a JS number.
function readUint(buf: Uint8Array, pos: number, size: number, bigEndian: boolean): number {
  let v = 0;
  if (bigEndian) {
    for (let i = 0; i < size; i++) v = v * 256 + buf[pos + i]!;
  } else {
    for (let i = size - 1; i >= 0; i--) v = v * 256 + buf[pos + i]!;
  }
  return v;
}

// True when an unsigned field holds the FIT "invalid" sentinel (all-1s of its
// width), which means the device did not record that field.
function isInvalid(value: number, size: number): boolean {
  return value === Math.pow(2, 8 * size) - 1;
}

interface FieldDef {
  num: number;
  size: number;
}
interface MesgDef {
  globalNum: number;
  bigEndian: boolean;
  fields: FieldDef[];
  dataSize: number;
}

interface RawSession {
  startTime?: number;
  totalTimerTime?: number;
  totalElapsedTime?: number;
  totalDistance?: number;
  avgHr?: number;
  maxHr?: number;
  sport?: number;
}

interface RawRecord {
  timestamp?: number; // FIT seconds
  distance?: number; // scaled (raw / 100 = meters)
  hr?: number; // bpm
}

function mapSport(sport: number | undefined): FitSport {
  if (sport === SPORT_RUNNING) return 'Running';
  if (sport === SPORT_CYCLING) return 'Biking';
  return 'Other';
}

// Turn the collected per-sample records into sanitized points at full
// resolution (each point relative to the activity start). Records with no
// timestamp or an out-of-window time are dropped; distance is unscaled
// (raw / 100 = meters). The stored track is these points, downsampled.
function cleanRecords(rawRecords: RawRecord[], startTimeFitSec: number): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (const r of rawRecords) {
    if (r.timestamp === undefined) continue;
    const point = cleanTrackPoint(
      r.timestamp - startTimeFitSec,
      r.distance !== undefined ? r.distance / 100 : null,
      r.hr ?? null,
    );
    if (point) points.push(point);
  }
  return points;
}

// Decode a FIT binary into ONE normalized cardio activity, or a fatal error.
// `input` is the raw file bytes (the route base64-decodes the JSON payload).
export function parseFit(input: Uint8Array, options: FitParseOptions = {}): FitParseResult {
  if (input.length > FIT_MAX_BYTES) {
    return fatal('File too large: the limit is 5 MB.');
  }
  // Smallest possible file: 12-byte header + at least the 2-byte file CRC.
  if (input.length < 14) {
    return fatal('Not a FIT file (too short).');
  }

  const headerSize = input[0]!;
  if (headerSize < 12 || headerSize > input.length - 2) {
    return fatal('Not a FIT file (bad header).');
  }
  // ".FIT" signature at bytes 8..11.
  if (input[8] !== 0x2e || input[9] !== 0x46 || input[10] !== 0x49 || input[11] !== 0x54) {
    return fatal('Not a FIT file (bad signature).');
  }

  const dataSize = readUint(input, 4, 4, false);
  const dataEnd = headerSize + dataSize;
  // The records plus the trailing 2-byte file CRC must fit exactly within the
  // file; a declared size pointing past the buffer is corrupt or hostile.
  if (dataEnd + 2 > input.length || dataEnd < headerSize) {
    return fatal('Corrupt FIT file (bad data size).');
  }

  // Verify the trailing file CRC over [0, dataEnd).
  const expectedCrc = readUint(input, dataEnd, 2, false);
  if (fitCrc(input, 0, dataEnd) !== expectedCrc) {
    return fatal('Corrupt FIT file (CRC mismatch).');
  }

  const defs = new Map<number, MesgDef>();
  let session: RawSession | null = null;
  const rawRecords: RawRecord[] = [];
  let pos = headerSize;
  let records = 0;

  while (pos < dataEnd) {
    if (++records > MAX_RECORDS) return fatal('Corrupt FIT file (too many records).');

    const recordHeader = input[pos]!;
    pos += 1;

    if (recordHeader & 0x80) {
      // Compressed-timestamp header: always a data message, local type in bits 5-6.
      const localType = (recordHeader >> 5) & 0x03;
      const def = defs.get(localType);
      if (!def) return fatal('Corrupt FIT file (data before definition).');
      if (pos + def.dataSize > dataEnd) return fatal('Corrupt FIT file (truncated record).');
      if (def.globalNum === MESG_SESSION && !session) {
        session = readSession(input, pos, def);
      } else if (def.globalNum === MESG_RECORD && rawRecords.length < MAX_RAW_RECORDS) {
        rawRecords.push(readRecord(input, pos, def));
      }
      pos += def.dataSize;
      continue;
    }

    const isDefinition = (recordHeader & 0x40) !== 0;
    const hasDevData = (recordHeader & 0x20) !== 0;
    const localType = recordHeader & 0x0f;

    if (isDefinition) {
      // Fixed 5-byte definition prelude: reserved, arch, globalNum(uint16), numFields.
      if (pos + 5 > dataEnd) return fatal('Corrupt FIT file (truncated definition).');
      const bigEndian = input[pos + 1] === 1;
      const globalNum = readUint(input, pos + 2, 2, bigEndian);
      const numFields = input[pos + 4]!;
      pos += 5;
      if (pos + numFields * 3 > dataEnd) return fatal('Corrupt FIT file (truncated fields).');

      const fields: FieldDef[] = [];
      let mesgDataSize = 0;
      for (let i = 0; i < numFields; i++) {
        const num = input[pos]!;
        const size = input[pos + 1]!;
        pos += 3; // [fieldDefNum, size, baseType]
        fields.push({ num, size });
        mesgDataSize += size;
      }

      if (hasDevData) {
        // Developer fields extend the data message but we never read them; still
        // account for their bytes so data-message offsets stay correct.
        if (pos >= dataEnd) return fatal('Corrupt FIT file (truncated dev fields).');
        const numDevFields = input[pos]!;
        pos += 1;
        if (pos + numDevFields * 3 > dataEnd) {
          return fatal('Corrupt FIT file (truncated dev fields).');
        }
        for (let i = 0; i < numDevFields; i++) {
          mesgDataSize += input[pos + 1]!;
          pos += 3;
        }
      }

      defs.set(localType, { globalNum, bigEndian, fields, dataSize: mesgDataSize });
      continue;
    }

    // Data message.
    const def = defs.get(localType);
    if (!def) return fatal('Corrupt FIT file (data before definition).');
    if (pos + def.dataSize > dataEnd) return fatal('Corrupt FIT file (truncated record).');
    if (def.globalNum === MESG_SESSION && !session) {
      session = readSession(input, pos, def);
    } else if (def.globalNum === MESG_RECORD && rawRecords.length < MAX_RAW_RECORDS) {
      rawRecords.push(readRecord(input, pos, def));
    }
    pos += def.dataSize;
  }

  if (!session) return fatal('No activity session found in the FIT file.');

  // Build the normalized activity, dropping invalid/out-of-range pieces.
  if (session.startTime === undefined) {
    return fatal('FIT session has no start time.');
  }
  const startedAt = new Date((FIT_EPOCH_OFFSET_SEC + session.startTime) * 1000);
  if (
    startedAt < FIT_MIN_STARTED_AT ||
    startedAt.getTime() > Date.now() + STARTED_AT_FUTURE_SLACK_MS
  ) {
    return fatal('FIT session start time is out of range.');
  }

  const rawSeconds = session.totalTimerTime ?? session.totalElapsedTime;
  if (rawSeconds === undefined) return fatal('FIT session has no duration.');
  const durationSec = Math.round(rawSeconds / 1000);

  const distanceM =
    session.totalDistance !== undefined ? +(session.totalDistance / 100).toFixed(2) : null;

  const candidate = {
    startedAt,
    durationSec,
    distanceM,
    avgHr: session.avgHr ?? null,
    maxHr: session.maxHr ?? null,
    sport: mapSport(session.sport),
  };

  const checked = activitySchema.safeParse(candidate);
  if (!checked.success) {
    return fatal('FIT session values are out of the supported range.');
  }
  // The track is sanitized/bounded by cleanRecords (not the summary schema),
  // then attached to the validated summary.
  const points = cleanRecords(rawRecords, session.startTime);
  const track = downsampleTrack(points);
  return {
    ok: true,
    fatalError: null,
    activity: { ...checked.data, track },
    ...(options.samples ? { samples: points } : {}),
  };
}

// Extract the record fields we care about from one data message at `pos`.
function readRecord(input: Uint8Array, pos: number, def: MesgDef): RawRecord {
  const out: RawRecord = {};
  let offset = pos;
  for (const field of def.fields) {
    const value = readUint(input, offset, field.size, def.bigEndian);
    if (!isInvalid(value, field.size)) {
      switch (field.num) {
        case FIELD_TIMESTAMP:
          out.timestamp = value;
          break;
        case FIELD_RECORD_DISTANCE:
          out.distance = value;
          break;
        case FIELD_RECORD_HEART_RATE:
          out.hr = value;
          break;
      }
    }
    offset += field.size;
  }
  return out;
}

// Extract the session fields we care about from one data message at `pos`.
function readSession(input: Uint8Array, pos: number, def: MesgDef): RawSession {
  const out: RawSession = {};
  let offset = pos;
  for (const field of def.fields) {
    const value = readUint(input, offset, field.size, def.bigEndian);
    const valid = !isInvalid(value, field.size);
    if (valid) {
      switch (field.num) {
        case FIELD_START_TIME:
          out.startTime = value;
          break;
        case FIELD_SPORT:
          out.sport = value;
          break;
        case FIELD_TOTAL_TIMER_TIME:
          out.totalTimerTime = value;
          break;
        case FIELD_TOTAL_ELAPSED_TIME:
          out.totalElapsedTime = value;
          break;
        case FIELD_TOTAL_DISTANCE:
          out.totalDistance = value;
          break;
        case FIELD_AVG_HEART_RATE:
          out.avgHr = value;
          break;
        case FIELD_MAX_HEART_RATE:
          out.maxHr = value;
          break;
      }
    }
    offset += field.size;
  }
  return out;
}

// Default exercise name for an imported FIT activity, by sport. Matches
// gpxExerciseName so a FIT and a GPX run map to the same cardio exercise.
export function fitExerciseName(sport: FitSport): string {
  switch (sport) {
    case 'Running':
      return 'Running';
    case 'Biking':
      return 'Cycling';
    default:
      return 'Cardio (imported)';
  }
}
