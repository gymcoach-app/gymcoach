// Printable workout sheet (issue #333). A pure presentation of a program
// workout: one row per exercise, in superset presentation order, with an empty
// weight / reps / RIR cell per planned set so the lifter can fill the sheet by
// hand at the gym. No I/O, no locale: the caller formats labels.

import type { ExerciseCategory } from '@/lib/prisma-client';
import { buildSupersetView, type SupersetItem } from '@/lib/supersets';
import { formatCardioTarget, isCardioExercise } from '@/lib/cardio-target';

export const PRINT_SHEET_CELL_KINDS = ['weight', 'reps', 'rir'] as const;
export type PrintSheetCellKind = (typeof PRINT_SHEET_CELL_KINDS)[number];

export interface PrintSheetExerciseInput extends SupersetItem {
  id: string;
  // `category` decides whether the row prints as cardio (issue #558); a
  // caller that does not pass it gets the strength plan, as before.
  exercise: { name: string; category?: ExerciseCategory };
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetRIR: number;
  restSec: number;
  tempo: string | null;
  notes: string | null;
  targetDurationSec?: number | null;
  targetDistanceM?: number | null;
}

export interface PrintSheetCell {
  set: number;
  kind: PrintSheetCellKind;
}

export interface PrintSheetRow {
  id: string;
  name: string;
  /** Derived superset label (A1, A2, ...) or null for a standalone exercise. */
  supersetLabel: string | null;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetRIR: number;
  restSec: number;
  tempo: string | null;
  notes: string | null;
  /** True for a CARDIO exercise: its plan is not sets, reps and effort. */
  cardio: boolean;
  /** "20 min" or "20 min · 5 km" for a cardio row with a target, else null. */
  cardioTarget: string | null;
  /** targetSets x 3 empty cells, set-major (set 1 weight, set 1 reps, ...). */
  cells: PrintSheetCell[];
}

export interface PrintSheet {
  rows: PrintSheetRow[];
  /** Widest set count on the sheet: the number of set columns to draw. */
  maxSets: number;
  /** Total number of empty cells (every row's sets x 3). */
  cellCount: number;
}

/** Empty per-set cells for one exercise. A non-positive set count yields none. */
export function buildSetCells(targetSets: number): PrintSheetCell[] {
  const sets = Math.max(0, Math.floor(targetSets));
  const cells: PrintSheetCell[] = [];
  for (let set = 1; set <= sets; set += 1) {
    for (const kind of PRINT_SHEET_CELL_KINDS) cells.push({ set, kind });
  }
  return cells;
}

export function buildPrintSheet(exercises: PrintSheetExerciseInput[]): PrintSheet {
  const view = buildSupersetView(exercises);
  const rows = view.ordered.map<PrintSheetRow>((pe) => {
    const cardio =
      pe.exercise.category != null && isCardioExercise({ category: pe.exercise.category });
    return {
      id: pe.id,
      name: pe.exercise.name,
      supersetLabel: view.labels.get(pe.id) ?? null,
      targetSets: pe.targetSets,
      targetRepsMin: pe.targetRepsMin,
      targetRepsMax: pe.targetRepsMax,
      targetRIR: pe.targetRIR,
      restSec: pe.restSec,
      tempo: pe.tempo,
      notes: pe.notes,
      cardio,
      cardioTarget: cardio ? formatCardioTarget(pe) : null,
      cells: buildSetCells(pe.targetSets),
    };
  });
  const maxSets = rows.reduce(
    (max, row) => Math.max(max, row.cells.length / PRINT_SHEET_CELL_KINDS.length),
    0,
  );
  const cellCount = rows.reduce((sum, row) => sum + row.cells.length, 0);
  return { rows, maxSets, cellCount };
}

/** Cells of one row grouped by set number, so a renderer can draw one column per set. */
export function cellsBySet(row: PrintSheetRow, set: number): PrintSheetCell[] {
  return row.cells.filter((cell) => cell.set === set);
}
