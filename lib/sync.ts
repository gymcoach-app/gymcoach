// ============================================================
// Sync queue: flush the pending sets to the API
// ============================================================
// Strategy:
// 1. When a set is validated locally, we write it to IndexedDB
//    (status='pending') and trigger a flush.
// 2. flushPendingSets() takes each pending one in order, attempts the POST
//    and marks it according to the result.
// 3. On app startup + on the 'online' event, we call flushPendingSets().
// 4. No aggressive retry: we wait for the next trigger (online, validation,
//    startup). If you cut the wifi in the middle, the app will retry when
//    the network comes back. No background timer, to save battery.

import { getDB, type PendingSet } from '@/lib/indexeddb';

export type PendingSetUpdateState = 'missing' | 'failed' | 'synced' | 'queued';

export function pendingSetUpdateState(set: PendingSet | undefined): PendingSetUpdateState {
  if (!set) return 'missing';
  if (set.status === 'failed') return 'failed';
  if (set.status === 'synced') return 'synced';
  return 'queued';
}

export interface FlushResult {
  flushed: number;
  failed: number;
  pending: number;
  // Sets the server recorded WITHOUT the equipment reference that was sent
  // (issue #326): the item was deleted, unlinked, belongs to another gym or
  // another user. The set itself is saved; only the decoration was dropped.
  droppedEquipment: DroppedEquipment[];
}

export interface DroppedEquipment {
  localId: string;
  sessionId: string;
  gymEquipmentId: string;
}

type DroppedEquipmentListener = (dropped: DroppedEquipment[]) => void;

const droppedEquipmentListeners = new Set<DroppedEquipmentListener>();

// Subscribe to equipment references the server dropped while flushing. The
// flush runs in the background (queueSet does not await it), so the session
// UI cannot read the result directly; it listens here instead. Returns the
// unsubscribe function.
export function onEquipmentDropped(listener: DroppedEquipmentListener): () => void {
  droppedEquipmentListeners.add(listener);
  return () => {
    droppedEquipmentListeners.delete(listener);
  };
}

let inFlight: Promise<FlushResult> | null = null;

export async function flushPendingSets(): Promise<FlushResult> {
  // Re-entrancy: if a flush is already running, we return its promise.
  if (inFlight) return inFlight;
  inFlight = doFlush();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function doFlush(): Promise<FlushResult> {
  const db = getDB();
  const pending = await db.pendingSets
    .where('status')
    .anyOf(['pending', 'failed'])
    .sortBy('createdAt');

  let flushed = 0;
  let failed = 0;
  const droppedEquipment: DroppedEquipment[] = [];

  for (const item of pending) {
    if (!navigator.onLine) {
      // No point trying if we know we are offline.
      break;
    }
    await db.pendingSets.update(item.localId, { status: 'syncing' });

    try {
      const existingServerId = item.serverId;
      const updatesExistingSet = existingServerId != null;
      const sentPatch = { weight: item.weight, reps: item.reps, rir: item.rir };
      let res: Response;
      let sentEquipmentId: string | null = null;

      if (existingServerId != null) {
        res = await fetch(`/api/sets/${encodeURIComponent(existingServerId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sentPatch),
        });
      } else {
        const payload = {
          exerciseId: item.exerciseId,
          gymEquipmentId: item.gymEquipmentId ?? null,
          setNumber: item.setNumber,
          weight: item.weight,
          reps: item.reps,
          rir: item.rir,
          durationSec: item.durationSec ?? null,
          distanceM: item.distanceM ?? null,
          notes: item.notes,
          isWarmup: item.isWarmup,
          isDropSet: item.isDropSet,
          block: item.block ?? null,
        };
        const post = (gymEquipmentId: string | null) =>
          fetch(`/api/sessions/${item.sessionId}/sets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, gymEquipmentId }),
          });

        sentEquipmentId = payload.gymEquipmentId;
        res = await post(sentEquipmentId);
        // Equipment is optional metadata. If a server version rejects a stale
        // reference with 400, retry once without it so the actual queued set is
        // never stranded by an inventory decoration.
        if (res.status === 400 && sentEquipmentId) {
          res = await post(null);
        }
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        // If the session is closed or the exercise invalid, retrying is
        // pointless: we mark it failed so we do not loop. The user can manually
        // purge the queue later if needed.
        const fatal = res.status === 400 || res.status === 404;
        await db.pendingSets.update(item.localId, {
          status: fatal ? 'failed' : 'pending',
          attempts: (item.attempts ?? 0) + 1,
          lastError: data?.error ?? `HTTP ${res.status}`,
        });
        failed += 1;
        continue;
      }

      const saved = (await res.json()) as { id: string; gymEquipmentId?: string | null };
      // Equipment metadata only applies when creating a new set. Editing an
      // existing row preserves the equipment reference already stored server-side.
      const equipmentDropped =
        !updatesExistingSet && sentEquipmentId !== null && !saved.gymEquipmentId;

      if (updatesExistingSet) {
        // A newer local edit may land while this PATCH is in flight. Compare
        // the current row and update its status inside one IndexedDB write
        // transaction so another edit cannot slip between the check and the
        // status write. Newer values stay pending for the next flush.
        await db.transaction('rw', db.pendingSets, async () => {
          const latest = await db.pendingSets.get(item.localId);
          const patchStillCurrent =
            latest != null &&
            latest.serverId === existingServerId &&
            latest.weight === sentPatch.weight &&
            latest.reps === sentPatch.reps &&
            latest.rir === sentPatch.rir;
          await db.pendingSets.update(
            item.localId,
            patchStillCurrent
              ? { status: 'synced', serverId: saved.id, syncedAt: Date.now(), lastError: null }
              : { status: 'pending', serverId: saved.id, lastError: null },
          );
        });
      } else {
        await db.pendingSets.update(item.localId, {
          status: 'synced',
          serverId: saved.id,
          syncedAt: Date.now(),
          lastError: null,
          // Written before the broadcast below, so a listener that drains
          // immediately still finds the record it is being told about.
          ...(equipmentDropped
            ? { gymEquipmentId: null, equipmentDroppedNotice: sentEquipmentId }
            : {}),
        });
      }
      if (equipmentDropped && sentEquipmentId !== null) {
        droppedEquipment.push({
          localId: item.localId,
          sessionId: item.sessionId,
          gymEquipmentId: sentEquipmentId,
        });
      }
      flushed += 1;
    } catch (err) {
      // Network error (offline, timeout): we keep 'pending' to retry later.
      await db.pendingSets.update(item.localId, {
        status: 'pending',
        attempts: (item.attempts ?? 0) + 1,
        lastError: err instanceof Error ? err.message : 'network',
      });
      failed += 1;
    }
  }

  const remaining = await db.pendingSets.where('status').anyOf(['pending', 'failed']).count();
  if (droppedEquipment.length > 0) {
    for (const listener of droppedEquipmentListeners) {
      listener(droppedEquipment);
    }
  }
  return { flushed, failed, pending: remaining, droppedEquipment };
}

// Helper: adds a set to the queue (status pending) and triggers a flush.
export async function queueSet(
  set: Omit<
    PendingSet,
    'createdAt' | 'status' | 'serverId' | 'syncedAt' | 'attempts' | 'lastError'
  >,
): Promise<PendingSet> {
  const db = getDB();
  const record: PendingSet = {
    ...set,
    createdAt: Date.now(),
    status: 'pending',
    serverId: null,
    syncedAt: null,
    attempts: 0,
    lastError: null,
  };
  await db.pendingSets.add(record);
  // Kick off the flush in the background (not awaited so as not to block the UI).
  void flushPendingSets();
  return record;
}

// Returns the equipment drops recorded for `sessionId` that nobody has shown
// yet, and clears them so they are shown exactly once (issue #337).
//
// This is the single consumer of a drop. `onEquipmentDropped` stays a *signal*
// that something changed rather than the payload itself, because a flush can
// finish while no SessionRunner is mounted (log a set offline, close the app,
// reopen on the dashboard) and a broadcast with no listener was lost. Draining
// on mount picks up exactly those, and draining on the signal covers the live
// in-session case, with the clear making the two paths idempotent rather than
// double-reporting.
//
// It also removes the ordering dependency in `SessionRunner`, where
// `bindAutoSync()` runs just before `onEquipmentDropped` registers and was only
// safe because `flushPendingSets` happens to suspend at its first `await`.
//
// Read and clear happen in one `rw` transaction, and each row is claimed by the
// cursor that nulls it, so "exactly once" holds against a concurrent drain
// rather than only against a sequential one. Two drains do overlap in practice:
// `reactStrictMode` fires the mount effect twice in development, and in
// production a broadcast can land while the mount drain is mid-await. Whichever
// transaction runs second sees the field already null and returns nothing.
export async function drainDroppedEquipment(sessionId: string): Promise<DroppedEquipment[]> {
  const db = getDB();
  return db.transaction('rw', db.pendingSets, async () => {
    const notices: DroppedEquipment[] = [];
    // `modify` reads and writes each row through one cursor, so the row is read
    // out and nulled without a window in between. It writes the whole record
    // where the previous version patched one key, which is safe only because
    // the value it writes back is the one this transaction just read: an
    // `update()` from the flush path runs in its own `rw` transaction on the
    // same store, and those cannot interleave with this one.
    await db.pendingSets
      .where('sessionId')
      .equals(sessionId)
      .modify((row) => {
        if (row.equipmentDroppedNotice == null) return;
        notices.push({
          localId: row.localId,
          sessionId: row.sessionId,
          gymEquipmentId: row.equipmentDroppedNotice,
        });
        row.equipmentDroppedNotice = null;
      });
    return notices;
  });
}

// Deletes synced sets older than `maxAgeMs` to keep Dexie lightweight.
export async function pruneSyncedSets(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const db = getDB();
  const cutoff = Date.now() - maxAgeMs;
  return db.pendingSets
    .where('status')
    .equals('synced')
    .and((s) => (s.syncedAt ?? 0) < cutoff)
    .delete();
}

// Deletes every synced set on logout (#357), so the next user of the device
// does not inherit them. Synced rows are copies of server data, so nothing is
// lost; pending, syncing and failed rows are unsynced work and are kept.
// Best-effort: never throws, so it cannot block a logout.
export async function deleteSyncedSets(): Promise<void> {
  try {
    await getDB().pendingSets.where('status').equals('synced').delete();
  } catch {
    // IndexedDB unavailable (private mode, blocked storage): nothing to clear.
  }
}

// Hook event listener to start/stop the auto-sync on online/offline.
export function bindAutoSync(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onOnline = () => {
    void flushPendingSets();
  };
  window.addEventListener('online', onOnline);
  // First flush on mount (in case some sets remain from the previous session).
  if (navigator.onLine) {
    void flushPendingSets();
  }
  return () => window.removeEventListener('online', onOnline);
}
