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
  }));
  // bulkPut is idempotent by localId.
  await db.pendingSets.bulkPut(records);
  // A row tagged with another account is left as is: it cannot belong to this
  // session, and rewriting it would hand that account's work to this one.
  await db.pendingSets
    .where('sessionId')
    .equals(sessionId)
    .modify((row) => {
      if (row.userId === undefined) row.userId = userId;
    });
}
