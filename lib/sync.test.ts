import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingSet } from '@/lib/indexeddb';

const { mockGetDB } = vi.hoisted(() => ({ mockGetDB: vi.fn() }));

vi.mock('@/lib/indexeddb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/indexeddb')>();
  return { ...actual, getDB: mockGetDB };
});

import { NO_ACCOUNT, recordSignedInAccount } from '@/lib/signed-in-account';
import {
  bindAutoSync,
  countUnsyncedSets,
  deleteSyncedSets,
  drainDroppedEquipment,
  flushPendingSets,
  onEquipmentDropped,
  pendingSetUpdateState,
} from '@/lib/sync';

function pendingSet(): PendingSet {
  return {
    localId: 'local-1',
    sessionId: 'session-1',
    userId: 'user-1',
    exerciseId: 'exercise-1',
    gymEquipmentId: 'stale-equipment',
    setNumber: 1,
    weight: 82.5,
    reps: 7,
    rir: 2,
    notes: 'offline set',
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

// A read that resolves in the same tick would hide every interleaving, so the
// stand-in below yields once before touching the item, as a real cursor does.
const io = () => new Promise((resolve) => setTimeout(resolve, 0));

// Minimal Dexie stand-in: one queued item, patched in place by update().
// `where(index)` answers for the two queries sync.ts makes, `status.anyOf` for
// the flush and `sessionId.equals` for the drain, and `modify` mutates the item
// through the query as a cursor does rather than handing back a copy.
//
// `transaction` serialises, because that is the guarantee the drain rests on:
// IndexedDB runs one `rw` transaction per store at a time, so a second drain
// cannot read the notice before the first has nulled it.
function fakeDB(item: PendingSet) {
  let queue: Promise<unknown> = Promise.resolve();
  const matching = (index: string, value: string) =>
    index === 'sessionId' && item.sessionId === value ? [item] : [];
  const table = {
    get: vi.fn(async (id: string) => (id === item.localId ? item : undefined)),
    where: vi.fn((index: string) => ({
      anyOf: vi.fn((statuses: string[]) => ({
        // Answers like Dexie: only while the item is in a requested status, so
        // the post-flush remaining count (#490 reads it through sortBy) is real.
        sortBy: vi.fn(async () => (statuses.includes(item.status) ? [item] : [])),
        count: vi.fn(async () => (item.status === 'synced' ? 0 : 1)),
      })),
      equals: vi.fn((value: string) => ({
        toArray: vi.fn(async () => {
          await io();
          return matching(index, value);
        }),
        modify: vi.fn(async (change: (row: PendingSet) => void) => {
          await io();
          const rows = matching(index, value);
          for (const row of rows) change(row);
          return rows.length;
        }),
      })),
    })),
    update: vi.fn(async (_id: string, patch: Partial<PendingSet>) => {
      // A write that lands before the next reader's turn would close the very
      // window this fake exists to keep open, so it yields too.
      await io();
      Object.assign(item, patch);
      return 1;
    }),
  };
  return {
    pendingSets: table,
    transaction: vi.fn(<T>(_mode: string, _scope: unknown, body: () => Promise<T>) => {
      const run = queue.then(body);
      queue = run.catch(() => undefined);
      return run;
    }),
  };
}

describe('pendingSetUpdateState', () => {
  it('distinguishes remote persistence from queued and fatal states', () => {
    expect(pendingSetUpdateState(undefined)).toBe('missing');
    expect(pendingSetUpdateState({ ...pendingSet(), status: 'failed' })).toBe('failed');
    expect(pendingSetUpdateState({ ...pendingSet(), status: 'synced' })).toBe('synced');
    expect(pendingSetUpdateState({ ...pendingSet(), status: 'pending' })).toBe('queued');
    expect(pendingSetUpdateState({ ...pendingSet(), status: 'syncing' })).toBe('queued');
  });
});

describe('offline set sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('retries a 400 once without stale optional equipment and preserves the training set', async () => {
    const item = pendingSet();
    const updates: Array<Partial<PendingSet>> = [];
    const table = {
      where: vi.fn(() => ({
        anyOf: vi.fn((statuses: string[]) => ({
          sortBy: vi.fn(async () => (statuses.includes(item.status) ? [item] : [])),
          count: vi.fn(async () => (item.status === 'synced' ? 0 : 1)),
        })),
      })),
      get: vi.fn(async (id: string) => (id === item.localId ? item : undefined)),
      update: vi.fn(async (_id: string, patch: Partial<PendingSet>) => {
        Object.assign(item, patch);
        updates.push(patch);
        return 1;
      }),
    };
    mockGetDB.mockReturnValue({
      pendingSets: table,
      transaction: vi.fn(<T>(_mode: string, _scope: unknown, body: () => Promise<T>) => body()),
    });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Equipment is not available for this exercise.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'server-set-1' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const result = await flushPendingSets('user-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody).toMatchObject({
      gymEquipmentId: 'stale-equipment',
      weight: 82.5,
      reps: 7,
      rir: 2,
    });
    expect(retryBody).toMatchObject({
      gymEquipmentId: null,
      weight: 82.5,
      reps: 7,
      rir: 2,
    });
    expect(item.status).toBe('synced');
    expect(item.serverId).toBe('server-set-1');
    expect(updates.at(-1)).toMatchObject({ status: 'synced', serverId: 'server-set-1' });
    // The retry recorded the set without its equipment: that is a dropped
    // reference like any other, so it is cleared locally and reported.
    expect(item.gymEquipmentId).toBeNull();
    expect(result).toEqual({
      flushed: 1,
      failed: 0,
      pending: 0,
      droppedEquipment: [
        { localId: 'local-1', sessionId: 'session-1', gymEquipmentId: 'stale-equipment' },
      ],
    });
  });

  it('clears and reports an equipment reference the server recorded as null (issue #326)', async () => {
    const item = pendingSet();
    mockGetDB.mockReturnValue(fakeDB(item));
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'server-set-2', gymEquipmentId: null }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const listener = vi.fn();
    const unsubscribe = onEquipmentDropped(listener);

    const result = await flushPendingSets('user-1');
    unsubscribe();

    expect(item.status).toBe('synced');
    expect(item.gymEquipmentId).toBeNull();
    expect(result.droppedEquipment).toEqual([
      { localId: 'local-1', sessionId: 'session-1', gymEquipmentId: 'stale-equipment' },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(result.droppedEquipment);
  });

  it('keeps an equipment reference the server attached and stays silent', async () => {
    const item = pendingSet();
    mockGetDB.mockReturnValue(fakeDB(item));
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'server-set-3', gymEquipmentId: 'stale-equipment' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const listener = vi.fn();
    const unsubscribe = onEquipmentDropped(listener);

    const result = await flushPendingSets('user-1');
    unsubscribe();

    expect(item.gymEquipmentId).toBe('stale-equipment');
    expect(result.droppedEquipment).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not report a set that never carried an equipment reference', async () => {
    const item = { ...pendingSet(), gymEquipmentId: null };
    mockGetDB.mockReturnValue(fakeDB(item));
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'server-set-4', gymEquipmentId: null }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const listener = vi.fn();
    const unsubscribe = onEquipmentDropped(listener);

    const result = await flushPendingSets('user-1');
    unsubscribe();

    expect(result.droppedEquipment).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('patches an existing server set instead of posting a duplicate', async () => {
    const item: PendingSet = {
      ...pendingSet(),
      serverId: 'server/1',
      syncedAt: 1,
      weight: 95,
      reps: 9,
      rir: 1,
    };
    mockGetDB.mockReturnValue(fakeDB(item));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'server-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await flushPendingSets('user-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/sets/server%2F1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight: 95, reps: 9, rir: 1 }),
    });
    expect(item.status).toBe('synced');
    expect(item.serverId).toBe('server-1');
  });

  it('keeps a newer local edit pending when an older PATCH completes', async () => {
    const item: PendingSet = {
      ...pendingSet(),
      serverId: 'server-1',
      syncedAt: 1,
      weight: 95,
      reps: 9,
      rir: 1,
    };
    mockGetDB.mockReturnValue(fakeDB(item));
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      // Simulate a second local edit landing while the first PATCH is in flight.
      item.weight = 97.5;
      item.reps = 8;
      item.rir = 0;
      item.status = 'pending';
      return new Response(JSON.stringify({ id: 'server-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await flushPendingSets('user-1');

    expect(item).toMatchObject({
      weight: 97.5,
      reps: 8,
      rir: 0,
      status: 'pending',
      serverId: 'server-1',
    });
    expect(result).toMatchObject({ flushed: 1, pending: 1 });
  });
});

// Issue #337: the notice was broadcast to live subscribers only, so a flush
// that completed with no SessionRunner mounted told nobody and was gone.
describe('dropped equipment survives a flush nobody was listening to', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  async function flushWithDropAndNoListener(item: PendingSet) {
    mockGetDB.mockReturnValue(fakeDB(item));
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'server-set-5', gymEquipmentId: null }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    // Deliberately no `onEquipmentDropped` subscriber: this is the reported
    // path. Log a set offline, close the app, reopen on the dashboard, where
    // `sync-bootstrap` flushes with no SessionRunner mounted.
    return flushPendingSets('user-1');
  }

  it('records the drop on the set rather than only announcing it', async () => {
    const item = pendingSet();
    await flushWithDropAndNoListener(item);

    expect(item.gymEquipmentId).toBeNull();
    expect(item.equipmentDroppedNotice).toBe('stale-equipment');
  });

  it('hands the drop to a runner that mounts afterwards', async () => {
    const item = pendingSet();
    await flushWithDropAndNoListener(item);

    // What SessionRunner does on mount.
    expect(await drainDroppedEquipment('session-1')).toEqual([
      { localId: 'local-1', sessionId: 'session-1', gymEquipmentId: 'stale-equipment' },
    ]);
  });

  it('shows it exactly once: a second drain is empty', async () => {
    const item = pendingSet();
    await flushWithDropAndNoListener(item);

    await drainDroppedEquipment('session-1');

    // The mount drain and the broadcast-triggered drain both run in
    // SessionRunner; clearing is what stops them reporting the same set twice.
    expect(await drainDroppedEquipment('session-1')).toEqual([]);
    expect(item.equipmentDroppedNotice).toBeNull();
  });

  it('two drains at once still report it once', async () => {
    const item = pendingSet();
    await flushWithDropAndNoListener(item);

    // Both callers are in SessionRunner and do overlap: `reactStrictMode` fires
    // the mount effect twice in development, and in production a broadcast can
    // land while the mount drain is still awaiting its read. Clearing after a
    // read that both have already made would show the toast twice.
    const [mount, broadcast] = await Promise.all([
      drainDroppedEquipment('session-1'),
      drainDroppedEquipment('session-1'),
    ]);

    expect([...mount, ...broadcast]).toEqual([
      { localId: 'local-1', sessionId: 'session-1', gymEquipmentId: 'stale-equipment' },
    ]);
    expect(item.equipmentDroppedNotice).toBeNull();
  });

  it('does not hand one session the drops of another', async () => {
    const item = pendingSet();
    await flushWithDropAndNoListener(item);

    expect(await drainDroppedEquipment('another-session')).toEqual([]);
    // And the notice is still there for the session it belongs to.
    expect(item.equipmentDroppedNotice).toBe('stale-equipment');
  });

  it('returns nothing when a set synced with its equipment intact', async () => {
    const item = pendingSet();
    mockGetDB.mockReturnValue(fakeDB(item));
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'server-set-6', gymEquipmentId: 'stale-equipment' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await flushPendingSets('user-1');

    expect(item.equipmentDroppedNotice).toBeUndefined();
    expect(await drainDroppedEquipment('session-1')).toEqual([]);
  });
});

describe('deleteSyncedSets (#357)', () => {
  // A table of rows filtered by `where('status').equals(...)`, like Dexie.
  function rowsDB(rows: PendingSet[]) {
    return {
      pendingSets: {
        where: vi.fn((index: string) => ({
          equals: vi.fn((value: string) => ({
            delete: vi.fn(async () => {
              const keep = rows.filter(
                (row) => row[index as keyof PendingSet] !== value,
              );
              const removed = rows.length - keep.length;
              rows.splice(0, rows.length, ...keep);
              return removed;
            }),
          })),
        })),
      },
    };
  }

  it('deletes synced rows and keeps unsynced work', async () => {
    const rows: PendingSet[] = [
      { ...pendingSet(), localId: 'srv_1', status: 'synced', serverId: '1' },
      { ...pendingSet(), localId: 'loc_synced', status: 'synced', serverId: '2' },
      { ...pendingSet(), localId: 'loc_pending', status: 'pending' },
      { ...pendingSet(), localId: 'loc_syncing', status: 'syncing' },
      { ...pendingSet(), localId: 'loc_failed', status: 'failed' },
    ];
    mockGetDB.mockReturnValue(rowsDB(rows));

    await deleteSyncedSets();

    expect(rows.map((row) => row.localId)).toEqual([
      'loc_pending',
      'loc_syncing',
      'loc_failed',
    ]);
  });

  it('resolves without throwing when IndexedDB is unavailable', async () => {
    mockGetDB.mockImplementation(() => {
      throw new Error('IndexedDB is only available client-side.');
    });

    await expect(deleteSyncedSets()).resolves.toBeUndefined();
  });
});

describe('per-account offline queue (#490)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  // Several rows behind `where('status').anyOf(...)`, the two shapes the
  // per-account reads use: sorted rows for the flush, a filtered count for the
  // badge. `update` patches the row in place, as Dexie does.
  function rowsDB(rows: PendingSet[]) {
    const byStatus = (statuses: string[]) => rows.filter((row) => statuses.includes(row.status));
    return {
      pendingSets: {
        where: vi.fn(() => ({
          anyOf: vi.fn((statuses: string[]) => ({
            sortBy: vi.fn(async () =>
              [...byStatus(statuses)].sort((a, b) => a.createdAt - b.createdAt),
            ),
            filter: vi.fn((keep: (row: PendingSet) => boolean) => ({
              count: vi.fn(async () => byStatus(statuses).filter(keep).length),
            })),
          })),
        })),
        // A copy, as Dexie returns: later updates do not reach a row already read.
        get: vi.fn(async (id: string) => {
          const row = rows.find((candidate) => candidate.localId === id);
          return row ? { ...row } : undefined;
        }),
        update: vi.fn(async (id: string, patch: Partial<PendingSet>) => {
          const row = rows.find((candidate) => candidate.localId === id);
          if (row) Object.assign(row, patch);
          return row ? 1 : 0;
        }),
      },
      transaction: vi.fn(<T>(_mode: string, _scope: unknown, body: () => Promise<T>) => body()),
    };
  }

  function created(id: string) {
    return new Response(JSON.stringify({ id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function queue(): PendingSet[] {
    return [
      { ...pendingSet(), localId: 'a1', sessionId: 'session-a', userId: 'user-a', createdAt: 1 },
      { ...pendingSet(), localId: 'b1', sessionId: 'session-b', userId: 'user-b', createdAt: 2 },
      // Written before rows carried an owner: nobody may send it yet.
      { ...pendingSet(), localId: 'legacy', sessionId: 'session-a', userId: undefined, createdAt: 3 },
    ];
  }

  it("sends only the signed-in account's rows and counts only those as remaining", async () => {
    const rows = queue().filter((row) => row.localId !== 'legacy');
    mockGetDB.mockReturnValue(rowsDB(rows));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(created('srv-b1'));

    const result = await flushPendingSets('user-b');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions/session-b/sets');
    expect(result).toMatchObject({ flushed: 1, failed: 0, pending: 0 });
    expect(rows.find((row) => row.localId === 'a1')?.status).toBe('pending');
  });

  it("leaves another account's rows dormant, then syncs them when it signs in again", async () => {
    const rows = queue().filter((row) => row.localId !== 'legacy');
    mockGetDB.mockReturnValue(rowsDB(rows));
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(created('srv-b1'))
      .mockResolvedValueOnce(created('srv-a1'));

    await flushPendingSets('user-b');
    expect(rows.find((row) => row.localId === 'a1')).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: null,
    });

    const result = await flushPendingSets('user-a');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/sessions/session-a/sets');
    expect(result).toMatchObject({ flushed: 1, pending: 0 });
    expect(rows.find((row) => row.localId === 'a1')).toMatchObject({
      status: 'synced',
      serverId: 'srv-a1',
    });
  });

  it('sends a legacy row and tags it with the account once the server accepts it', async () => {
    const rows = queue().filter((row) => row.localId === 'legacy');
    mockGetDB.mockReturnValue(rowsDB(rows));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(created('srv-legacy'));

    const result = await flushPendingSets('user-a');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sessions/session-a/sets');
    expect(result).toMatchObject({ flushed: 1, failed: 0, pending: 0 });
    expect(rows[0]).toMatchObject({ status: 'synced', serverId: 'srv-legacy', userId: 'user-a' });
  });

  it.each(['pending', 'failed'] as const)(
    'puts a %s legacy row back untouched when the session is not this account (404)',
    async (status) => {
      const rows = queue()
        .filter((row) => row.localId === 'legacy')
        .map((row) => ({ ...row, status, attempts: 2, lastError: 'earlier' }));
      mockGetDB.mockReturnValue(rowsDB(rows));
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'Session not found.' }), { status: 404 }),
      );

      const result = await flushPendingSets('user-b');

      expect(result).toMatchObject({ flushed: 0, failed: 0, pending: 1 });
      expect(rows[0]).toMatchObject({ status, attempts: 2, lastError: 'earlier' });
      expect(rows[0]?.userId).toBeUndefined();
    },
  );

  it('keeps the usual failed handling for a legacy row refused with 400', async () => {
    const rows = queue().filter((row) => row.localId === 'legacy');
    mockGetDB.mockReturnValue(rowsDB(rows));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Session already finished.' }), { status: 400 }),
    );

    const result = await flushPendingSets('user-a');

    expect(result).toMatchObject({ flushed: 0, failed: 1 });
    expect(rows[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'Session already finished.',
    });
    expect(rows[0]?.userId).toBeUndefined();
  });

  it('skips a row another flush claimed between the read and the send', async () => {
    const rows = queue().filter((row) => row.localId === 'a1');
    const db = rowsDB(rows);
    // The queue read sees it pending; by the time this flush claims it,
    // another tab's flush has marked it syncing.
    db.pendingSets.get.mockImplementation(async (id: string) => {
      const row = rows.find((candidate) => candidate.localId === id);
      return row ? { ...row, status: 'syncing' } : undefined;
    });
    mockGetDB.mockReturnValue(db);
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await flushPendingSets('user-a');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing once another tab signed in a different account or logged out', async () => {
    const rows = queue().filter((row) => row.localId === 'a1');
    mockGetDB.mockReturnValue(rowsDB(rows));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(created('srv-a1'));

    recordSignedInAccount('user-b');
    await flushPendingSets('user-a');
    recordSignedInAccount(null);
    expect(window.localStorage.getItem('gymcoach-signed-in-account')).toBe(NO_ACCOUNT);
    await flushPendingSets('user-a');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rows[0]?.status).toBe('pending');

    recordSignedInAccount('user-a');
    await flushPendingSets('user-a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits for another account's flush to finish before starting", async () => {
    const rows = queue().filter((row) => row.localId !== 'legacy');
    mockGetDB.mockReturnValue(rowsDB(rows));
    let releaseA!: (res: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseA = resolve;
          }),
      )
      .mockResolvedValueOnce(created('srv-b1'));

    const flushA = flushPendingSets('user-a');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const flushB = flushPendingSets('user-b');
    // B's flush must not start while A's request is still open.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseA(created('srv-a1'));
    await flushA;
    await flushB;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/sessions/session-b/sets');
  });

  it('binds nothing without a signed-in account', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const cleanup = bindAutoSync(null);
    cleanup();

    expect(add).not.toHaveBeenCalledWith('online', expect.anything());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts only the signed-in account's unsynced rows for the badge", async () => {
    const rows: PendingSet[] = [
      ...queue(),
      { ...pendingSet(), localId: 'a2', userId: 'user-a', status: 'syncing' },
      { ...pendingSet(), localId: 'a3', userId: 'user-a', status: 'failed' },
      { ...pendingSet(), localId: 'a4', userId: 'user-a', status: 'synced' },
    ];
    mockGetDB.mockReturnValue(rowsDB(rows));

    expect(await countUnsyncedSets('user-a')).toBe(3);
    expect(await countUnsyncedSets('user-b')).toBe(1);
    expect(await countUnsyncedSets('user-c')).toBe(0);
  });
});
