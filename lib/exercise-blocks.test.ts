import { describe, expect, it } from 'vitest';
import {
  blockIndexByRow,
  blockKey,
  blockSetWhere,
  distinctExerciseCount,
  effectiveSetBlock,
  occurrenceCounts,
  rowBlockKey,
  setBlockKey,
} from '@/lib/exercise-blocks';

describe('blockIndexByRow', () => {
  it('gives no block to an exercise the workout holds once', () => {
    const blocks = blockIndexByRow([
      { id: 'a', exerciseId: 'squat', order: 1 },
      { id: 'b', exerciseId: 'curl', order: 2 },
    ]);
    expect([...blocks]).toEqual([
      ['a', null],
      ['b', null],
    ]);
  });

  it('ranks the occurrences of a repeated exercise by order, then by id', () => {
    const blocks = blockIndexByRow([
      { id: 'bbb', exerciseId: 'bench', order: 3 },
      { id: 'row', exerciseId: 'row', order: 2 },
      { id: 'main', exerciseId: 'bench', order: 1 },
      { id: 'z', exerciseId: 'dip', order: 4 },
      { id: 'y', exerciseId: 'dip', order: 4 },
    ]);
    expect(blocks.get('main')).toBe(0);
    expect(blocks.get('bbb')).toBe(1);
    expect(blocks.get('row')).toBeNull();
    expect(blocks.get('y')).toBe(0);
    expect(blocks.get('z')).toBe(1);
  });
});

describe('effectiveSetBlock', () => {
  it('ignores the stored block when the exercise occurs once', () => {
    expect(effectiveSetBlock(1, 1)).toBeNull();
    expect(effectiveSetBlock(null, 0)).toBeNull();
  });

  it('reads NULL and an out-of-range block as the first occurrence', () => {
    expect(effectiveSetBlock(null, 2)).toBe(0);
    expect(effectiveSetBlock(undefined, 2)).toBe(0);
    expect(effectiveSetBlock(2, 2)).toBe(0);
    expect(effectiveSetBlock(-1, 2)).toBe(0);
    expect(effectiveSetBlock(1.5, 2)).toBe(0);
    expect(effectiveSetBlock(1, 2)).toBe(1);
  });
});

describe('block keys', () => {
  it('keeps the bare exerciseId for an exercise without a block', () => {
    expect(blockKey('bench', null)).toBe('bench');
    expect(blockKey('bench', 1)).toBe('bench#1');
  });

  it('matches a set to its row', () => {
    const main = { id: 'main', exerciseId: 'bench', order: 1 };
    const bbb = { id: 'bbb', exerciseId: 'bench', order: 2 };
    const other = { id: 'row', exerciseId: 'row', order: 3 };
    const rows = [main, bbb, other];
    const blocks = blockIndexByRow(rows);
    const counts = occurrenceCounts(rows);
    expect(counts.get('bench')).toBe(2);
    expect(setBlockKey({ exerciseId: 'bench', block: null }, counts)).toBe(
      rowBlockKey(main, blocks),
    );
    expect(setBlockKey({ exerciseId: 'bench', block: 1 }, counts)).toBe(rowBlockKey(bbb, blocks));
    expect(setBlockKey({ exerciseId: 'row', block: 1 }, counts)).toBe('row');
    expect(rowBlockKey(other, blocks)).toBe('row');
  });
});

describe('blockSetWhere', () => {
  it('reads a later block by its own index only', () => {
    expect(blockSetWhere(1, 2)).toEqual({ block: 1 });
  });

  it('reads block 0, NULL and indexes past the last row as the first block', () => {
    expect(blockSetWhere(0, 2)).toEqual({
      OR: [{ block: 0 }, { block: null }, { block: { gte: 2 } }],
    });
  });

  it('keeps the historical block 0 filter when the occurrence count is unknown', () => {
    expect(blockSetWhere(0)).toEqual({ OR: [{ block: 0 }, { block: null }] });
  });
});

describe('distinctExerciseCount', () => {
  it('counts the blocks of a repeated exercise once', () => {
    expect(
      distinctExerciseCount([
        { exerciseId: 'squat' },
        { exerciseId: 'squat' },
        { exerciseId: 'row' },
      ]),
    ).toBe(2);
    expect(distinctExerciseCount([])).toBe(0);
  });
});
