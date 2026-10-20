import { describe, expect, it, vi } from 'vitest';
import type { PendingSet } from '@/lib/indexeddb';
import type { Set as PrismaSet } from '@/lib/prisma-client';

const { mockGetDB } = vi.hoisted(() => ({ mockGetDB: vi.fn() }));

vi.mock('@/lib/indexeddb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/indexeddb')>();
  return { ...actual, getDB: mockGetDB };
});

import { hydrateFromServerSets } from '@/lib/sync-hydration';

// The rows behind `bulkPut` and `where('sessionId').equals(...).modify(...)`,
// the two calls the hydration makes, keyed by localId like the real table.
function rowsDB(rows: PendingSet[]) {
  return {
    pendingSets: {
      bulkPut: vi.fn(async (records: PendingSet[]) => {
        for (const record of records) {
          const at = rows.findIndex((row) => row.localId === record.localId);
          if (at >= 0) rows[at] = record;
          else rows.push(record);
        }
      }),
      where: vi.fn((index: string) => ({
        equals: vi.fn((value: string) => ({
          modify: vi.fn(async (change: (row: PendingSet) => void) => {
            const matching = rows.filter((row) => row[index as keyof PendingSet] === value);
            for (const row of matching) change(row);
            return matching.length;
          }),
        })),
      })),
    },
  };
}

function queued(localId: string, sessionId: string, userId?: string): PendingSet {
  return {
    localId,
    sessionId,
    userId,
    exerciseId: 'bench',
    setNumber: 1,
    weight: 60,
    reps: 5,
    rir: 2,
    notes: null,
    isWarmup: false,
    isDropSet: false,
    createdAt: 1,
    status: 'pending',
    serverId: null,
    syncedAt: null,
    attempts: 0,
    lastError: null,
  };
}

const serverSet = {
  id: 'set-1',
  exerciseId: 'bench',
  gymEquipmentId: null,
  setNumber: 1,
  weight: 60,
  reps: 5,
  rir: 2,
  durationSec: null,
  distanceM: null,
  notes: null,
  isWarmup: false,
  isDropSet: false,
  block: null,
  completedAt: new Date('2026-10-20T08:00:00Z'),
} as unknown as PrismaSet;

describe('hydrateFromServerSets ownership (#490)', () => {
  it("tags the server rows with the session's owner", async () => {
    const rows: PendingSet[] = [];
    mockGetDB.mockReturnValue(rowsDB(rows));

    await hydrateFromServerSets('session-a', [serverSet], 'user-a');

    expect(rows).toEqual([
      expect.objectContaining({ localId: 'srv_set-1', userId: 'user-a', status: 'synced' }),
    ]);
  });

  it('claims untagged legacy rows of this session only', async () => {
    const rows = [
      queued('legacy-here', 'session-a'),
      queued('legacy-elsewhere', 'session-other'),
      queued('mine', 'session-a', 'user-a'),
    ];
    mockGetDB.mockReturnValue(rowsDB(rows));

    await hydrateFromServerSets('session-a', [], 'user-a');

    expect(Object.fromEntries(rows.map((row) => [row.localId, row.userId]))).toEqual({
      'legacy-here': 'user-a',
      'legacy-elsewhere': undefined,
      mine: 'user-a',
    });
  });

  it('never re-tags a row that already belongs to another account', async () => {
    const rows = [queued('theirs', 'session-a', 'user-b')];
    mockGetDB.mockReturnValue(rowsDB(rows));

    await hydrateFromServerSets('session-a', [], 'user-a');

    expect(rows[0]?.userId).toBe('user-b');
  });
});
