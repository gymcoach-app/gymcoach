import type { ExerciseCategory } from '@/lib/prisma-client';
import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  distanceInUnit,
  distanceToM,
  formatDuration,
  metersPerDistanceUnit,
  type DistanceUnit,
} from '@/lib/cardio';

// ============================================================
// Cardio target of a programmed exercise (issue #558, slice 1)
// ============================================================
// A ProgramExercise whose Exercise.category is CARDIO is prescribed by a
// duration (targetDurationSec) and an optional distance (targetDistanceM)
// instead of sets, reps, RIR and rest. These pure helpers keep the decision,
// the text and the unit conversions in one place: the program editor, the
// print sheet, the live session card, the set logger and the coach payload
// all go through them. Storage is metric (seconds, meters) like a cardio Set;
// the editor types minutes and a distance in the unit the set logger uses
// (cardioDistanceUnit in lib/cardio: the user's distance unit preference).
//
// The text is localized (issue #576): the unit names and the decimal mark
// come from Intl.NumberFormat in the reader's locale ("20 min", "20 Min.",
// "2,5 km"). The coach payload stays numeric and locale-free.
//
// Intensity (issue #558, slice 2): next to the duration a cardio row may
// carry a target effort (targetRpe, the 1 to 10 scale of perceived exertion)
// and a target heart rate range in bpm (targetHrMin, targetHrMax, always both
// or neither, min <= max). They only exist next to a duration, like the
// distance. The cardio RPE is its own number: it is not the strength effort
// (RIR, shown as RPE = 10 - RIR when the user picks that scale, lib/effort),
// which has no meaning for a continuous effort, so it reads "RPE 6" whatever
// the user's effort scale. The app has no heart rate zones and no maximum
// heart rate on the profile, so the heart rate target is a plain range.

// Bounds of the intensity targets, shared by the Zod schemas, the backup
// import and the editor. The heart rate window is the one of a logged
// average heart rate (lib/cardio).
export const TARGET_RPE_MIN = 1;
export const TARGET_RPE_MAX = 10;
export const TARGET_HR_MIN = AVG_HR_MIN;
export const TARGET_HR_MAX = AVG_HR_MAX;

export interface CardioTargetFields {
  targetDurationSec?: number | null;
  targetDistanceM?: number | null;
  targetRpe?: number | null;
  targetHrMin?: number | null;
  targetHrMax?: number | null;
}

// True when the exercise is prescribed and logged as cardio: the same test
// the live session uses to swap weight and reps for duration and distance.
export function isCardioExercise(exercise: { category: ExerciseCategory }): boolean {
  return exercise.category === 'CARDIO';
}

// True when the row carries a usable cardio target (a duration).
export function hasCardioTarget(target: CardioTargetFields): boolean {
  return target.targetDurationSec != null && target.targetDurationSec > 0;
}

export interface CardioTargetFormatOptions {
  /** BCP 47 locale of the reader. Default "en". */
  locale?: string;
  /** Unit the distance is shown in. Default: kilometers. */
  distanceUnit?: DistanceUnit;
  /**
   * Writes a heart rate value or range with its unit in the reader's language
   * ("140-150" to "140-150 bpm"): the catalog entry common.units.bpm.
   * Default: the English "bpm".
   */
  bpm?: (value: string) => string;
  /**
   * False leaves the RPE and the heart rate out of the one-line target. The
   * live session card does that: the set logger under it already shows the
   * intensity (formatCardioIntensity), and it would read twice. Default true.
   */
  intensity?: boolean;
}

const INTL_UNIT: Record<DistanceUnit, string> = { km: 'kilometer', mi: 'mile' };

// One formatter per locale and unit: the workout card and the editor format a
// target per row on every render.
const unitFormats = new Map<string, Intl.NumberFormat>();

function unitFormat(locale: string, unit: string): Intl.NumberFormat {
  const key = `${locale}|${unit}`;
  let format = unitFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit,
      unitDisplay: 'short',
      maximumFractionDigits: 2,
    });
    unitFormats.set(key, format);
  }
  return format;
}

// A target duration as text: whole minutes read "20 min" (also over an hour,
// "90 min") with the unit in the reader's language, anything else falls back
// to the clock format of a logged set ("12:30").
export function formatTargetDuration(durationSec: number, locale = 'en'): string {
  const total = Math.max(0, Math.round(durationSec));
  if (total > 0 && total % 60 === 0) return unitFormat(locale, 'minute').format(total / 60);
  return formatDuration(total);
}

// A target distance as text, up to 2 decimals: "5 km", "2.5 km", "3.11 mi",
// with the unit name and the decimal mark of the reader's language.
export function formatTargetDistance(
  distanceM: number,
  options: CardioTargetFormatOptions = {},
): string {
  const { locale = 'en', distanceUnit = 'km' } = options;
  const value = distanceInUnit(distanceM, distanceUnit);
  return unitFormat(locale, INTL_UNIT[distanceUnit]).format(value);
}

// The short name of a distance unit in the reader's language ("km", "mi"),
// for a field label.
export function distanceUnitLabel(unit: DistanceUnit, locale = 'en'): string {
  const part = unitFormat(locale, INTL_UNIT[unit])
    .formatToParts(1)
    .find((p) => p.type === 'unit');
  return part ? part.value : unit;
}

// The largest distance a target accepts, as a whole number of the unit
// (1000 km, 621 mi): the stored bound is MAX_DISTANCE_M.
export function maxTargetDistance(unit: DistanceUnit): number {
  return Math.floor(MAX_DISTANCE_M / metersPerDistanceUnit(unit));
}

// The two halves of a cardio target, each null when not set: the duration
// and the distance texts the print sheet pre-prints in its boxes.
export function formatCardioTargetParts(
  target: CardioTargetFields,
  options: CardioTargetFormatOptions = {},
): { duration: string | null; distance: string | null } {
  if (!hasCardioTarget(target)) return { duration: null, distance: null };
  return {
    duration: formatTargetDuration(target.targetDurationSec!, options.locale),
    distance:
      target.targetDistanceM != null && target.targetDistanceM > 0
        ? formatTargetDistance(target.targetDistanceM, options)
        : null,
  };
}

// True when the value is a usable target effort: a whole number from 1 to 10.
function isTargetRpe(rpe: number | null | undefined): rpe is number {
  return rpe != null && Number.isInteger(rpe) && rpe >= TARGET_RPE_MIN && rpe <= TARGET_RPE_MAX;
}

// The heart rate range of a row, or null when it has none. Both bounds are
// needed and must be in order: a half range reads as no target rather than
// as a wrong one.
export function targetHeartRateRange(
  target: CardioTargetFields,
): { min: number; max: number } | null {
  const { targetHrMin: min, targetHrMax: max } = target;
  if (min == null || max == null || min <= 0 || max < min) return null;
  return { min, max };
}

// The target effort as text: "RPE 6". The acronym is not translated in any
// catalog (lib/effort).
export function formatTargetRpe(rpe: number): string {
  return `RPE ${rpe}`;
}

// The target heart rate as text: "140-150 bpm", or "145 bpm" when both bounds
// are the same.
export function formatTargetHeartRate(
  range: { min: number; max: number },
  bpm: (value: string) => string = (value) => `${value} bpm`,
): string {
  return bpm(range.min === range.max ? String(range.min) : `${range.min}-${range.max}`);
}

// The intensity half of a cardio target on one line: "RPE 6 · 140-150 bpm",
// "RPE 6" or "140-150 bpm". Null when the row has no duration target or no
// intensity target. The set logger shows it next to its inputs: it has a
// field for the duration and the distance, none for the effort or the heart
// rate, which are a plan to hold while the set runs.
export function formatCardioIntensity(
  target: CardioTargetFields,
  options: CardioTargetFormatOptions = {},
): string | null {
  if (!hasCardioTarget(target)) return null;
  const parts: string[] = [];
  if (isTargetRpe(target.targetRpe)) parts.push(formatTargetRpe(target.targetRpe));
  const range = targetHeartRateRange(target);
  if (range) parts.push(formatTargetHeartRate(range, options.bpm));
  return parts.length > 0 ? parts.join(' · ') : null;
}

// One-line prescription of a cardio row: "20 min", "20 min · 5 km" when a
// distance is set, then the intensity when one is set ("20 min · RPE 6 ·
// 140-150 bpm"). Null when the row has no target (rows created before the
// columns existed, or by a writer that does not set them): the caller then
// shows a neutral cardio label, never the strength line.
export function formatCardioTarget(
  target: CardioTargetFields,
  options: CardioTargetFormatOptions = {},
): string | null {
  const { duration, distance } = formatCardioTargetParts(target, options);
  if (duration == null) return null;
  const parts = [duration];
  if (distance != null) parts.push(distance);
  const intensity = options.intensity === false ? null : formatCardioIntensity(target, options);
  if (intensity != null) parts.push(intensity);
  return parts.join(' · ');
}

// --- Editor conversions (minutes and kilometers typed, metric stored) --------

// Minutes typed in the program editor to stored seconds. Null when the text
// is empty, not a number or out of the 1 second .. 24 hours bounds.
export function minutesInputToDurationSec(input: string): number | null {
  const trimmed = input.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const seconds = Math.round(parseFloat(trimmed) * 60);
  if (seconds < 1 || seconds > MAX_DURATION_SEC) return null;
  return seconds;
}

// A distance typed in the program editor or the set logger, in `unit`, to
// stored meters. `undefined` means the text is invalid (not a number, zero,
// or over the 1000 km bound); null means the field was left empty, which is
// allowed (distance is optional).
//
// `shownM` lists the stored distances the field may have been filled from:
// a text that still reads as one of them keeps that stored value instead of
// being converted again (distanceToM in lib/cardio), so re-saving a form
// never drifts.
export function distanceInputToM(
  input: string,
  unit: DistanceUnit = 'km',
  shownM: readonly (number | null | undefined)[] = [],
): number | null | undefined {
  const trimmed = input.trim().replace(',', '.');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const meters = distanceToM(parseFloat(trimmed), unit, shownM);
  if (meters <= 0 || meters > MAX_DISTANCE_M) return undefined;
  return meters;
}

// Kilometers typed to stored meters (distanceInputToM in km).
export function kmInputToDistanceM(input: string): number | null | undefined {
  return distanceInputToM(input, 'km');
}

// A whole number typed in an optional editor field (the target RPE, a heart
// rate bound) within [min, max]. Null means the field was left empty, which
// is allowed; `undefined` means the text is not a whole number in bounds.
export function optionalIntInput(
  input: string,
  min: number,
  max: number,
): number | null | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^\d{1,4}$/.test(trimmed)) return undefined;
  const value = parseInt(trimmed, 10);
  return value >= min && value <= max ? value : undefined;
}

// The heart rate range typed in the editor's two fields. Null when both are
// empty (no heart rate target); `undefined` when only one is filled, a bound
// is out of the 40 to 250 bpm window, or the first is above the second.
export function heartRateInputsToRange(
  minInput: string,
  maxInput: string,
): { min: number; max: number } | null | undefined {
  const min = optionalIntInput(minInput, TARGET_HR_MIN, TARGET_HR_MAX);
  const max = optionalIntInput(maxInput, TARGET_HR_MIN, TARGET_HR_MAX);
  if (min === undefined || max === undefined) return undefined;
  if (min === null && max === null) return null;
  if (min === null || max === null || min > max) return undefined;
  return { min, max };
}

// Stored seconds as the minutes shown in the editor field ("20", "12.5").
export function durationSecToMinutesInput(durationSec: number | null | undefined): string {
  if (durationSec == null || durationSec <= 0) return '';
  return String(+(durationSec / 60).toFixed(2));
}

// Stored meters as the distance shown in a field, in `unit` ("5", "2.5"),
// the same rounding the set logger uses.
export function distanceMToInput(
  distanceM: number | null | undefined,
  unit: DistanceUnit = 'km',
): string {
  if (distanceM == null || distanceM <= 0) return '';
  return String(distanceInUnit(distanceM, unit));
}

// Stored meters as kilometers (distanceMToInput in km).
export function distanceMToKmInput(distanceM: number | null | undefined): string {
  return distanceMToInput(distanceM, 'km');
}

// --- Live session ------------------------------------------------------------

// The values the set logger starts from on a cardio exercise with a target,
// in the raw-string shape of its two inputs: duration as "m:ss" (what the
// logger parses back) and distance in the logger's unit (the user's distance
// unit, kilometers by default). Empty strings when there is no target, which
// is the logger's behavior before this slice.
export function cardioTargetLoggerInputs(
  target: CardioTargetFields,
  distanceUnit: DistanceUnit = 'km',
): {
  durationInput: string;
  distanceInput: string;
} {
  if (!hasCardioTarget(target)) return { durationInput: '', distanceInput: '' };
  return {
    durationInput: formatDuration(target.targetDurationSec!),
    distanceInput: distanceMToInput(target.targetDistanceM, distanceUnit),
  };
}

// --- Coach payload -----------------------------------------------------------

// The cardio target as the coach reads it: minutes and kilometers as plain
// numbers, whatever the reader's locale or distance unit, each key present
// only when set. An empty object for a row without a target (or a
// non-cardio row), so spreading it leaves the payload byte-identical.
//
// Intensity (slice 2): targetRpe (1 to 10) and the heart rate range as
// targetHrMinBpm / targetHrMaxBpm, both or neither.
export function coachCardioTarget(
  exercise: { category: ExerciseCategory },
  target: CardioTargetFields,
): {
  targetDurationMin?: number;
  targetDistanceKm?: number;
  targetRpe?: number;
  targetHrMinBpm?: number;
  targetHrMaxBpm?: number;
} {
  if (!isCardioExercise(exercise) || !hasCardioTarget(target)) return {};
  const range = targetHeartRateRange(target);
  return {
    targetDurationMin: +(target.targetDurationSec! / 60).toFixed(1),
    ...(target.targetDistanceM != null && target.targetDistanceM > 0
      ? { targetDistanceKm: +(target.targetDistanceM / 1000).toFixed(2) }
      : {}),
    ...(isTargetRpe(target.targetRpe) ? { targetRpe: target.targetRpe } : {}),
    ...(range ? { targetHrMinBpm: range.min, targetHrMaxBpm: range.max } : {}),
  };
}
