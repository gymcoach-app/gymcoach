// Printable workout sheet (issue #333). A pure presentation of a program
// workout: one row per exercise, in superset presentation order, with an empty
// weight / reps / RIR cell per planned set so the lifter can fill the sheet by
// hand at the gym. A cardio row gets a duration and a distance cell instead,
// with its target pre-printed (issue #576). No I/O: the caller formats labels
// and passes the locale the cardio target is written in.

import type { ExerciseCategory } from '@/lib/prisma-client';
import { buildSupersetView, type SupersetItem } from '@/lib/supersets';
import {
  formatCardioTarget,
  formatCardioTargetParts,
  isCardioExercise,
  type CardioTargetFormatOptions,
} from '@/lib/cardio-target';

export const PRINT_SHEET_CELL_KINDS = ['weight', 'reps', 'rir'] as const;
// Cells of a cardio row (issue #576): what is logged for cardio is a duration
// and a distance, never a load, a rep count or an effort rating.
export const PRINT_SHEET_CARDIO_CELL_KINDS = ['duration', 'distance'] as const;
export type PrintSheetCellKind =
  | (typeof PRINT_SHEET_CELL_KINDS)[number]
  | (typeof PRINT_SHEET_CARDIO_CELL_KINDS)[number];

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
  // Intensity of the cardio target (issue #558, slice 2), printed in the plan.
  targetRpe?: number | null;
  targetHrMin?: number | null;
  targetHrMax?: number | null;
}

export interface PrintSheetCell {
  set: number;
  kind: PrintSheetCellKind;
  /**
   * Target pre-printed in the box ("20 min", "5 km"). Only on a cardio cell
   * whose row has that target; a strength cell never carries the key.
   */
  target?: string;
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
  /**
   * "20 min", "20 min · 5 km" or "20 min · RPE 6 · 140-150 bpm" for a cardio
   * row with a target, else null.
   */
  cardioTarget: string | null;
  /**
   * Empty cells, set-major. A strength row has targetSets x 3 (set 1 weight,
   * set 1 reps, set 1 rir, ...); a cardio row has targetSets x 2 (set 1
   * duration, set 1 distance, ...).
   */
  cells: PrintSheetCell[];
}

export interface PrintSheet {
  rows: PrintSheetRow[];
  /** Widest set count on the sheet: the number of set columns to draw. */
  maxSets: number;
  /** Total number of cells (sets x 3 per strength row, sets x 2 per cardio row). */
  cellCount: number;
}

/** How the cardio targets of a sheet are written: reader's locale, distance unit. */
export type PrintSheetOptions = CardioTargetFormatOptions;

/** Empty per-set cells for one exercise. A non-positive set count yields none. */
export function buildSetCells(targetSets: number): PrintSheetCell[] {
  const sets = Math.max(0, Math.floor(targetSets));
  const cells: PrintSheetCell[] = [];
  for (let set = 1; set <= sets; set += 1) {
    for (const kind of PRINT_SHEET_CELL_KINDS) cells.push({ set, kind });
  }
  return cells;
}

/**
 * Duration and distance cells for one cardio exercise, per planned set, each
 * carrying its half of the target when the row has one.
 */
export function buildCardioCells(
  targetSets: number,
  target: { duration: string | null; distance: string | null } = { duration: null, distance: null },
): PrintSheetCell[] {
  const sets = Math.max(0, Math.floor(targetSets));
  const cells: PrintSheetCell[] = [];
  for (let set = 1; set <= sets; set += 1) {
    for (const kind of PRINT_SHEET_CARDIO_CELL_KINDS) {
      const text = target[kind];
      cells.push(text != null ? { set, kind, target: text } : { set, kind });
    }
  }
  return cells;
}

export function buildPrintSheet(
  exercises: PrintSheetExerciseInput[],
  options: PrintSheetOptions = {},
): PrintSheet {
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
      cardioTarget: cardio ? formatCardioTarget(pe, options) : null,
      cells: cardio
        ? buildCardioCells(pe.targetSets, formatCardioTargetParts(pe, options))
        : buildSetCells(pe.targetSets),
    };
  });
  // Cells are set-major, so the last cell of a row carries its set count
  // whatever the number of cells per set.
  const maxSets = rows.reduce((max, row) => Math.max(max, row.cells.at(-1)?.set ?? 0), 0);
  const cellCount = rows.reduce((sum, row) => sum + row.cells.length, 0);
  return { rows, maxSets, cellCount };
}

/** Cells of one row grouped by set number, so a renderer can draw one column per set. */
export function cellsBySet(row: PrintSheetRow, set: number): PrintSheetCell[] {
  return row.cells.filter((cell) => cell.set === set);
}
