// Blocks of a deliberately repeated exercise (issue #429).
//
// A workout may program the same exercise more than once: the built-in 5/3/1
// Boring But Big template does the main lift's 5/3/1 sets, then 5x10 of the
// same lift. A Set carries an exerciseId, so without more information both
// program rows would share one set pool. Set.block records which occurrence a
// set was logged against: the 0-based index, in workout order, of the row
// among the rows of the workout that hold the same exercise.
//
// The value is only meaningful for an exercise the workout holds more than
// once. It is NULL otherwise and on every set written before the column
// existed, and NULL reads as the first occurrence. So a workout without a
// repeat behaves exactly as before: every key below is the bare exerciseId.

export interface BlockRow {
  id: string;
  exerciseId: string;
  order: number;
}

// Hard bound for a stored block index, enforced by the set schema. A workout
// holding the same exercise more than this many times is not a real program.
export const MAX_EXERCISE_BLOCK = 19;

// For each program row, its block index when the workout holds its exercise
// more than once, else null. Occurrences are ranked by `order`, then by id so
// equal orders (possible after hand edits) still rank deterministically.
export function blockIndexByRow(rows: readonly BlockRow[]): Map<string, number | null> {
  const byExercise = new Map<string, BlockRow[]>();
  for (const row of rows) {
    const list = byExercise.get(row.exerciseId);
    if (list) list.push(row);
    else byExercise.set(row.exerciseId, [row]);
  }
  const out = new Map<string, number | null>();
  for (const list of byExercise.values()) {
    const [only] = list;
    if (list.length === 1 && only) {
      out.set(only.id, null);
      continue;
    }
    const ranked = [...list].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    ranked.forEach((row, index) => out.set(row.id, index));
  }
  return out;
}

// How many times the workout holds each exercise.
export function occurrenceCounts(rows: readonly { exerciseId: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) out.set(row.exerciseId, (out.get(row.exerciseId) ?? 0) + 1);
  return out;
}

// The block a set belongs to, given how often its exercise occurs in the
// workout: null for an exercise that occurs once (whatever the set stored), a
// stored index within range, and the first occurrence for NULL or an index
// past the end (a row removed since the set was logged).
export function effectiveSetBlock(
  block: number | null | undefined,
  occurrences: number,
): number | null {
  if (occurrences <= 1) return null;
  if (block == null || !Number.isInteger(block) || block < 0 || block >= occurrences) return 0;
  return block;
}

// Grouping key for one block: the bare exerciseId when the exercise is not
// repeated, so single-occurrence keys are unchanged from before #429.
export function blockKey(exerciseId: string, block: number | null): string {
  return block == null ? exerciseId : `${exerciseId}#${block}`;
}

// The block key of a set within a workout whose occurrence counts are known.
export function setBlockKey(
  set: { exerciseId: string; block?: number | null },
  counts: ReadonlyMap<string, number>,
): string {
  return blockKey(set.exerciseId, effectiveSetBlock(set.block, counts.get(set.exerciseId) ?? 0));
}

// The block key of a program row.
export function rowBlockKey(
  row: { id: string; exerciseId: string },
  blocks: ReadonlyMap<string, number | null>,
): string {
  return blockKey(row.exerciseId, blocks.get(row.id) ?? null);
}
