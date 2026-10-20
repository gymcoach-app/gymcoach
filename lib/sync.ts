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
// 5. Every flush runs for one account (issue #490): it sends that account's
//    rows and never another account's, and stops as soon as another tab
//    records a different signed-in account (lib/signed-in-account.ts). Rows
//    without a `userId` (written before the field existed) are sent too, and
//    the server decides: a 2xx proves the session is the cookie user's, so the
//    row is tagged with that user; a 404 means another account's session, so
//    the row is put back untouched for its owner.

import { getDB, type PendingSet } from '@/lib/indexeddb';
import { isSignedInAccount } from '@/lib/signed-in-account';

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

// A row `userId` may send: its own, or an untagged legacy one whose owner only
// the server can tell (see `PendingSet.userId`).
function sendableBy(row: PendingSet, userId: string): boolean {
  return row.userId === userId || row.userId === undefined;
}

// Rows the flush may send for `userId`, oldest first.
async function queuedRowsOf(userId: string): Promise<PendingSet[]> {
  const rows = await getDB()
    .pendingSets.where('status')
    .anyOf(['pending', 'failed'])
    .sortBy('createdAt');
  return rows.filter((row) => sendableBy(row, userId));
}

// Marks a queued row `syncing` for this flush, unless it is no longer queued
// (another tab's flush claimed it) or now belongs to another account. Read and
// write share one `rw` transaction, which IndexedDB runs one at a time per
// store, so two flushes, in this tab or another, never send the same row.
// Returns the row as claimed, or null to skip it.
async function claimRow(localId: string, userId: string): Promise<PendingSet | null> {
  const db = getDB();
  return db.transaction('rw', db.pendingSets, async () => {
    const row = await db.pendingSets.get(localId);
    if (!row || (row.status !== 'pending' && row.status !== 'failed')) return null;
    if (!sendableBy(row, userId)) return null;
    await db.pendingSets.update(localId, { status: 'syncing' });
    return row;
  });
}

// Number of `userId`'s sets not yet confirmed by the server, for the offline
// badge. Counts `syncing` too, unlike the flush, since those are still unsaved.
// Untagged legacy rows are not counted for anyone: their owner is unknown
// until a flush hears back from the server, which tags them.
export async function countUnsyncedSets(userId: string): Promise<number> {
  return getDB()
    .pendingSets.where('status')
    .anyOf(['pending', 'syncing', 'failed'])
    .filter((row) => row.userId === userId)
    .count();
}

let inFlight: { userId: string; run: Promise<FlushResult> } | null = null;

export async function flushPendingSets(userId: string): Promise<FlushResult> {
  // Re-entrancy: if a flush for the same account is already running, we
  // return its promise. One for another account (a sign-out and sign-in in
  // the same tab) is waited for first, so two accounts never flush at once.
  while (inFlight) {
    if (inFlight.userId === userId) return inFlight.run;
    await inFlight.run.catch(() => undefined);
  }
  const run = doFlush(userId);
  inFlight = { userId, run };
  try {
    return await run;
  } finally {
    if (inFlight?.run === run) inFlight = null;
  }
}

async function doFlush(userId: string): Promise<FlushResult> {
  const db = getDB();
  const pending = await queuedRowsOf(userId);

  let flushed = 0;
  let failed = 0;
  const droppedEquipment: DroppedEquipment[] = [];

  for (const queued of pending) {
    if (!navigator.onLine) {
      // No point trying if we know we are offline.
      break;
    }
    // Another tab signed in a different account (or logged out): this tab's
    // cookie now belongs to someone else, so stop before sending anything.
    if (!isSignedInAccount(userId)) break;
    const item = await claimRow(queued.localId, userId);
    if (!item) continue;
    const legacy = item.userId === undefined;
    // A 2xx proves the session is the cookie user's (the routes scope by
    // user), so an untagged row becomes this account's.
    const owner = legacy ? { userId } : {};

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

      if (legacy && res.status === 404) {
        // Not this account's session (or set): put the row back exactly as it
        // was, untagged and not failed, so its owner can still send it.
        await db.pendingSets.update(item.localId, { status: item.status });
        continue;
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
              ? { status: 'synced', serverId: saved.id, syncedAt: Date.now(), lastError: null, ...owner }
              : { status: 'pending', serverId: saved.id, lastError: null, ...owner },
          );
        });
      } else {
        await db.pendingSets.update(item.localId, {
          status: 'synced',
          serverId: saved.id,
          syncedAt: Date.now(),
          lastError: null,
          ...owner,
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

  const remaining = (await queuedRowsOf(userId)).length;
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
    'userId' | 'createdAt' | 'status' | 'serverId' | 'syncedAt' | 'attempts' | 'lastError'
  > & { userId: string },
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
  void flushPendingSets(set.userId);
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
// lost; pending, syncing and failed rows are unsynced work and are kept, out
// of sight of any other account until their own user signs in again (#490).
// Best-effort: never throws, so it cannot block a logout.
export async function deleteSyncedSets(): Promise<void> {
  try {
    await getDB().pendingSets.where('status').equals('synced').delete();
  } catch {
    // IndexedDB unavailable (private mode, blocked storage): nothing to clear.
  }
}

// Hook event listener to start/stop the auto-sync on online/offline, for the
// account this page was rendered for. Without one (no session) there is
// nothing to send. Each flush checks that this account is still the one the
// browser is signed in to, so a tab left open after another tab switched
// accounts sends nothing (lib/signed-in-account.ts).
export function bindAutoSync(userId: string | null): () => void {
  if (typeof window === 'undefined' || !userId) return () => {};
  const onOnline = () => {
    void flushPendingSets(userId);
  };
  window.addEventListener('online', onOnline);
  // First flush on mount: sets left from an earlier visit, including this
  // account's rows queued before another account used the device.
  if (navigator.onLine) {
    void flushPendingSets(userId);
  }
  return () => window.removeEventListener('online', onOnline);
}
