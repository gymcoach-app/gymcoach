import type { ProgramExercise, SetAutoregulationMode } from '@/lib/prisma-client';

// Copies of programs, workouts and finished sessions (issue #394). Pure
// helpers only; the routes run them inside one transaction each.

// Every column of a programmed exercise except its identity and its parent.
// Built by omission rather than by listing fields, so a column added to
// ProgramExercise later is copied without touching this file (the unit test
// checks the copy against the generated scalar field list).
export function programExerciseCopyData(
  pe: ProgramExercise,
): Omit<ProgramExercise, 'id' | 'workoutId'> {
  const { id: _id, workoutId: _workoutId, ...rest } = pe;
  return rest;
}

export const MAX_COPY_NAME_LENGTH = 120;

// A copy's name: the source's STORED name (never its display translation, see
// i18n/training-names.ts) plus a suffix, cut so the whole fits the 120-char
// name limit. The UI passes its localized suffix; the server falls back to the
// English one when the client sends no name.
export function copyName(name: string, suffix = '(copy)'): string {
  const tail = ` ${suffix}`;
  // Drop a lone high surrogate left by the cut, so an emoji is never halved.
  const head = name.slice(0, MAX_COPY_NAME_LENGTH - tail.length).replace(/[\uD800-\uDBFF]$/, '');
  return `${head.trimEnd()}${tail}`;
}

// --- Save a finished session as a workout -----------------------------------

export interface SessionSetForWorkout {
  exerciseId: string;
  reps: number;
  rir: number | null;
  isWarmup: boolean;
  isDropSet: boolean;
  completedAt: Date;
  setNumber: number;
}

// The settings a programmed row of the session's own workout carried, reused
// when the saved workout keeps that exercise.
export type SourceRowSettings = Pick<
  ProgramExercise,
  | 'exerciseId'
  | 'restSec'
  | 'tempo'
  | 'notes'
  | 'autoregulationMode'
  | 'fatigueRate'
  | 'loadAdjustmentPct'
  | 'targetDurationSec'
  | 'targetDistanceM'
>;

export interface WorkoutRowFromSession {
  exerciseId: string;
  order: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetRIR: number;
  restSec: number;
  tempo: string | null;
  notes: string | null;
  autoregulationMode?: SetAutoregulationMode;
  fatigueRate: number | null;
  loadAdjustmentPct: number | null;
  // Cardio target of the session's own programmed row (issue #558), kept so
  // a saved cardio exercise stays prescribed by duration and distance.
  targetDurationSec: number | null;
  targetDistanceM: number | null;
}

const DEFAULT_RIR = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Builds the rows of a workout from what a session actually did: one row per
// exercise with at least one working set, in the order the exercises were
// first trained, with the working-set count, the rep range done and the mean
// RIR logged. Warm-ups and drop sets are not programmed sets. Rest, tempo,
// notes and autoregulation come from the session's own programmed row when
// there is one, else the exercise's default rest.
export function workoutRowsFromSession(
  sets: SessionSetForWorkout[],
  defaultRestByExercise: Map<string, number>,
  sourceRows: SourceRowSettings[],
): WorkoutRowFromSession[] {
  const ordered = [...sets].sort(
    (a, b) => a.completedAt.getTime() - b.completedAt.getTime() || a.setNumber - b.setNumber,
  );
  const working = new Map<string, SessionSetForWorkout[]>();
  for (const set of ordered) {
    if (set.isWarmup || set.isDropSet) continue;
    const list = working.get(set.exerciseId);
    if (list) list.push(set);
    else working.set(set.exerciseId, [set]);
  }

  const sourceByExercise = new Map<string, SourceRowSettings>();
  for (const row of sourceRows) {
    if (!sourceByExercise.has(row.exerciseId)) sourceByExercise.set(row.exerciseId, row);
  }

  const rows: WorkoutRowFromSession[] = [];
  for (const [exerciseId, list] of working) {
    const reps = list.map((s) => s.reps);
    const rirs = list.map((s) => s.rir).filter((r): r is number => r != null);
    const source = sourceByExercise.get(exerciseId);
    // Cardio sets log reps = 1 by convention (lib/cardio.ts); the clamp keeps
    // any row at 1 to 50 reps whatever was logged.
    const repsMin = clamp(Math.min(...reps), 1, 50);
    const repsMax = clamp(Math.max(...reps), repsMin, 50);
    rows.push({
      exerciseId,
      order: rows.length + 1,
      targetSets: clamp(list.length, 1, 20),
      targetRepsMin: repsMin,
      targetRepsMax: repsMax,
      targetRIR:
        rirs.length > 0
          ? clamp(Math.round(rirs.reduce((sum, r) => sum + r, 0) / rirs.length), 0, 5)
          : DEFAULT_RIR,
      restSec: clamp(source?.restSec ?? defaultRestByExercise.get(exerciseId) ?? 90, 15, 600),
      tempo: source?.tempo ?? null,
      notes: source?.notes ?? null,
      autoregulationMode: source?.autoregulationMode,
      fatigueRate: source?.fatigueRate ?? null,
      loadAdjustmentPct: source?.loadAdjustmentPct ?? null,
      targetDurationSec: source?.targetDurationSec ?? null,
      targetDistanceM: source?.targetDistanceM ?? null,
    });
  }
  return rows;
}
