// Hydrates IndexedDB with the sets fetched from the server.
// Idempotent: uses localId = "srv_${serverId}" as the primary key,
// so re-running the function does not create duplicates.
//
// Strategy: on every SessionRunner mount, we call hydrate with the
// server-side sets. IndexedDB thus becomes the single source of truth
// for display (the components use useLiveQuery on Dexie).
//
// Ownership (issue #490): the page that renders the runner loaded the
// session scoped to the signed-in user, so this is the one place that knows
// who owns `sessionId`. Server rows are tagged with that user, and queued rows
// of this session written before rows carried a `userId` are claimed by them,
// so they count in that user's offline badge right away. The sync would also
// tag them on its first 2xx for them (lib/sync.ts).

import type { Set as PrismaSet } from '@/lib/prisma-client';
import { getDB, type PendingSet } from '@/lib/indexeddb';

export async function hydrateFromServerSets(
  sessionId: string,
  serverSets: PrismaSet[],
  userId: string,
): Promise<void> {
  const db = getDB();

  // Delete any existing rows that have a serverId matching the server sets
  // we're about to insert. This prevents duplicates when a set was logged
  // locally (with a generated localId), synced to server (got a serverId),
  // and now we're hydrating after a page reload (would create a new row with
  // localId srv_${serverId}). Without this, language switches mid-workout
  // duplicate every logged set.
  //
  // IMPORTANT: Only delete synced rows. Rows with status 'pending', 'syncing',
  // or 'failed' have unsaved local changes that must not be discarded. The sync
  // queue will reconcile them after hydration completes.
  //
  // ALSO IMPORTANT: Preserve equipmentDroppedNotice (#337) from deleted rows.
  // When the server refuses a set's equipment, the sync writes the notice on
  // the synced row so the runner can show "machine was not recorded". We must
  // copy it to the new srv_ record before deleting the old one, otherwise the
  // notice is lost.
  const serverIds = new Set(serverSets.map((s) => s.id));

  // Wrap read + delete + bulkPut in one transaction to avoid race conditions:
  // - No live query flicker showing sets temporarily missing
  // - No edit/delete handlers can target a row between delete and bulkPut
  await db.transaction('rw', db.pendingSets, async () => {
    // Read existing synced rows to extract equipmentDroppedNotice values
    const existingSynced = await db.pendingSets
      .where('sessionId')
      .equals(sessionId)
      .filter((row) => row.serverId != null && serverIds.has(row.serverId) && row.status === 'synced')
      .toArray();

    const droppedNotices = new Map<string, string>();
    for (const row of existingSynced) {
      if (row.serverId && row.equipmentDroppedNotice) {
        droppedNotices.set(row.serverId, row.equipmentDroppedNotice);
      }
    }

    // Delete the synced rows
    await db.pendingSets
      .where('sessionId')
      .equals(sessionId)
      .filter((row) => row.serverId != null && serverIds.has(row.serverId) && row.status === 'synced')
      .delete();

    // Build srv_ records, preserving equipmentDroppedNotice where present
    const records: PendingSet[] = serverSets.map((s) => ({
      localId: `srv_${s.id}`,
      sessionId,
      userId,
      exerciseId: s.exerciseId,
      gymEquipmentId: s.gymEquipmentId,
      setNumber: s.setNumber,
      weight: s.weight,
      reps: s.reps,
      rir: s.rir,
      durationSec: s.durationSec,
      distanceM: s.distanceM,
      notes: s.notes,
      isWarmup: s.isWarmup,
      isDropSet: s.isDropSet,
      block: s.block,
      createdAt: new Date(s.completedAt).getTime(),
      status: 'synced',
      serverId: s.id,
      syncedAt: new Date(s.completedAt).getTime(),
      attempts: 0,
      lastError: null,
      // Preserve equipmentDroppedNotice from the deleted row if it had one
      ...(droppedNotices.has(s.id) ? { equipmentDroppedNotice: droppedNotices.get(s.id) } : {}),
    }));

    // bulkPut is idempotent by localId.
    await db.pendingSets.bulkPut(records);
  });
  // A row tagged with another account is left as is: it cannot belong to this
  // session, and rewriting it would hand that account's work to this one.
  await db.pendingSets
    .where('sessionId')
    .equals(sessionId)
    .modify((row) => {
      if (row.userId === undefined) row.userId = userId;
    });
}
