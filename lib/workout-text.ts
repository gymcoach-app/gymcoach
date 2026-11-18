import { formatCardioSet, type DistanceUnit } from '@/lib/cardio';
import type { WeightUnit } from '@/lib/prisma-client';
import { formatWeight } from '@/lib/units';

// Plain-text recap of a finished session (issue #405), for pasting into a
// chat, a forum training log or a coach's DM. Pure: the caller resolves the
// localized names, the date and the labels, so the same function serves every
// locale and is unit-testable without a translator.

export interface WorkoutTextSet {
  setNumber: number;
  weight: number;
  reps: number;
  isWarmup: boolean;
  isDropSet: boolean;
  durationSec: number | null;
  distanceM: number | null;
  notes: string | null;
}

export interface WorkoutTextExercise {
  name: string;
  isCardio: boolean;
  usesBodyweight: boolean;
  sets: WorkoutTextSet[];
}

export interface WorkoutTextLabels {
  warmup: string;
  dropSet: string;
  bodyweight: string;
  setNote: (setNumber: number) => string;
  notes: string;
}

export interface WorkoutTextInput {
  title: string;
  date: string;
  notes: string | null;
  exercises: WorkoutTextExercise[];
}

export interface WorkoutTextOptions {
  unit: WeightUnit;
  // Unit cardio distance reads in (issue #582). Default: kilometers.
  distanceUnit?: DistanceUnit;
  locale: string;
  labels: WorkoutTextLabels;
}

function formatLoad(
  set: WorkoutTextSet,
  usesBodyweight: boolean,
  { unit, locale, labels }: WorkoutTextOptions,
): string {
  const weight = (kg: number) => formatWeight(kg, unit, { decimals: 2, group: false, locale });
  if (usesBodyweight) {
    // The stored weight is the external load on top of bodyweight: added
    // (weighted dip) or, when negative, assisted.
    if (set.weight === 0) return labels.bodyweight;
    const sign = set.weight > 0 ? '+' : '-';
    return `${labels.bodyweight}${sign}${weight(Math.abs(set.weight))}`;
  }
  return set.weight === 0 ? labels.bodyweight : weight(set.weight);
}

function formatSet(
  set: WorkoutTextSet,
  exercise: WorkoutTextExercise,
  options: WorkoutTextOptions,
): string {
  // A cardio set saved without a duration reads as "-", as in the page's
  // cardio table, rather than as a "BW x 0" strength set.
  const body = exercise.isCardio
    ? set.durationSec != null
      ? formatCardioSet(set.durationSec, set.distanceM, options.distanceUnit)
      : '-'
    : `${formatLoad(set, exercise.usesBodyweight, options)} x ${set.reps}`;
  const kind = set.isWarmup
    ? options.labels.warmup
    : set.isDropSet
      ? options.labels.dropSet
      : null;
  return kind ? `${body} (${kind})` : body;
}

export function formatWorkoutText(input: WorkoutTextInput, options: WorkoutTextOptions): string {
  const lines = [`${input.title} - ${input.date}`];
  for (const exercise of input.exercises) {
    if (exercise.sets.length === 0) continue;
    lines.push('');
    lines.push(
      `${exercise.name}: ${exercise.sets.map((set) => formatSet(set, exercise, options)).join(', ')}`,
    );
    for (const set of exercise.sets) {
      const note = set.notes?.trim();
      if (note) lines.push(`  ${options.labels.setNote(set.setNumber)} ${note}`);
    }
  }
  const notes = input.notes?.trim();
  if (notes) {
    lines.push('');
    lines.push(`${options.labels.notes} ${notes}`);
  }
  return lines.join('\n');
}
