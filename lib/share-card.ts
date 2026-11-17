import { formatCardioSet, sumCardioWorkingSets } from '@/lib/cardio';
import type { WeightUnit } from '@/lib/prisma-client';
import { applyBodyweight, estimate1RM, totalVolume } from '@/lib/stats';
import { formatWeight } from '@/lib/units';

// Summary card of a finished session, shared as an image (issue #576 part 3).
// This module is the pure half: it turns the data the history page already
// holds into the strings the card shows. The caller resolves the localized
// names, the date and the labels, so the same function serves every locale
// and is unit-testable without a translator or a canvas. Drawing lives in
// lib/share-card-canvas.ts.

export const SHARE_CARD_APP_NAME = 'GymCoach';

// A social portrait card (4:5).
export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1350;

// More exercises than this are summed up in one "+N more" line.
export const SHARE_CARD_MAX_EXERCISES = 8;

export interface ShareCardSet {
  weight: number;
  reps: number;
  isWarmup: boolean;
  durationSec: number | null;
  distanceM: number | null;
}

export interface ShareCardExercise {
  // Groups of the same exercise (a repeated block, issue #429) share an id
  // and are merged into one line.
  id: string;
  name: string;
  isCardio: boolean;
  usesBodyweight: boolean;
  sets: ShareCardSet[];
}

export interface ShareCardInput {
  title: string;
  date: string;
  // Calendar day of the session as YYYY-MM-DD, for the file name.
  dateKey: string;
  durationMin: number | null;
  avgHr: number | null;
  maxHr: number | null;
  exercises: ShareCardExercise[];
}

export interface ShareCardLabels {
  duration: string;
  minutes: (count: number) => string;
  totalVolume: string;
  avgHr: string;
  maxHr: string;
  bpm: (value: number) => string;
  bodyweight: string;
  more: (count: number) => string;
  noSets: string;
}

export interface ShareCardOptions {
  unit: WeightUnit;
  locale: string;
  // The user's bodyweight in kg, when known: it ranks the sets of a
  // bodyweight exercise and counts in the total volume, as on the page.
  bodyweight: number | null;
  labels: ShareCardLabels;
}

export interface ShareCardStat {
  label: string;
  value: string;
}

export interface ShareCardLine {
  name: string;
  detail: string;
}

// Plain strings only: the server page builds it and hands it to the client
// button as a prop.
export interface ShareCardData {
  appName: string;
  title: string;
  date: string;
  stats: ShareCardStat[];
  exercises: ShareCardLine[];
  // "+3 more" when the list was cut, otherwise null.
  more: string | null;
  // Shown in place of the list when the session has no set.
  empty: string | null;
  fileName: string;
}

// Same exercise logged as several groups -> one entry, first position kept.
function mergeExercises(exercises: ShareCardExercise[]): ShareCardExercise[] {
  const merged = new Map<string, ShareCardExercise>();
  for (const exercise of exercises) {
    if (exercise.sets.length === 0) continue;
    const existing = merged.get(exercise.id);
    if (existing) existing.sets.push(...exercise.sets);
    else merged.set(exercise.id, { ...exercise, sets: [...exercise.sets] });
  }
  return [...merged.values()];
}

// The best set of a strength exercise: highest estimated 1RM (on the
// effective load, bodyweight included when known), then most reps, then
// heaviest. Warm-ups only count when nothing else was logged.
export function bestStrengthSet(
  exercise: Pick<ShareCardExercise, 'usesBodyweight' | 'sets'>,
  bodyweight: number | null,
): ShareCardSet | null {
  const working = exercise.sets.filter((s) => !s.isWarmup);
  const candidates = working.length > 0 ? working : exercise.sets;
  const effective = applyBodyweight(
    candidates.map((s) => ({ ...s, usesBodyweight: exercise.usesBodyweight })),
    bodyweight,
  );
  let best: number | null = null;
  for (let i = 0; i < candidates.length; i++) {
    if (best == null) {
      best = i;
      continue;
    }
    const a = effective[i]!;
    const b = effective[best]!;
    const byE1rm = estimate1RM(a.weight, a.reps) - estimate1RM(b.weight, b.reps);
    const diff = byE1rm || a.reps - b.reps || a.weight - b.weight;
    if (diff > 0) best = i;
  }
  return best == null ? null : candidates[best]!;
}

function formatStrengthSet(
  set: ShareCardSet,
  usesBodyweight: boolean,
  { unit, locale, labels }: ShareCardOptions,
): string {
  const weight = (kg: number) => formatWeight(kg, unit, { decimals: 2, group: false, locale });
  let load: string;
  if (set.weight === 0) {
    load = labels.bodyweight;
  } else if (usesBodyweight) {
    // The stored weight is the external load on top of bodyweight: added
    // (weighted dip) or, when negative, assisted.
    load = `${labels.bodyweight}${set.weight > 0 ? '+' : '-'}${weight(Math.abs(set.weight))}`;
  } else {
    load = weight(set.weight);
  }
  return `${load} x ${set.reps}`;
}

function exerciseDetail(exercise: ShareCardExercise, options: ShareCardOptions): string {
  if (exercise.isCardio) {
    const { durationSec, distanceM } = sumCardioWorkingSets(exercise.sets);
    return durationSec > 0 ? formatCardioSet(durationSec, distanceM) : '-';
  }
  const best = bestStrengthSet(exercise, options.bodyweight);
  return best ? formatStrengthSet(best, exercise.usesBodyweight, options) : '-';
}

export function buildShareCard(input: ShareCardInput, options: ShareCardOptions): ShareCardData {
  const { unit, locale, labels } = options;
  const exercises = mergeExercises(input.exercises);

  const volume = totalVolume(
    applyBodyweight(
      exercises.flatMap((exercise) =>
        exercise.sets.map((s) => ({
          weight: s.weight,
          reps: s.reps,
          isWarmup: s.isWarmup,
          durationSec: s.durationSec,
          usesBodyweight: exercise.usesBodyweight,
        })),
      ),
      options.bodyweight,
    ),
  );

  const stats: ShareCardStat[] = [];
  if (input.durationMin != null) {
    stats.push({ label: labels.duration, value: labels.minutes(input.durationMin) });
  }
  // A cardio-only session has no tonnage: no "0 kg" tile.
  if (volume > 0) {
    stats.push({
      label: labels.totalVolume,
      value: formatWeight(volume, unit, { decimals: 0, locale }),
    });
  }
  if (input.avgHr != null) stats.push({ label: labels.avgHr, value: labels.bpm(input.avgHr) });
  if (input.maxHr != null) stats.push({ label: labels.maxHr, value: labels.bpm(input.maxHr) });

  const shown = exercises.slice(0, SHARE_CARD_MAX_EXERCISES);
  const hidden = exercises.length - shown.length;

  return {
    appName: SHARE_CARD_APP_NAME,
    title: input.title,
    date: input.date,
    stats,
    exercises: shown.map((exercise) => ({
      name: exercise.name,
      detail: exerciseDetail(exercise, options),
    })),
    more: hidden > 0 ? labels.more(hidden) : null,
    empty: exercises.length === 0 ? labels.noSets : null,
    fileName: `gymcoach-${input.dateKey}.png`,
  };
}

// Built from its code point so the source stays ASCII.
export const ELLIPSIS = String.fromCharCode(0x2026);

// Cuts `text` so it fits `maxWidth`, ending with an ellipsis when something
// was removed. `measure` is the canvas text measurer (injected, so this is
// testable without a canvas). Cuts on code points, never inside a surrogate
// pair, and returns '' when not even the ellipsis fits.
export function fitText(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
): string {
  if (measure(text) <= maxWidth) return text;
  const chars = Array.from(text);
  // Largest prefix that fits with the ellipsis, by binary search.
  let low = 0;
  let high = chars.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = chars.slice(0, mid).join('').trimEnd() + ELLIPSIS;
    if (measure(candidate) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  const result = chars.slice(0, low).join('').trimEnd() + ELLIPSIS;
  return measure(result) <= maxWidth ? result : '';
}
