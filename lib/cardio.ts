import type { WeightUnit } from '@/lib/prisma-client';
import type { TrackPoint } from '@/lib/import/track';

// ============================================================
// Cardio sets (issue #133) - duration/distance helpers
// ============================================================
// A cardio set is a Set row with durationSec != null (and reps = 1,
// weight = 0 by convention - the API normalizes them on write). These
// helpers keep parsing and formatting in one place: the set logger,
// the sets list, the post-session summary and the history page all
// render through them.

// Bounds shared by the Zod schema and the UI: at least 1 second, at
// most 24 hours; distance at most 1000 km (in meters).
export const MAX_DURATION_SEC = 86400;
export const MAX_DISTANCE_M = 1000000;

// Average heart rate bounds in bpm (issue #152): enforced by every writer
// of Set.avgHr (the set API schema and the TCX importer).
export const AVG_HR_MIN = 40;
export const AVG_HR_MAX = 250;

// Maximum heart rate bounds in bpm (issue #203): the peak heart-rate metric a
// watch records, carried by the same TCX exports alongside the average. Same
// 40..250 window as the average, enforced by every writer of Set.maxHr (the
// set API schema and the TCX importer).
export const MAX_HR_MIN = 40;
export const MAX_HR_MAX = 250;

// Statute mile in meters, for imports from imperial-unit exports.
export const MILES_TO_METERS = 1609.34;

// The unit a cardio distance is typed and shown in. Storage is always meters.
export type DistanceUnit = 'km' | 'mi';

// The single rule for that unit (issue #576). The set logger types and shows
// distance in kilometers for every user: it reads neither the weight unit
// preference nor the locale. Everything that prescribes a distance (the
// program editor, the workout card, the print sheet) asks this function, so a
// future distance unit setting changes the logger and the targets together.
export function cardioDistanceUnit(): DistanceUnit {
  return 'km';
}

// Meters in one distance unit.
export function metersPerDistanceUnit(unit: DistanceUnit): number {
  return unit === 'mi' ? MILES_TO_METERS : 1000;
}

// True when a set-like record is a cardio set.
export function isCardioSet(set: { durationSec?: number | null }): boolean {
  return set.durationSec != null;
}

// Sums duration and distance over the WORKING sets only (warmups excluded),
// matching the working-set / last-performance convention used everywhere else
// (issue #183). Used for the per-exercise cardio recap totals.
export function sumCardioWorkingSets(
  sets: { durationSec?: number | null; distanceM?: number | null; isWarmup: boolean }[],
): { durationSec: number; distanceM: number } {
  return sets
    .filter((s) => !s.isWarmup)
    .reduce(
      (acc, s) => ({
        durationSec: acc.durationSec + (s.durationSec ?? 0),
        distanceM: acc.distanceM + (s.distanceM ?? 0),
      }),
      { durationSec: 0, distanceM: 0 },
    );
}

// Parses a user-typed duration into seconds. Accepted formats:
//   "mm:ss"    -> minutes and seconds (e.g. "12:30")
//   "h:mm:ss"  -> hours, minutes, seconds (e.g. "1:05:00")
//   "mm"       -> plain minutes (e.g. "45")
// "." and "," are accepted in place of ":" ("11.46" = 11:46) because mobile
// numeric keyboards have no colon key.
// Returns null for anything else (empty, negative, out of bounds).
export function parseDurationToSec(input: string): number | null {
  const trimmed = input.trim().replace(/[.,]/g, ':');
  if (!/^\d{1,3}(:[0-5]?\d){0,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  let seconds: number;
  if (parts.length === 1) {
    seconds = parts[0]! * 60; // plain minutes
  } else if (parts.length === 2) {
    seconds = parts[0]! * 60 + parts[1]!;
  } else {
    seconds = parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  }
  if (seconds < 1 || seconds > MAX_DURATION_SEC) return null;
  return seconds;
}

// Formats a duration in seconds as "m:ss" (or "h:mm:ss" over an hour).
export function formatDuration(durationSec: number): string {
  const total = Math.max(0, Math.round(durationSec));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

// Formats a distance in meters as kilometers with up to 2 decimals
// (trailing zeros trimmed): 2500 -> "2.5 km", 10000 -> "10 km".
export function formatDistance(distanceM: number): string {
  const km = distanceM / 1000;
  const rounded = +km.toFixed(2);
  return `${rounded} km`;
}

// One-line label for a cardio set: "12:30 · 2.5 km" (duration only when
// there is no distance).
export function formatCardioSet(durationSec: number, distanceM: number | null | undefined): string {
  const duration = formatDuration(durationSec);
  if (distanceM != null && distanceM > 0) {
    return `${duration} · ${formatDistance(distanceM)}`;
  }
  return duration;
}

// ============================================================
// Pace and speed (issue #177) - pure, unit-aware derivations
// ============================================================
// The single number runners/cyclists train on. Both are derived from the
// stored duration and distance; both return null when there is no distance
// (e.g. a duration-only erg set) so callers never divide by zero or render
// NaN/Infinity. Storage stays metric (meters/seconds); the unit only affects
// the display helpers below.

// Pace as seconds per kilometer, or null when distance is absent/zero.
export function paceSecPerKm(
  durationSec: number,
  distanceM: number | null | undefined,
): number | null {
  if (distanceM == null || distanceM <= 0) return null;
  return durationSec / (distanceM / 1000);
}

// Speed in kilometers per hour, or null when distance is absent/zero.
export function speedKmh(durationSec: number, distanceM: number | null | undefined): number | null {
  if (distanceM == null || distanceM <= 0 || durationSec <= 0) return null;
  return distanceM / 1000 / (durationSec / 3600);
}

// Formats pace for display, respecting the user's unit: "6:00 /km" in metric,
// "9:39 /mi" in imperial. Returns null when distance is absent (no pace to
// show). The mm:ss part reuses formatDuration so it stays consistent.
export function formatPace(
  durationSec: number,
  distanceM: number | null | undefined,
  unit: WeightUnit,
): string | null {
  const secPerKm = paceSecPerKm(durationSec, distanceM);
  if (secPerKm == null) return null;
  if (unit === 'LB') {
    const secPerMile = secPerKm * (MILES_TO_METERS / 1000);
    return `${formatDuration(secPerMile)} /mi`;
  }
  return `${formatDuration(secPerKm)} /km`;
}

// Formats speed for display, respecting the user's unit: "10 km/h" in metric,
// "6.2 mph" in imperial. Returns null when distance is absent. One decimal,
// trailing zeros trimmed.
export function formatSpeed(
  durationSec: number,
  distanceM: number | null | undefined,
  unit: WeightUnit,
): string | null {
  const kmh = speedKmh(durationSec, distanceM);
  if (kmh == null) return null;
  if (unit === 'LB') {
    const mph = kmh * (1000 / MILES_TO_METERS);
    return `${+mph.toFixed(1)} mph`;
  }
  return `${+kmh.toFixed(1)} km/h`;
}

// ============================================================
// Aerobic decoupling (issue #268) - HR drift over an imported track
// ============================================================
// How much the pace-per-heartbeat efficiency degrades between the first and
// the second half of an activity (a.k.a. cardiac drift). Lower is better: a
// well-developed aerobic base holds the same speed at the same heart rate for
// the whole effort. Computed purely from the stored TrackPoint[] of an
// imported cardio set - no schema or API change.

// Below this many usable samples per half the split averages are too noisy to
// mean anything, so the metric is hidden rather than shown wrong.
export const MIN_DECOUPLING_POINTS_PER_HALF = 2;

// Efficiency (speed per heartbeat) over one half of a track: distance covered
// divided by elapsed time, divided by the mean heart rate of the half's
// samples. Null when the half has no positive time or distance span.
function halfEfficiency(points: TrackPoint[]): number | null {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const dt = last.t - first.t;
  const dd = (last.d as number) - (first.d as number);
  if (dt <= 0 || dd <= 0) return null;
  const avgHr = points.reduce((sum, p) => sum + (p.hr as number), 0) / points.length;
  if (avgHr <= 0) return null;
  return dd / dt / avgHr;
}

// Aerobic decoupling in percent from an imported activity track, or null when
// the track cannot support it (no cumulative distance, no heart rate, too few
// samples, or a degenerate time/distance span). Splits the track at its time
// midpoint, computes efficiency = speed / avg HR for each half (the boundary
// sample closes the first half and opens the second, so no segment is lost)
// and returns (effFirst - effSecond) / effFirst * 100. Positive = the pace
// per heartbeat faded; near zero or negative = it held.
export function trackDecoupling(track: TrackPoint[]): number | null {
  const points = track
    .filter(
      (p) =>
        Number.isFinite(p.t) &&
        typeof p.d === 'number' &&
        Number.isFinite(p.d) &&
        typeof p.hr === 'number' &&
        Number.isFinite(p.hr),
    )
    .sort((a, b) => a.t - b.t);
  if (points.length < MIN_DECOUPLING_POINTS_PER_HALF * 2) return null;

  const tMid = (points[0]!.t + points[points.length - 1]!.t) / 2;
  // Last index still inside the first half; it is shared as the boundary of
  // both halves so the two spans cover the whole track.
  let split = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.t <= tMid) split = i;
  }
  const firstHalf = points.slice(0, split + 1);
  const secondHalf = points.slice(split);
  if (
    firstHalf.length < MIN_DECOUPLING_POINTS_PER_HALF ||
    secondHalf.length < MIN_DECOUPLING_POINTS_PER_HALF
  ) {
    return null;
  }

  const effFirst = halfEfficiency(firstHalf);
  const effSecond = halfEfficiency(secondHalf);
  if (effFirst == null || effSecond == null) return null;
  return ((effFirst - effSecond) / effFirst) * 100;
}
