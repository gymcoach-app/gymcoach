// ============================================================
// Drag-and-drop reordering (issue #557, step 2) - pure helpers
// ============================================================
// The program editor drags BLOCKS, like "Move up" / "Move down" (step 1,
// lib/supersets.ts): a real superset is one block, a standalone exercise a
// block of one. While a block is dragged the list does not reflow; the other
// blocks stay where they are and an indicator line shows the gap the block
// would land in. So a drop is fully described by one number, the DROP INDEX:
// the position of the dragged block among the OTHER blocks (0 = before the
// first of them, others.length = after the last). A gap only ever exists
// between two blocks, which is why a superset can neither be split nor
// dropped into.
//
// Everything here is pure geometry and list work, so it is unit-tested
// without a DOM; the component (components/programs/use-drag-reorder.ts)
// only measures rectangles and forwards pointer positions.

import { supersetBlocks, type SupersetItem } from '@/lib/supersets';

// The vertical extent of one block on screen, in any consistent coordinate
// space (the hook uses viewport coordinates).
export interface BlockSpan {
  top: number;
  bottom: number;
}

// Drop index for a pointer at `pointerY`: the number of other blocks whose
// vertical middle is above the pointer. `others` are the spans of every block
// except the dragged one, top to bottom.
export function dropIndexForPointer(others: BlockSpan[], pointerY: number): number {
  let index = 0;
  for (const span of others) {
    if (pointerY > (span.top + span.bottom) / 2) index += 1;
  }
  return index;
}

// Where to draw the indicator line for a drop index: the middle of the gap
// before `others[dropIndex]`, or of the gap after the last block. `gap` is
// the space between two blocks. Null when there is no other block.
export function dropIndicatorY(others: BlockSpan[], dropIndex: number, gap: number): number | null {
  if (others.length === 0) return null;
  const next = others[dropIndex];
  if (next) return next.top - gap / 2;
  return others[others.length - 1]!.bottom + gap / 2;
}

// Ids of the workout in presentation order after dropping the block that
// holds `id` at `dropIndex` (see above). Null when there is nothing to save:
// unknown id, or the block lands where it already is. An out-of-range index
// is clamped, so a pointer far above or below the list means first or last.
export function dropExerciseBlock<T extends SupersetItem>(
  items: T[],
  id: string,
  dropIndex: number,
): string[] | null {
  const blocks = supersetBlocks(items);
  const from = blocks.findIndex((block) => block.some((it) => it.id === id));
  if (from === -1 || !Number.isFinite(dropIndex)) return null;
  const others = blocks.filter((_, index) => index !== from);
  const to = Math.min(Math.max(Math.round(dropIndex), 0), others.length);
  if (to === from) return null;
  const moved = [...others.slice(0, to), blocks[from]!, ...others.slice(to)];
  const ids: string[] = [];
  for (const block of moved) {
    for (const it of block) ids.push(it.id);
  }
  return ids;
}

// How far the dragged block may travel from where it was grabbed, so it never
// leaves the list: [min, max] offsets in pixels (min <= 0 <= max).
export function dragOffsetBounds(block: BlockSpan, list: BlockSpan): { min: number; max: number } {
  return {
    min: Math.min(0, list.top - block.top),
    max: Math.max(0, list.bottom - block.bottom),
  };
}

export function clampOffset(offset: number, bounds: { min: number; max: number }): number {
  return Math.min(Math.max(offset, bounds.min), bounds.max);
}

// Autoscroll while dragging near the top or bottom of the viewport: pixels to
// scroll per animation frame, negative upwards. Zero outside the two edge
// zones; inside one, the speed grows linearly up to `maxSpeed` at the very
// edge (and stays there beyond it).
export const AUTO_SCROLL_EDGE_PX = 64;
export const AUTO_SCROLL_MAX_SPEED_PX = 14;

export function autoScrollSpeed(
  pointerY: number,
  viewportHeight: number,
  edge: number = AUTO_SCROLL_EDGE_PX,
  maxSpeed: number = AUTO_SCROLL_MAX_SPEED_PX,
): number {
  if (!(viewportHeight > 0) || !(edge > 0)) return 0;
  // A viewport shorter than two edge zones would scroll both ways at once.
  const zone = Math.min(edge, viewportHeight / 2);
  if (pointerY < zone) {
    const depth = Math.min(1, (zone - pointerY) / zone);
    return -Math.ceil(depth * maxSpeed);
  }
  if (pointerY > viewportHeight - zone) {
    const depth = Math.min(1, (pointerY - (viewportHeight - zone)) / zone);
    return Math.ceil(depth * maxSpeed);
  }
  return 0;
}
