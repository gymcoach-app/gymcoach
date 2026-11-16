// ============================================================
// Supersets (issue #146, slice 1) - program-level pairing
// ============================================================
// Exercises of one workout sharing the same ProgramExercise.supersetGroup
// number form a superset; null means standalone. The stored numbers are
// arbitrary bookkeeping: everything user-facing (A1/A2 labels, presentation
// order) is derived on read by these pure helpers, so unpairing or deleting
// a member never requires renumbering writes. A group needs at least two
// members to count as a superset - a singleton group renders as standalone.

export interface SupersetItem {
  id: string;
  order: number;
  supersetGroup: number | null;
}

// Bounds shared by the Zod schema and the builder UI: group numbers 1-9,
// i.e. at most 9 supersets per workout (letters A-I).
export const MIN_SUPERSET_GROUP = 1;
export const MAX_SUPERSET_GROUP = 9;

export interface SupersetView<T extends SupersetItem> {
  // Items sorted by `order`, except that members of a real superset group
  // (>= 2 members) are pulled together at the first member's position,
  // keeping their relative order. Standalone items keep their position.
  ordered: T[];
  // item id -> "A1" / "A2" / "B1"... only for members of real groups.
  // Letters follow the order groups first appear in; numbers follow the
  // member order within the group.
  labels: Map<string, string>;
  // item id -> the stored group number, only for members of real groups
  // (singleton groups are treated as standalone and excluded).
  groupById: Map<string, number>;
}

export function buildSupersetView<T extends SupersetItem>(items: T[]): SupersetView<T> {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const memberCount = new Map<number, number>();
  for (const it of sorted) {
    if (it.supersetGroup != null) {
      memberCount.set(it.supersetGroup, (memberCount.get(it.supersetGroup) ?? 0) + 1);
    }
  }

  const ordered: T[] = [];
  const labels = new Map<string, string>();
  const groupById = new Map<string, number>();
  const emitted = new Set<string>();
  let letterIndex = 0;

  for (const it of sorted) {
    if (emitted.has(it.id)) continue;
    const group = it.supersetGroup;
    if (group != null && (memberCount.get(group) ?? 0) >= 2) {
      const letter = String.fromCharCode(65 + letterIndex); // A, B, C...
      letterIndex += 1;
      let memberNumber = 1;
      for (const member of sorted) {
        if (member.supersetGroup === group && !emitted.has(member.id)) {
          ordered.push(member);
          emitted.add(member.id);
          labels.set(member.id, `${letter}${memberNumber}`);
          groupById.set(member.id, group);
          memberNumber += 1;
        }
      }
    } else {
      ordered.push(it);
      emitted.add(it.id);
    }
  }
  return { ordered, labels, groupById };
}

// The contiguous [start, end] index span of the current item's group in the
// presentation order, or null when the item is standalone.
function groupSpan<T extends SupersetItem>(
  view: SupersetView<T>,
  currentIdx: number,
): { start: number; end: number } | null {
  const current = view.ordered[currentIdx];
  if (!current) return null;
  const group = view.groupById.get(current.id);
  if (group == null) return null;
  let start = currentIdx;
  while (start > 0 && view.groupById.get(view.ordered[start - 1]!.id) === group) start -= 1;
  let end = currentIdx;
  while (end + 1 < view.ordered.length && view.groupById.get(view.ordered[end + 1]!.id) === group) {
    end += 1;
  }
  return { start, end };
}

// Where the runner should auto-advance to once the rest after a logged
// working set ends. `remaining` returns how many target working sets are
// still to log for an item (<= 0 when complete), INCLUDING the set just
// logged on the current item.
// - Standalone (unchanged behavior): the next exercise once the current one
//   has completed its target sets, otherwise stay (null).
// - Superset member (the A1/A2 flow): alternate to the next member of the
//   group (cycling) that still has sets remaining; when every member is
//   complete, the exercise right after the group; otherwise stay.
export function nextAutoAdvanceIndex<T extends SupersetItem>(
  view: SupersetView<T>,
  currentIdx: number,
  remaining: (item: T, idx: number) => number,
): number | null {
  const items = view.ordered;
  const current = items[currentIdx];
  if (!current) return null;

  const span = groupSpan(view, currentIdx);
  if (!span) {
    if (remaining(current, currentIdx) > 0) return null;
    return currentIdx + 1 < items.length ? currentIdx + 1 : null;
  }

  const size = span.end - span.start + 1;
  for (let step = 1; step < size; step += 1) {
    const idx = span.start + ((currentIdx - span.start + step) % size);
    if (remaining(items[idx]!, idx) > 0) return idx;
  }
  // Every other member is done: stay while the current one has sets left.
  if (remaining(current, currentIdx) > 0) return null;
  return span.end + 1 < items.length ? span.end + 1 : null;
}

// Where the Next button goes (manual navigation, presentation order).
// - Standalone (unchanged behavior): the next exercise, or null at the end
//   of the workout (button disabled).
// - Superset member: linear within the group; from the LAST member it cycles
//   back to the first OTHER member that still has working sets remaining,
//   and advances past the group otherwise. Deliberately never points at the
//   current item itself, so repeated taps can always leave the group - a
//   user is never trapped cycling in place.
export function nextNavIndex<T extends SupersetItem>(
  view: SupersetView<T>,
  currentIdx: number,
  remaining: (item: T, idx: number) => number,
): number | null {
  const items = view.ordered;
  const current = items[currentIdx];
  if (!current) return null;

  const span = groupSpan(view, currentIdx);
  if (!span) {
    return currentIdx + 1 < items.length ? currentIdx + 1 : null;
  }
  if (currentIdx < span.end) return currentIdx + 1;
  // Last member: cycle back while another member is unfinished.
  for (let idx = span.start; idx < span.end; idx += 1) {
    if (idx !== currentIdx && remaining(items[idx]!, idx) > 0) return idx;
  }
  return span.end + 1 < items.length ? span.end + 1 : null;
}

// ============================================================
// Superset rest (issue #189, slice 2) - transition vs full rest
// ============================================================
// A short transition rest (a few seconds to breathe and switch stations) runs
// between members of a superset group; the full per-exercise rest runs only
// after the LAST member of the group, before the group repeats. Standalone
// exercises always take the full rest.

// Default transition rest between superset members, in seconds. Short on
// purpose - the point of a superset is minimal rest between paired moves - but
// non-zero so the user can breathe and move to the next station.
export const SUPERSET_TRANSITION_REST_SEC = 20;

// Decides which rest follows the set just logged on `currentIdx`, given where
// the runner will auto-advance (`nextIdx`, from nextAutoAdvanceIndex). It is a
// transition rest ONLY when the auto-advance stays inside the current item's
// own superset group (the A1 -> A2 move). Every other case - a standalone
// exercise, the last member of the group (advance past it), or staying put
// (null) to finish the current member's sets - takes the full rest. Pure and
// dependent only on the view, so it unit-tests without the runner.
export function isSupersetTransitionRest<T extends SupersetItem>(
  view: SupersetView<T>,
  currentIdx: number,
  nextIdx: number | null,
): boolean {
  if (nextIdx == null) return false;
  const current = view.ordered[currentIdx];
  const next = view.ordered[nextIdx];
  if (!current || !next) return false;
  const group = view.groupById.get(current.id);
  if (group == null) return false; // standalone -> full rest
  // Same group AND a different member -> moving A1 -> A2 (transition rest).
  return next.id !== current.id && view.groupById.get(next.id) === group;
}

// The smallest free group number of a workout (for "pair with previous" when
// the previous row has no group yet), or null when all are in use.
export function smallestFreeGroup(items: SupersetItem[]): number | null {
  const used = new Set(items.map((i) => i.supersetGroup).filter((g) => g != null));
  for (let g = MIN_SUPERSET_GROUP; g <= MAX_SUPERSET_GROUP; g += 1) {
    if (!used.has(g)) return g;
  }
  return null;
}

// ============================================================
// Reordering (issue #557, step 1) - "Move up" / "Move down"
// ============================================================
// The builder reorders BLOCKS of the presentation order, never single rows:
// a real superset group (>= 2 members) is one block, a standalone exercise
// (a singleton group included) is a block of one. A move swaps the block
// holding the exercise with its neighbouring block, so
// - moving any member of a superset moves the whole superset,
// - a standalone exercise jumps over a whole neighbouring superset,
// - members of a superset stay adjacent and keep their relative order.
// The result is the complete list of ids in the new presentation order; the
// caller stores it as order 1..n, which also makes the stored order match
// what the user sees (members of a group may be apart in the stored order
// before the first move, since the view pulls them together on read).

export type MoveDirection = 'up' | 'down';

// The presentation order cut into blocks (see above), top to bottom.
export function supersetBlocks<T extends SupersetItem>(items: T[]): T[][] {
  const view = buildSupersetView(items);
  const blocks: T[][] = [];
  let previousGroup: number | undefined;
  for (const it of view.ordered) {
    const group = view.groupById.get(it.id);
    const last = blocks[blocks.length - 1];
    if (last && group != null && group === previousGroup) {
      last.push(it);
    } else {
      blocks.push([it]);
    }
    previousGroup = group;
  }
  return blocks;
}

// Ids of the workout in presentation order after moving the block that holds
// `id` one block up or down. Null when there is nothing to do: unknown id, or
// the block is already at that edge (the menu item is disabled then).
export function moveExerciseBlock<T extends SupersetItem>(
  items: T[],
  id: string,
  direction: MoveDirection,
): string[] | null {
  const blocks = supersetBlocks(items);
  const from = blocks.findIndex((block) => block.some((it) => it.id === id));
  if (from === -1) return null;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= blocks.length) return null;
  const moved = [...blocks];
  [moved[from], moved[to]] = [moved[to]!, moved[from]!];
  return moved.flat().map((it) => it.id);
}

// The items with `order` rewritten to 1..n following `orderedIds` (the
// optimistic copy of what the order endpoint stores). Ids missing from the
// list keep their place after the listed ones, in their old order, so a
// stale list can never drop a row from the screen.
export function applyExerciseOrder<T extends SupersetItem>(items: T[], orderedIds: string[]): T[] {
  const position = new Map(orderedIds.map((id, index) => [id, index]));
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const listed = sorted
    .filter((it) => position.has(it.id))
    .sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  const unlisted = sorted.filter((it) => !position.has(it.id));
  return [...listed, ...unlisted].map((it, index) => ({ ...it, order: index + 1 }));
}
