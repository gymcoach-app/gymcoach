// Hydrates IndexedDB with the sets fetched from the server.
// Idempotent: uses localId = "srv_${serverId}" as the primary key,
// so re-running the function does not create duplicates.
//
// Strategy: on every SessionRunner mount, we call hydrate with the
// server-side sets. IndexedDB thus becomes the single source of truth
// for display (the components use useLiveQuery on Dexie).

import type { Set as PrismaSet } from '@/lib/prisma-client';
import { getDB, type PendingSet } from '@/lib/indexeddb';

export async function hydrateFromServerSets(
  sessionId: string,
  serverSets: PrismaSet[],
): Promise<void> {
  const db = getDB();
  const records: PendingSet[] = serverSets.map((s) => ({
    localId: `srv_${s.id}`,
    sessionId,
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
}
