import type { ExerciseCategory } from '@/lib/prisma-client';
import {
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

export interface CardioTargetFields {
  targetDurationSec?: number | null;
  targetDistanceM?: number | null;
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

// One-line prescription of a cardio row: "20 min", or "20 min · 5 km" when a
// distance is set. Null when the row has no target (rows created before the
// columns existed, or by a writer that does not set them): the caller then
// shows a neutral cardio label, never the strength line.
export function formatCardioTarget(
  target: CardioTargetFields,
  options: CardioTargetFormatOptions = {},
): string | null {
  const { duration, distance } = formatCardioTargetParts(target, options);
  if (duration == null) return null;
  return distance != null ? `${duration} · ${distance}` : duration;
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
export function coachCardioTarget(
  exercise: { category: ExerciseCategory },
  target: CardioTargetFields,
): { targetDurationMin?: number; targetDistanceKm?: number } {
  if (!isCardioExercise(exercise) || !hasCardioTarget(target)) return {};
  return {
    targetDurationMin: +(target.targetDurationSec! / 60).toFixed(1),
    ...(target.targetDistanceM != null && target.targetDistanceM > 0
      ? { targetDistanceKm: +(target.targetDistanceM / 1000).toFixed(2) }
      : {}),
  };
}
