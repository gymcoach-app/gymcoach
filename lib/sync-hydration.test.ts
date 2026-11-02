import { describe, expect, it, vi } from 'vitest';
import type { PendingSet } from '@/lib/indexeddb';
import type { Set as PrismaSet } from '@/lib/prisma-client';

const { mockGetDB } = vi.hoisted(() => ({ mockGetDB: vi.fn() }));

vi.mock('@/lib/indexeddb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/indexeddb')>();
  return { ...actual, getDB: mockGetDB };
});

import { hydrateFromServerSets } from '@/lib/sync-hydration';

// The rows behind `bulkPut`, `where('sessionId').equals(...).modify(...)`,
// and `where('sessionId').equals(...).filter(...).delete()`,
// keyed by localId like the real table.
function rowsDB(rows: PendingSet[]) {
  const pendingSets = {
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
        filter: vi.fn((predicate: (row: PendingSet) => boolean) => ({
          delete: vi.fn(async () => {
            const toDelete = rows.filter(
              (row) => row[index as keyof PendingSet] === value && predicate(row),
            );
            for (const row of toDelete) {
              const idx = rows.indexOf(row);
              if (idx >= 0) rows.splice(idx, 1);
            }
            return toDelete.length;
          }),
          toArray: vi.fn(async () => {
            return rows.filter(
              (row) => row[index as keyof PendingSet] === value && predicate(row),
            );
          }),
        })),
      })),
    })),
  };

  return {
    pendingSets,
    transaction: vi.fn(async (_mode: string, _table: unknown, fn: () => Promise<void>) => {
      // In the mock, just execute the function directly (no real transaction isolation)
      await fn();
    }),
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

  it('removes existing synced rows before inserting srv_ versions (no duplicates on reload)', async () => {
    // Simulates: user logs a set (generated localId), it syncs (gets serverId),
    // then page reloads (language switch). Without deduplication, hydration would
    // create a second row with localId srv_${serverId}, duplicating the set.
    const localRow: PendingSet = {
      localId: 'local_generated_123',
      sessionId: 'session-a',
      userId: 'user-a',
      exerciseId: 'bench',
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
      createdAt: 1,
      status: 'synced',
      serverId: 'set-1', // Already synced, has a serverId
      syncedAt: 2,
      attempts: 0,
      lastError: null,
    };
    const rows = [localRow];
    mockGetDB.mockReturnValue(rowsDB(rows));

    await hydrateFromServerSets('session-a', [serverSet], 'user-a');

    // The original local_generated_123 row should be gone, replaced by srv_set-1
    expect(rows).toHaveLength(1);
    expect(rows[0]?.localId).toBe('srv_set-1');
    expect(rows[0]?.serverId).toBe('set-1');
  });

  it('preserves pending rows with unsaved edits during hydration', async () => {
    // Simulates: user logs a set, it syncs, user edits it (status='pending'),
    // then page reloads BEFORE the edit syncs. The pending edit must not be lost.
    const pendingEditRow: PendingSet = {
      localId: 'local_generated_123',
      sessionId: 'session-a',
      userId: 'user-a',
      exerciseId: 'bench',
      setNumber: 1,
      weight: 100, // Edited value (server has 60)
      reps: 5,
      rir: 2,
      durationSec: null,
      distanceM: null,
      notes: null,
      isWarmup: false,
      isDropSet: false,
      block: null,
      createdAt: 1,
      status: 'pending', // Unsaved edit
      serverId: 'set-1',
      syncedAt: 2,
      attempts: 0,
      lastError: null,
    };
    const rows = [pendingEditRow];
    mockGetDB.mockReturnValue(rowsDB(rows));

    await hydrateFromServerSets('session-a', [serverSet], 'user-a');

    // Both rows should exist: the pending edit AND the hydrated server version
    expect(rows).toHaveLength(2);
    const localRow = rows.find((r) => r.localId === 'local_generated_123');
    const serverRow = rows.find((r) => r.localId === 'srv_set-1');
    expect(localRow).toBeDefined();
    expect(localRow?.status).toBe('pending');
    expect(localRow?.weight).toBe(100); // Pending edit preserved
    expect(serverRow).toBeDefined();
    expect(serverRow?.status).toBe('synced');
    expect(serverRow?.weight).toBe(60); // Server's old value
  });

  it('preserves equipmentDroppedNotice from deleted synced rows (#337)', async () => {
    // Simulates: user logs a set with equipment, it syncs, server drops the
    // equipment (machine was deleted/unlinked) and writes equipmentDroppedNotice,
    // then page reloads. The notice must be copied to the srv_ record so the
    // runner can show "machine was not recorded".
    const syncedRowWithNotice: PendingSet = {
      localId: 'local_generated_123',
      sessionId: 'session-a',
      userId: 'user-a',
      exerciseId: 'bench',
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
      createdAt: 1,
      status: 'synced',
      serverId: 'set-1',
      syncedAt: 2,
      attempts: 0,
      lastError: null,
      equipmentDroppedNotice: 'eq-123', // Notice from server refusing the equipment
    };
    const rows = [syncedRowWithNotice];
    mockGetDB.mockReturnValue(rowsDB(rows));

    await hydrateFromServerSets('session-a', [serverSet], 'user-a');

    // The srv_ record should have the equipmentDroppedNotice preserved
    expect(rows).toHaveLength(1);
    expect(rows[0]?.localId).toBe('srv_set-1');
    expect(rows[0]?.equipmentDroppedNotice).toBe('eq-123');
  });
});
