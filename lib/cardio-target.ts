import type { ExerciseCategory } from '@/lib/prisma-client';
import { MAX_DISTANCE_M, MAX_DURATION_SEC, formatDistance, formatDuration } from '@/lib/cardio';

// ============================================================
// Cardio target of a programmed exercise (issue #558, slice 1)
// ============================================================
// A ProgramExercise whose Exercise.category is CARDIO is prescribed by a
// duration (targetDurationSec) and an optional distance (targetDistanceM)
// instead of sets, reps, RIR and rest. These pure helpers keep the decision,
// the text and the unit conversions in one place: the program editor, the
// print sheet, the live session card, the set logger and the coach payload
// all go through them. Storage is metric (seconds, meters) like a cardio Set;
// the editor types minutes and kilometers, like the set logger.

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

// A target duration as text: whole minutes read "20 min" (also over an hour,
// "90 min"), anything else falls back to the clock format of a logged set
// ("12:30").
export function formatTargetDuration(durationSec: number): string {
  const total = Math.max(0, Math.round(durationSec));
  if (total > 0 && total % 60 === 0) return `${total / 60} min`;
  return formatDuration(total);
}

// One-line prescription of a cardio row: "20 min", or "20 min · 5 km" when a
// distance is set. Null when the row has no target (rows created before the
// columns existed, or by a writer that does not set them): the caller then
// shows a neutral cardio label, never the strength line.
export function formatCardioTarget(target: CardioTargetFields): string | null {
  if (!hasCardioTarget(target)) return null;
  const duration = formatTargetDuration(target.targetDurationSec!);
  if (target.targetDistanceM != null && target.targetDistanceM > 0) {
    return `${duration} · ${formatDistance(target.targetDistanceM)}`;
  }
  return duration;
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

// Kilometers typed in the program editor to stored meters. `undefined` means
// the text is invalid (not a number, zero, or over the 1000 km bound); null
// means the field was left empty, which is allowed (distance is optional).
export function kmInputToDistanceM(input: string): number | null | undefined {
  const trimmed = input.trim().replace(',', '.');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const meters = Math.round(parseFloat(trimmed) * 1000);
  if (meters <= 0 || meters > MAX_DISTANCE_M) return undefined;
  return meters;
}

// Stored seconds as the minutes shown in the editor field ("20", "12.5").
export function durationSecToMinutesInput(durationSec: number | null | undefined): string {
  if (durationSec == null || durationSec <= 0) return '';
  return String(+(durationSec / 60).toFixed(2));
}

// Stored meters as the kilometers shown in a field ("5", "2.5"), the same
// rounding the set logger uses.
export function distanceMToKmInput(distanceM: number | null | undefined): string {
  if (distanceM == null || distanceM <= 0) return '';
  return String(+(distanceM / 1000).toFixed(2));
}

// --- Live session ------------------------------------------------------------

// The values the set logger starts from on a cardio exercise with a target,
// in the raw-string shape of its two inputs: duration as "m:ss" (what the
// logger parses back) and distance in km. Empty strings when there is no
// target, which is the logger's behavior before this slice.
export function cardioTargetLoggerInputs(target: CardioTargetFields): {
  durationInput: string;
  distanceInput: string;
} {
  if (!hasCardioTarget(target)) return { durationInput: '', distanceInput: '' };
  return {
    durationInput: formatDuration(target.targetDurationSec!),
    distanceInput: distanceMToKmInput(target.targetDistanceM),
  };
}

// --- Coach payload -----------------------------------------------------------

// The cardio target as the coach reads it: minutes and kilometers, each key
// present only when set. An empty object for a row without a target (or a
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
