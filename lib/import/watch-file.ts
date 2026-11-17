import { AVG_HR_MAX, AVG_HR_MIN, MAX_HR_MAX, MAX_HR_MIN } from '@/lib/cardio';
import { parseFit } from '@/lib/import/fit';
import { parseGpx } from '@/lib/import/gpx';
import { parseTcx } from '@/lib/import/tcx';
import { MAX_TRACK_POINTS, type TrackPoint } from '@/lib/import/track';
import { NO_HEART_RATE_MESSAGE } from '@/lib/import/watch-file-errors';

// ============================================================
// Watch file attached to an existing session (issue #562)
// ============================================================
// Reads the heart rate of a watch recording (FIT, TCX or GPX) so it can be
// stored on the session the lifter already logged, instead of importing the
// file as a separate cardio session. Pure: it reuses the three hardened
// parsers (untrusted input, bounded values) and only reshapes their result.

export type WatchFileFormat = 'fit' | 'tcx' | 'gpx';

export interface WatchFileInput {
  format: WatchFileFormat;
  // FIT is binary and rides base64-encoded (as in /api/import/fit); TCX and
  // GPX are the raw file text.
  content: string;
}

// One point of the stored heart rate curve: t = seconds from the start of the
// recording, hr = bpm. A TrackPoint without its distance.
export interface HrPoint {
  t: number;
  hr: number;
}

export interface WatchFileHeartRate {
  startedAt: Date;
  durationSec: number;
  // At least one of the three is present: a file with none is an error.
  avgHr: number | null;
  maxHr: number | null;
  hrTrack: HrPoint[] | null;
}

export { NO_HEART_RATE_MESSAGE };

export type WatchFileResult =
  | { ok: true; data: WatchFileHeartRate }
  | { ok: false; code: 'unreadable' | 'no_heart_rate'; error: string };

// The same reading plus every heart rate sample of the file at full
// resolution (issue #576): what the per-set split works on, and where a peak
// the file does not state is read. Never stored: only `data` is.
export type WatchFileDetailedResult =
  | { ok: true; data: WatchFileHeartRate; hrSamples: HrPoint[] }
  | { ok: false; code: 'unreadable' | 'no_heart_rate'; error: string };

interface ParsedActivity {
  startedAt: Date;
  durationSec: number;
  avgHr: number | null;
  maxHr: number | null;
  track: TrackPoint[] | null;
}

interface Parsed {
  activity: ParsedActivity | null;
  // Sanitized samples before the downsample to MAX_TRACK_POINTS.
  samples: TrackPoint[];
  error: string | null;
}

function parse(input: WatchFileInput): Parsed {
  if (input.format === 'fit') {
    const r = parseFit(new Uint8Array(Buffer.from(input.content, 'base64')), { samples: true });
    return { activity: r.ok ? r.activity : null, samples: r.samples ?? [], error: r.fatalError };
  }
  if (input.format === 'tcx') {
    const r = parseTcx(input.content, { samples: true });
    return { activity: r.ok ? r.activity : null, samples: r.samples ?? [], error: r.fatalError };
  }
  const r = parseGpx(input.content, { samples: true });
  // GPX carries no peak value of its own: it is read from the samples below.
  return {
    activity: r.ok && r.activity ? { ...r.activity, maxHr: null } : null,
    samples: r.samples ?? [],
    error: r.fatalError,
  };
}

function inBounds(value: number | null, min: number, max: number): number | null {
  return value != null && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

// Keep only the heart rate of parsed points (the distance is dropped), with
// every value re-checked against the bounds.
function heartRatePoints(track: TrackPoint[] | null): HrPoint[] {
  const points: HrPoint[] = [];
  for (const p of track ?? []) {
    if (!Number.isInteger(p.t) || p.t < 0) continue;
    const hr = inBounds(p.hr ?? null, AVG_HR_MIN, AVG_HR_MAX);
    if (hr == null) continue;
    points.push({ t: p.t, hr });
  }
  return points;
}

// The stored curve: the heart rate of the parsed track, capped at
// MAX_TRACK_POINTS.
function heartRateTrack(track: TrackPoint[] | null): HrPoint[] | null {
  const points = heartRatePoints(track);
  if (points.length === 0) return null;
  const stride = Math.max(1, Math.ceil(points.length / MAX_TRACK_POINTS));
  return stride === 1 ? points : points.filter((_, i) => i % stride === 0);
}

// Read the heart rate of a watch file, with its full-resolution samples. The
// summary values of the file win; the samples fill in what the file does not
// state: the peak (always for GPX, which has none) and the average. Both are
// read from every sample of the file, not from the downsampled stored curve,
// which keeps one point out of several on a long recording and would miss a
// peak that falls between two kept points (issue #576).
export function readWatchFileDetailed(input: WatchFileInput): WatchFileDetailedResult {
  const { activity, samples, error } = parse(input);
  if (!activity) {
    return { ok: false, code: 'unreadable', error: error ?? 'Unreadable file.' };
  }

  const hrTrack = heartRateTrack(activity.track);
  const hrSamples = heartRatePoints(samples);
  let avgHr = inBounds(activity.avgHr, AVG_HR_MIN, AVG_HR_MAX);
  let maxHr = inBounds(activity.maxHr, MAX_HR_MIN, MAX_HR_MAX);
  if (hrSamples.length > 0) {
    if (avgHr == null) {
      avgHr = Math.round(hrSamples.reduce((sum, p) => sum + p.hr, 0) / hrSamples.length);
    }
    if (maxHr == null) {
      maxHr = hrSamples.reduce((peak, p) => Math.max(peak, p.hr), 0);
    }
  }

  if (avgHr == null && maxHr == null && !hrTrack) {
    return { ok: false, code: 'no_heart_rate', error: NO_HEART_RATE_MESSAGE };
  }

  return {
    ok: true,
    data: {
      startedAt: activity.startedAt,
      durationSec: activity.durationSec,
      avgHr,
      maxHr,
      hrTrack,
    },
    hrSamples,
  };
}

// The reading alone, without the samples (what the preview needs).
export function readWatchFile(input: WatchFileInput): WatchFileResult {
  const result = readWatchFileDetailed(input);
  return result.ok ? { ok: true, data: result.data } : result;
}
