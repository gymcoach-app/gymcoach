import { describe, it, expect } from 'vitest';
import {
  applyExerciseOrder,
  buildSupersetView,
  isSupersetTransitionRest,
  moveExerciseBlock,
  nextAutoAdvanceIndex,
  nextNavIndex,
  smallestFreeGroup,
  supersetBlocks,
  MAX_SUPERSET_GROUP,
} from './supersets';

interface Item {
  id: string;
  order: number;
  supersetGroup: number | null;
}

function item(id: string, order: number, supersetGroup: number | null = null): Item {
  return { id, order, supersetGroup };
}

describe('buildSupersetView', () => {
  it('keeps standalone exercises in order with no labels', () => {
    const view = buildSupersetView([item('b', 2), item('a', 1), item('c', 3)]);
    expect(view.ordered.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(view.labels.size).toBe(0);
    expect(view.groupById.size).toBe(0);
  });

  it('labels group members A1/A2 and letters follow group appearance', () => {
    const view = buildSupersetView([
      item('bench', 1, 7),
      item('row', 2, 7),
      item('squat', 3),
      item('curl', 4, 2),
      item('ext', 5, 2),
    ]);
    expect(view.ordered.map((i) => i.id)).toEqual(['bench', 'row', 'squat', 'curl', 'ext']);
    // Stored numbers (7 then 2) are cosmetic: letters renumber on read.
    expect(view.labels.get('bench')).toBe('A1');
    expect(view.labels.get('row')).toBe('A2');
    expect(view.labels.get('curl')).toBe('B1');
    expect(view.labels.get('ext')).toBe('B2');
    expect(view.labels.has('squat')).toBe(false);
  });

  it('pulls non-adjacent members together at the first member position', () => {
    const view = buildSupersetView([item('a1', 1, 1), item('solo', 2), item('a2', 3, 1)]);
    expect(view.ordered.map((i) => i.id)).toEqual(['a1', 'a2', 'solo']);
    expect(view.labels.get('a2')).toBe('A2');
  });

  it('treats a singleton group as standalone (no label, no group)', () => {
    const view = buildSupersetView([item('a', 1, 3), item('b', 2)]);
    expect(view.ordered.map((i) => i.id)).toEqual(['a', 'b']);
    expect(view.labels.size).toBe(0);
    expect(view.groupById.has('a')).toBe(false);
  });

  it('supports groups of three (A1/A2/A3)', () => {
    const view = buildSupersetView([item('x', 1, 1), item('y', 2, 1), item('z', 3, 1)]);
    expect(view.labels.get('z')).toBe('A3');
  });
});

describe('nextAutoAdvanceIndex', () => {
  // remaining() already accounts for the set just logged on the current item.
  it('standalone: advances only once the target sets are complete (pinned behavior)', () => {
    const view = buildSupersetView([item('a', 1), item('b', 2)]);
    expect(nextAutoAdvanceIndex(view, 0, () => 2)).toBeNull(); // sets left -> stay
    expect(nextAutoAdvanceIndex(view, 0, () => 0)).toBe(1); // complete -> advance
    expect(nextAutoAdvanceIndex(view, 1, () => 0)).toBeNull(); // last exercise
  });

  it('superset: alternates to the other member that still has sets', () => {
    const view = buildSupersetView([item('a1', 1, 1), item('a2', 2, 1), item('b', 3)]);
    // Logged a set on A1, A2 still has sets -> go to A2 even if A1 has more.
    expect(nextAutoAdvanceIndex(view, 0, () => 1)).toBe(1);
    // Logged a set on A2, A1 still has sets -> back to A1.
    expect(nextAutoAdvanceIndex(view, 1, () => 1)).toBe(0);
  });

  it('superset: stays on the current member when the others are done', () => {
    const view = buildSupersetView([item('a1', 1, 1), item('a2', 2, 1), item('b', 3)]);
    const remaining = (i: Item) => (i.id === 'a1' ? 2 : 0);
    expect(nextAutoAdvanceIndex(view, 0, remaining)).toBeNull();
  });

  it('superset: advances past the group once every member is complete', () => {
    const view = buildSupersetView([item('a1', 1, 1), item('a2', 2, 1), item('b', 3)]);
    expect(nextAutoAdvanceIndex(view, 1, () => 0)).toBe(2);
    // Group at the end of the workout -> nothing after it.
    const tail = buildSupersetView([item('b', 1), item('a1', 2, 1), item('a2', 3, 1)]);
    expect(nextAutoAdvanceIndex(tail, 2, () => 0)).toBeNull();
  });
});

describe('nextNavIndex', () => {
  it('standalone: next exercise, null at the end (pinned behavior)', () => {
    const view = buildSupersetView([item('a', 1), item('b', 2)]);
    expect(nextNavIndex(view, 0, () => 5)).toBe(1);
    expect(nextNavIndex(view, 1, () => 5)).toBeNull();
  });

  it('cycles within the group before advancing', () => {
    const view = buildSupersetView([item('a1', 1, 1), item('a2', 2, 1), item('b', 3)]);
    // A1 -> A2 (linear within the group).
    expect(nextNavIndex(view, 0, () => 1)).toBe(1);
    // A2 (last member) -> back to A1 while A1 has sets remaining.
    expect(nextNavIndex(view, 1, (i) => (i.id === 'a1' ? 1 : 0))).toBe(0);
    // A2 -> past the group once A1 is done (never traps the user in place).
    expect(nextNavIndex(view, 1, (i) => (i.id === 'a2' ? 1 : 0))).toBe(2);
    expect(nextNavIndex(view, 1, () => 0)).toBe(2);
  });

  it('group at the end of the workout still cycles, then disables', () => {
    const view = buildSupersetView([item('b', 1), item('a1', 2, 1), item('a2', 3, 1)]);
    expect(nextNavIndex(view, 2, (i) => (i.id === 'a1' ? 1 : 0))).toBe(1);
    expect(nextNavIndex(view, 2, () => 0)).toBeNull();
  });
});

describe('smallestFreeGroup', () => {
  it('returns the smallest unused group number', () => {
    expect(smallestFreeGroup([item('a', 1, 1), item('b', 2, 3)])).toBe(2);
    expect(smallestFreeGroup([])).toBe(1);
  });

  it('returns null when all group numbers are taken', () => {
    const items = Array.from({ length: MAX_SUPERSET_GROUP }, (_, i) => item(`x${i}`, i, i + 1));
    expect(smallestFreeGroup(items)).toBeNull();
  });
});

// Superset-aware rest (issue #189): the transition-vs-full-rest decision.
describe('isSupersetTransitionRest', () => {
  it('is a full rest for a standalone exercise (next never matters)', () => {
    const view = buildSupersetView([item('a', 1), item('b', 2)]);
    // Standalone: full rest whether it advances to the next exercise or stays.
    expect(isSupersetTransitionRest(view, 0, 1)).toBe(false);
    expect(isSupersetTransitionRest(view, 0, null)).toBe(false);
  });

  it('is a transition rest when advancing A1 -> A2 within a 2-member group', () => {
    const view = buildSupersetView([item('a1', 1, 1), item('a2', 2, 1), item('b', 3)]);
    // A1 logged, auto-advance to A2 (same group) -> short transition rest.
    expect(isSupersetTransitionRest(view, 0, 1)).toBe(true);
  });

  it('is a full rest after the last member advances past the group', () => {
    const view = buildSupersetView([item('a1', 1, 1), item('a2', 2, 1), item('b', 3)]);
    // A2 logged, auto-advance back to A1 (same group, repeat) -> transition.
    expect(isSupersetTransitionRest(view, 1, 0)).toBe(true);
    // A2 logged, group complete, advance to the standalone B -> full rest.
    expect(isSupersetTransitionRest(view, 1, 2)).toBe(false);
  });

  it('is a full rest when staying put to finish the current member', () => {
    const view = buildSupersetView([item('a1', 1, 1), item('a2', 2, 1)]);
    // null (no auto-advance, the other member is done) -> full rest.
    expect(isSupersetTransitionRest(view, 0, null)).toBe(false);
  });

  it('handles a 3-member group: transition between members, full after', () => {
    const view = buildSupersetView([
      item('a1', 1, 1),
      item('a2', 2, 1),
      item('a3', 3, 1),
      item('b', 4),
    ]);
    expect(isSupersetTransitionRest(view, 0, 1)).toBe(true); // A1 -> A2
    expect(isSupersetTransitionRest(view, 1, 2)).toBe(true); // A2 -> A3
    expect(isSupersetTransitionRest(view, 2, 0)).toBe(true); // A3 -> A1 (repeat)
    expect(isSupersetTransitionRest(view, 2, 3)).toBe(false); // A3 -> B (full)
    expect(isSupersetTransitionRest(view, 2, null)).toBe(false); // stay (full)
  });
});

// Reordering (issue #557): moves work on blocks of the presentation order.
describe('supersetBlocks', () => {
  const ids = (blocks: Item[][]) => blocks.map((block) => block.map((i) => i.id));

  it('makes one block per standalone exercise and one per superset', () => {
    const blocks = supersetBlocks([
      item('warmup', 1),
      item('a1', 2, 1),
      item('a2', 3, 1),
      item('solo', 4),
      item('b1', 5, 2),
      item('b2', 6, 2),
    ]);
    expect(ids(blocks)).toEqual([['warmup'], ['a1', 'a2'], ['solo'], ['b1', 'b2']]);
  });

  it('keeps two adjacent supersets apart', () => {
    const blocks = supersetBlocks([
      item('a1', 1, 1),
      item('a2', 2, 1),
      item('b1', 3, 2),
      item('b2', 4, 2),
    ]);
    expect(ids(blocks)).toEqual([
      ['a1', 'a2'],
      ['b1', 'b2'],
    ]);
  });

  it('treats a singleton group as a standalone block', () => {
    const blocks = supersetBlocks([item('a', 1, 4), item('b', 2)]);
    expect(ids(blocks)).toEqual([['a'], ['b']]);
  });

  it('gathers members that are apart in the stored order, as the view does', () => {
    const blocks = supersetBlocks([item('a1', 1, 1), item('solo', 2), item('a2', 3, 1)]);
    expect(ids(blocks)).toEqual([['a1', 'a2'], ['solo']]);
  });

  it('returns no block for an empty workout', () => {
    expect(supersetBlocks([])).toEqual([]);
  });
});

describe('moveExerciseBlock', () => {
  const standalone = [item('a', 1), item('b', 2), item('c', 3)];

  it('swaps a standalone exercise with its neighbour', () => {
    expect(moveExerciseBlock(standalone, 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveExerciseBlock(standalone, 'b', 'down')).toEqual(['a', 'c', 'b']);
  });

  it('returns null at the top and bottom edges', () => {
    expect(moveExerciseBlock(standalone, 'a', 'up')).toBeNull();
    expect(moveExerciseBlock(standalone, 'c', 'down')).toBeNull();
    expect(moveExerciseBlock([item('only', 1)], 'only', 'up')).toBeNull();
    expect(moveExerciseBlock([item('only', 1)], 'only', 'down')).toBeNull();
  });

  it('returns null for an unknown id and for an empty workout', () => {
    expect(moveExerciseBlock(standalone, 'nope', 'up')).toBeNull();
    expect(moveExerciseBlock([], 'a', 'down')).toBeNull();
  });

  it('follows the stored order, not the array order', () => {
    expect(moveExerciseBlock([item('c', 3), item('a', 1), item('b', 2)], 'c', 'up')).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('moves the last exercise to the top in repeated moves', () => {
    const afterFirst = moveExerciseBlock(standalone, 'c', 'up');
    expect(afterFirst).toEqual(['a', 'c', 'b']);
    const afterSecond = moveExerciseBlock(applyExerciseOrder(standalone, afterFirst!), 'c', 'up');
    expect(afterSecond).toEqual(['c', 'a', 'b']);
  });

  const mixed = [item('warmup', 1), item('a1', 2, 1), item('a2', 3, 1), item('solo', 4)];

  it('moves the whole superset when any member moves', () => {
    expect(moveExerciseBlock(mixed, 'a1', 'up')).toEqual(['a1', 'a2', 'warmup', 'solo']);
    expect(moveExerciseBlock(mixed, 'a2', 'up')).toEqual(['a1', 'a2', 'warmup', 'solo']);
    expect(moveExerciseBlock(mixed, 'a1', 'down')).toEqual(['warmup', 'solo', 'a1', 'a2']);
    expect(moveExerciseBlock(mixed, 'a2', 'down')).toEqual(['warmup', 'solo', 'a1', 'a2']);
  });

  it('makes a standalone exercise jump over a whole superset', () => {
    expect(moveExerciseBlock(mixed, 'warmup', 'down')).toEqual(['a1', 'a2', 'warmup', 'solo']);
    expect(moveExerciseBlock(mixed, 'solo', 'up')).toEqual(['warmup', 'solo', 'a1', 'a2']);
  });

  it('cannot move a member inside its own superset at the edge of the workout', () => {
    const pairOnly = [item('a1', 1, 1), item('a2', 2, 1)];
    expect(moveExerciseBlock(pairOnly, 'a2', 'up')).toBeNull();
    expect(moveExerciseBlock(pairOnly, 'a1', 'down')).toBeNull();
  });

  it('swaps two neighbouring supersets as wholes, three members included', () => {
    const items = [
      item('a1', 1, 1),
      item('a2', 2, 1),
      item('a3', 3, 1),
      item('b1', 4, 2),
      item('b2', 5, 2),
    ];
    expect(moveExerciseBlock(items, 'b2', 'up')).toEqual(['b1', 'b2', 'a1', 'a2', 'a3']);
    expect(moveExerciseBlock(items, 'a2', 'down')).toEqual(['b1', 'b2', 'a1', 'a2', 'a3']);
  });

  it('gathers members that were apart in the stored order', () => {
    const apart = [item('a1', 1, 1), item('solo', 2), item('a2', 3, 1), item('last', 4)];
    // Shown as a1, a2, solo, last: solo moves above the pair, not between it.
    expect(moveExerciseBlock(apart, 'solo', 'up')).toEqual(['solo', 'a1', 'a2', 'last']);
    expect(moveExerciseBlock(apart, 'solo', 'down')).toEqual(['a1', 'a2', 'last', 'solo']);
  });

  it('keeps members adjacent, in order, and the A1/A2 labels on the same rows', () => {
    const items = [
      item('warmup', 1),
      item('a1', 2, 1),
      item('a2', 3, 1),
      item('solo', 4),
      item('b1', 5, 2),
      item('b2', 6, 2),
    ];
    let current = items;
    // Walk the second superset to the top, one block at a time.
    for (let step = 0; step < 3; step += 1) {
      const next = moveExerciseBlock(current, 'b2', 'up');
      expect(next).not.toBeNull();
      current = applyExerciseOrder(current, next!);
    }
    const view = buildSupersetView(current);
    expect(view.ordered.map((i) => i.id)).toEqual(['b1', 'b2', 'warmup', 'a1', 'a2', 'solo']);
    // Letters follow the order the groups appear in, so they swap; the
    // member numbers stay with their rows.
    expect(view.labels.get('b1')).toBe('A1');
    expect(view.labels.get('b2')).toBe('A2');
    expect(view.labels.get('a1')).toBe('B1');
    expect(view.labels.get('a2')).toBe('B2');
    expect(moveExerciseBlock(current, 'b1', 'up')).toBeNull();
  });
});

describe('applyExerciseOrder', () => {
  it('rewrites order to 1..n following the id list, leaving the rest untouched', () => {
    const result = applyExerciseOrder(
      [item('a', 5), item('b', 9, 2), item('c', 12)],
      ['c', 'a', 'b'],
    );
    expect(result).toEqual([item('c', 1), item('a', 2), item('b', 3, 2)]);
  });

  it('keeps rows missing from the list, after the listed ones', () => {
    const result = applyExerciseOrder([item('a', 1), item('b', 2), item('c', 3)], ['c', 'a']);
    expect(result.map((i) => [i.id, i.order])).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', 3],
    ]);
  });

  it('ignores ids that are not in the workout and does not mutate its input', () => {
    const input = [item('a', 1), item('b', 2)];
    const result = applyExerciseOrder(input, ['ghost', 'b', 'a']);
    expect(result.map((i) => i.id)).toEqual(['b', 'a']);
    expect(input).toEqual([item('a', 1), item('b', 2)]);
  });

  it('lets a newly paired row join the block right after a move', () => {
    // After moving `solo` under the pair, "Pair with previous" puts it in the
    // pair's group: it must show as A3, directly after A2.
    const moved = applyExerciseOrder(
      [item('solo', 1), item('a1', 2, 1), item('a2', 3, 1)],
      moveExerciseBlock([item('solo', 1), item('a1', 2, 1), item('a2', 3, 1)], 'solo', 'down')!,
    );
    const paired = moved.map((i) => (i.id === 'solo' ? { ...i, supersetGroup: 1 } : i));
    const view = buildSupersetView(paired);
    expect(view.ordered.map((i) => i.id)).toEqual(['a1', 'a2', 'solo']);
    expect(view.labels.get('solo')).toBe('A3');
  });
});
