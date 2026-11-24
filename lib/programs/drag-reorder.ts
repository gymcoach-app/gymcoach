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

// Space kept between the end of the list and the edge of the visible area
// when autoscroll stops, so the drop line before the first block (or after
// the last) is never flush against, or under, that edge.
export const AUTO_SCROLL_LIST_MARGIN_PX = 16;

// Stops an autoscroll step at the list's own ends: the page scrolls up only
// while the top of the list is above the visible area, down only while its
// bottom is below it, and never further than what is left to reveal. `view`
// is the visible part of the viewport (below a sticky header, for instance),
// in the same coordinates as `list`.
export function limitAutoScroll(
  speed: number,
  list: BlockSpan,
  view: BlockSpan,
  margin: number = AUTO_SCROLL_LIST_MARGIN_PX,
): number {
  if (speed < 0) {
    const hidden = view.top + margin - list.top;
    return hidden > 0 ? Math.max(speed, -hidden) : 0;
  }
  if (speed > 0) {
    const hidden = list.bottom - (view.bottom - margin);
    return hidden > 0 ? Math.min(speed, hidden) : 0;
  }
  return 0;
}

// Speeds above are pixels per frame at 60 Hz. This is the factor for a frame
// that took `elapsedMs`, so a 120 Hz screen does not scroll twice as fast. A
// long pause (a background tab, a slow frame) counts for three frames at
// most, and an unknown duration for one.
const FRAME_MS = 1000 / 60;
const MAX_FRAME_MS = 3 * FRAME_MS;

export function frameScale(elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 1;
  return Math.min(elapsedMs, MAX_FRAME_MS) / FRAME_MS;
}

// Whether a drop line at `y` can be seen in the visible area. A drop is only
// offered where its line shows: a position hidden under a sticky header or
// outside the viewport is not one the user chose.
export function isDropLineVisible(y: number, view: BlockSpan): boolean {
  return y >= view.top && y <= view.bottom;
}

// A stable description of the blocks, to notice that the list changed under
// a drag (rows reordered, added, removed, paired or unpaired).
export function blocksSignature(blocks: string[][]): string {
  return blocks.map((block) => block.join(',')).join('|');
}
