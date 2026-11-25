import { describe, expect, it } from 'vitest';
import { applyExerciseOrder, supersetBlocks, type SupersetItem } from '@/lib/supersets';
import {
  AUTO_SCROLL_MAX_SPEED_PX,
  autoScrollSpeed,
  blocksSignature,
  frameScale,
  isDropLineVisible,
  limitAutoScroll,
  clampOffset,
  dragOffsetBounds,
  dropExerciseBlock,
  dropIndexForPointer,
  dropIndicatorY,
  type BlockSpan,
} from './drag-reorder';

// Drag-and-drop reordering (issue #557, step 2): the pure part. A drop is one
// number, the position of the dragged block among the other blocks.

function item(id: string, order: number, supersetGroup: number | null = null): SupersetItem {
  return { id, order, supersetGroup };
}

// Three other blocks, 60px tall, 8px apart: 0-60, 68-128, 136-196.
const spans: BlockSpan[] = [
  { top: 0, bottom: 60 },
  { top: 68, bottom: 128 },
  { top: 136, bottom: 196 },
];

describe('dropIndexForPointer', () => {
  it('counts the blocks whose middle is above the pointer', () => {
    expect(dropIndexForPointer(spans, -50)).toBe(0);
    expect(dropIndexForPointer(spans, 29)).toBe(0);
    expect(dropIndexForPointer(spans, 31)).toBe(1);
    expect(dropIndexForPointer(spans, 97)).toBe(1);
    expect(dropIndexForPointer(spans, 99)).toBe(2);
    expect(dropIndexForPointer(spans, 167)).toBe(3);
    expect(dropIndexForPointer(spans, 5000)).toBe(3);
  });

  it('stays before a block while the pointer is exactly on its middle', () => {
    expect(dropIndexForPointer(spans, 30)).toBe(0);
  });

  it('is 0 when there is no other block', () => {
    expect(dropIndexForPointer([], 100)).toBe(0);
  });

  it('uses the middle of a tall superset block, not of its first row', () => {
    const tall: BlockSpan[] = [
      { top: 0, bottom: 128 },
      { top: 136, bottom: 196 },
    ];
    expect(dropIndexForPointer(tall, 60)).toBe(0);
    expect(dropIndexForPointer(tall, 70)).toBe(1);
  });
});

describe('dropIndicatorY', () => {
  it('sits in the middle of the gap before the block at the drop index', () => {
    expect(dropIndicatorY(spans, 0, 8)).toBe(-4);
    expect(dropIndicatorY(spans, 1, 8)).toBe(64);
    expect(dropIndicatorY(spans, 2, 8)).toBe(132);
  });

  it('sits after the last block for the last index', () => {
    expect(dropIndicatorY(spans, 3, 8)).toBe(200);
    expect(dropIndicatorY(spans, 99, 8)).toBe(200);
  });

  it('is null when there is no other block', () => {
    expect(dropIndicatorY([], 0, 8)).toBeNull();
  });
});

describe('dropExerciseBlock', () => {
  const standalone = [item('a', 1), item('b', 2), item('c', 3), item('d', 4)];

  it('moves a block to any position in one drop', () => {
    expect(dropExerciseBlock(standalone, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(dropExerciseBlock(standalone, 'd', 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(dropExerciseBlock(standalone, 'a', 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(dropExerciseBlock(standalone, 'b', 2)).toEqual(['a', 'c', 'b', 'd']);
    expect(dropExerciseBlock(standalone, 'c', 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('returns null when the block is dropped where it already is', () => {
    expect(dropExerciseBlock(standalone, 'a', 0)).toBeNull();
    expect(dropExerciseBlock(standalone, 'b', 1)).toBeNull();
    expect(dropExerciseBlock(standalone, 'd', 3)).toBeNull();
    expect(dropExerciseBlock([item('only', 1)], 'only', 0)).toBeNull();
  });

  it('returns null for an unknown id, an empty workout and a non-finite index', () => {
    expect(dropExerciseBlock(standalone, 'nope', 0)).toBeNull();
    expect(dropExerciseBlock([], 'a', 0)).toBeNull();
    expect(dropExerciseBlock(standalone, 'a', Number.NaN)).toBeNull();
    expect(dropExerciseBlock(standalone, 'a', Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('clamps an out-of-range index to the first or last position', () => {
    expect(dropExerciseBlock(standalone, 'c', -7)).toEqual(['c', 'a', 'b', 'd']);
    expect(dropExerciseBlock(standalone, 'b', 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(dropExerciseBlock(standalone, 'd', 99)).toBeNull();
  });

  it('follows the stored order, not the array order', () => {
    expect(dropExerciseBlock([item('c', 3), item('a', 1), item('b', 2)], 'c', 0)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('agrees with a chain of single moves once the order is applied', () => {
    const ids = dropExerciseBlock(standalone, 'd', 0)!;
    const applied = applyExerciseOrder(standalone, ids);
    expect(applied.map((it) => `${it.id}:${it.order}`)).toEqual(['d:1', 'a:2', 'b:3', 'c:4']);
    expect(dropExerciseBlock(applied, 'd', 0)).toBeNull();
  });

  describe('with supersets', () => {
    const mixed = [
      item('warmup', 1),
      item('a1', 2, 1),
      item('a2', 3, 1),
      item('solo', 4),
      item('b1', 5, 2),
      item('b2', 6, 2),
    ];

    it('moves the whole superset whichever member was grabbed', () => {
      const expected = ['a1', 'a2', 'warmup', 'solo', 'b1', 'b2'];
      expect(dropExerciseBlock(mixed, 'a1', 0)).toEqual(expected);
      expect(dropExerciseBlock(mixed, 'a2', 0)).toEqual(expected);
      expect(dropExerciseBlock(mixed, 'a2', 3)).toEqual(['warmup', 'solo', 'b1', 'b2', 'a1', 'a2']);
    });

    it('drops a standalone exercise around a superset, never inside it', () => {
      // The other blocks of "solo" are warmup, A and B: four gaps, none of
      // them between two members.
      expect(dropExerciseBlock(mixed, 'solo', 0)).toEqual([
        'solo',
        'warmup',
        'a1',
        'a2',
        'b1',
        'b2',
      ]);
      expect(dropExerciseBlock(mixed, 'solo', 1)).toEqual([
        'warmup',
        'solo',
        'a1',
        'a2',
        'b1',
        'b2',
      ]);
      expect(dropExerciseBlock(mixed, 'solo', 2)).toBeNull();
      expect(dropExerciseBlock(mixed, 'solo', 3)).toEqual([
        'warmup',
        'a1',
        'a2',
        'b1',
        'b2',
        'solo',
      ]);
    });

    it('keeps every superset whole and in member order for every possible drop', () => {
      const blocksBefore = supersetBlocks(mixed).map((block) => block.map((it) => it.id).join('+'));
      for (const dragged of mixed) {
        for (let index = -1; index <= blocksBefore.length; index += 1) {
          const ids = dropExerciseBlock(mixed, dragged.id, index);
          if (!ids) continue;
          expect([...ids].sort()).toEqual(mixed.map((it) => it.id).sort());
          const blocksAfter = supersetBlocks(applyExerciseOrder(mixed, ids)).map((block) =>
            block.map((it) => it.id).join('+'),
          );
          expect([...blocksAfter].sort()).toEqual([...blocksBefore].sort());
        }
      }
    });

    it('gathers members that are apart in the stored order', () => {
      const apart = [item('a1', 1, 1), item('solo', 2), item('a2', 3, 1)];
      expect(dropExerciseBlock(apart, 'solo', 0)).toEqual(['solo', 'a1', 'a2']);
      // Already last on screen: the stored order is left alone.
      expect(dropExerciseBlock(apart, 'solo', 1)).toBeNull();
    });

    it('treats a singleton group as a standalone block', () => {
      const single = [item('a', 1, 4), item('b', 2), item('c', 3)];
      expect(dropExerciseBlock(single, 'a', 2)).toEqual(['b', 'c', 'a']);
    });
  });
});

describe('dragOffsetBounds and clampOffset', () => {
  const list: BlockSpan = { top: 100, bottom: 400 };

  it('lets a block travel to both ends of the list and no further', () => {
    const bounds = dragOffsetBounds({ top: 200, bottom: 260 }, list);
    expect(bounds).toEqual({ min: -100, max: 140 });
    expect(clampOffset(-500, bounds)).toBe(-100);
    expect(clampOffset(-30, bounds)).toBe(-30);
    expect(clampOffset(500, bounds)).toBe(140);
  });

  it('never pushes a block that already touches an edge', () => {
    expect(dragOffsetBounds({ top: 100, bottom: 160 }, list).min).toBe(0);
    expect(dragOffsetBounds({ top: 340, bottom: 400 }, list).max).toBe(0);
    // Unmeasured rectangles (all zeros) give no travel instead of NaN.
    expect(dragOffsetBounds({ top: 0, bottom: 0 }, { top: 0, bottom: 0 })).toEqual({
      min: 0,
      max: 0,
    });
  });
});

describe('autoScrollSpeed', () => {
  it('is zero away from the edges', () => {
    expect(autoScrollSpeed(400, 800)).toBe(0);
    expect(autoScrollSpeed(64, 800)).toBe(0);
    expect(autoScrollSpeed(736, 800)).toBe(0);
  });

  it('scrolls up near the top, faster closer to the edge', () => {
    const slow = autoScrollSpeed(60, 800);
    const fast = autoScrollSpeed(4, 800);
    expect(slow).toBeLessThan(0);
    expect(fast).toBeLessThan(slow);
    expect(autoScrollSpeed(0, 800)).toBe(-AUTO_SCROLL_MAX_SPEED_PX);
    expect(autoScrollSpeed(-200, 800)).toBe(-AUTO_SCROLL_MAX_SPEED_PX);
  });

  it('scrolls down near the bottom, faster closer to the edge', () => {
    const slow = autoScrollSpeed(740, 800);
    const fast = autoScrollSpeed(796, 800);
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(autoScrollSpeed(800, 800)).toBe(AUTO_SCROLL_MAX_SPEED_PX);
    expect(autoScrollSpeed(2000, 800)).toBe(AUTO_SCROLL_MAX_SPEED_PX);
  });

  it('never scrolls both ways in a very short viewport', () => {
    expect(autoScrollSpeed(50, 100)).toBe(0);
    expect(autoScrollSpeed(10, 100)).toBeLessThan(0);
    expect(autoScrollSpeed(90, 100)).toBeGreaterThan(0);
  });

  it('is zero for a viewport or edge that makes no sense', () => {
    expect(autoScrollSpeed(10, 0)).toBe(0);
    expect(autoScrollSpeed(10, Number.NaN)).toBe(0);
    expect(autoScrollSpeed(10, 800, 0)).toBe(0);
  });
});

describe('limitAutoScroll', () => {
  const view: BlockSpan = { top: 100, bottom: 800 };

  it('scrolls up only while the top of the list is hidden', () => {
    expect(limitAutoScroll(-14, { top: -300, bottom: 400 }, view)).toBe(-14);
    // 16px of margin are kept above the list: 10px left to reveal.
    expect(limitAutoScroll(-14, { top: 106, bottom: 900 }, view)).toBe(-10);
    expect(limitAutoScroll(-14, { top: 116, bottom: 900 }, view)).toBe(0);
    expect(limitAutoScroll(-14, { top: 300, bottom: 900 }, view)).toBe(0);
  });

  it('scrolls down only while the bottom of the list is hidden', () => {
    expect(limitAutoScroll(14, { top: 0, bottom: 1500 }, view)).toBe(14);
    expect(limitAutoScroll(14, { top: 0, bottom: 790 }, view)).toBe(6);
    expect(limitAutoScroll(14, { top: 0, bottom: 784 }, view)).toBe(0);
    expect(limitAutoScroll(14, { top: 0, bottom: 300 }, view)).toBe(0);
  });

  it('finishes on a whole pixel when a fraction of one is left', () => {
    // Rectangles are fractional on a zoomed or high-density screen.
    expect(limitAutoScroll(-14, { top: 115.6, bottom: 900 }, view)).toBe(-1);
    expect(limitAutoScroll(-14, { top: 112.5, bottom: 900 }, view)).toBe(-4);
    expect(limitAutoScroll(14, { top: 0, bottom: 784.3 }, view)).toBe(1);
    expect(limitAutoScroll(14, { top: 0, bottom: 786.5 }, view)).toBe(3);
    // One step of that size ends it: nothing is left to ask for again.
    expect(limitAutoScroll(-14, { top: 116.6, bottom: 900 }, view)).toBe(0);
    expect(limitAutoScroll(14, { top: 0, bottom: 783.3 }, view)).toBe(0);
  });

  it('measures against the visible area, not the viewport', () => {
    // The top of the list is inside the viewport but under a 100px header.
    expect(limitAutoScroll(-14, { top: 40, bottom: 900 }, view)).toBe(-14);
    expect(limitAutoScroll(-14, { top: 40, bottom: 900 }, { top: 0, bottom: 800 })).toBe(0);
  });

  it('is zero for no speed and never returns -0', () => {
    expect(Object.is(limitAutoScroll(0, { top: -300, bottom: 2000 }, view), 0)).toBe(true);
    expect(Object.is(limitAutoScroll(-14, { top: 300, bottom: 900 }, view), 0)).toBe(true);
  });
});

describe('frameScale', () => {
  it('is 1 for a 60 Hz frame and a half for a 120 Hz frame', () => {
    expect(frameScale(1000 / 60)).toBeCloseTo(1);
    expect(frameScale(1000 / 120)).toBeCloseTo(0.5);
  });

  it('counts a long pause for three frames at most', () => {
    expect(frameScale(2000)).toBeCloseTo(3);
  });

  it('is 1 when the duration is unknown', () => {
    expect(frameScale(0)).toBe(1);
    expect(frameScale(-5)).toBe(1);
    expect(frameScale(Number.NaN)).toBe(1);
  });
});

describe('isDropLineVisible', () => {
  it('accepts a line inside the visible area, edges included', () => {
    const view: BlockSpan = { top: 97, bottom: 700 };
    expect(isDropLineVisible(97, view)).toBe(true);
    expect(isDropLineVisible(400, view)).toBe(true);
    expect(isDropLineVisible(700, view)).toBe(true);
  });

  it('refuses a line under a header or outside the viewport', () => {
    const view: BlockSpan = { top: 97, bottom: 700 };
    expect(isDropLineVisible(96, view)).toBe(false);
    expect(isDropLineVisible(-20, view)).toBe(false);
    expect(isDropLineVisible(701, view)).toBe(false);
  });
});

describe('blocksSignature', () => {
  it('changes when rows are reordered, added, removed, paired or unpaired', () => {
    const base = blocksSignature([['a'], ['b', 'c'], ['d']]);
    expect(blocksSignature([['a'], ['b', 'c'], ['d']])).toBe(base);
    expect(blocksSignature([['b', 'c'], ['a'], ['d']])).not.toBe(base);
    expect(blocksSignature([['a'], ['b', 'c'], ['d'], ['e']])).not.toBe(base);
    expect(blocksSignature([['a'], ['b', 'c']])).not.toBe(base);
    expect(blocksSignature([['a'], ['b'], ['c'], ['d']])).not.toBe(base);
    expect(blocksSignature([['a', 'b', 'c'], ['d']])).not.toBe(base);
  });
});
