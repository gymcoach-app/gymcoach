// ============================================================
// Dexie: IndexedDB for the offline queue
// ============================================================
// A single table for the MVP: the sets waiting to sync.
// The other data (programs, exercises, sessions GET) is handled
// by the service worker (HTTP cache), no need for IndexedDB.
//
// IMPORTANT: this module must NEVER be imported server-side.
// The Dexie instance is only created client-side. Components
// must check `typeof window !== 'undefined'` or use
// dexie-react-hooks (which already does it).

import Dexie, { type Table } from 'dexie';

export type PendingSetStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface PendingSet {
  // Local identifier (client cuid) used as the primary key and for the
  // optimistic display before server confirmation.
  localId: string;

  // Reference to the current session. When the sync succeeds, the server set
  // is created under this sessionId.
  sessionId: string;

  exerciseId: string;
  // Concrete physical machine/equipment selected for this set. Optional keeps
  // IndexedDB rows written before equipment selection backward-compatible.
  gymEquipmentId?: string | null;
  setNumber: number;
  weight: number;
  reps: number;
  rir: number | null;
  // Cardio sets (issue #133): duration in seconds and optional distance in
  // meters. Null on strength sets. Optional so records written before the
  // field existed (which lack the keys entirely) stay valid.
  durationSec?: number | null;
  distanceM?: number | null;
  notes: string | null;
  isWarmup: boolean;
  isDropSet: boolean;
  // Block of a deliberately repeated exercise (issue #429, see
  // lib/exercise-blocks.ts). Optional, so rows written before the field
  // existed stay valid; absent and null read as the first occurrence.
  block?: number | null;

  createdAt: number; // epoch ms
  status: PendingSetStatus;
  // If synced: server id returned by the API. Allows reconciliation
  // with the UI state and avoids double-POST on retry.
  serverId: string | null;
  syncedAt: number | null;
  // Counter of failed attempts (for possible backoff).
  attempts: number;
  lastError: string | null;
  // Set when the server dropped this set's equipment reference and the user has
  // not been told yet (issue #337). Holds the id that was dropped, since
  // `gymEquipmentId` is nulled at the same moment.
  //
  // Persisted rather than only broadcast: a flush can complete with no
  // SessionRunner mounted (`sync-bootstrap` binds auto-sync app-wide, so one
  // fires at startup on any page) and a notice delivered to no listener was
  // gone for good. Cleared by `drainDroppedEquipment` once it has been shown.
  // Optional, so rows written before this field stay valid.
  equipmentDroppedNotice?: string | null;
}

class GymCoachDB extends Dexie {
  pendingSets!: Table<PendingSet, string>;

  constructor() {
    super('GymCoachDB');
    this.version(1).stores({
      // Primary key: localId. Secondary indexes: sessionId (to filter
      // a session's sets), status (to scan the pending ones).
      pendingSets: 'localId, sessionId, status, createdAt',
    });
  }
}

let _db: GymCoachDB | null = null;

export function getDB(): GymCoachDB {
  if (typeof window === 'undefined') {
    throw new Error('IndexedDB is only available client-side.');
  }
  if (!_db) _db = new GymCoachDB();
  return _db;
}

// Generates a simple cuid client-side (good enough for localIds).
// We use crypto.randomUUID if available, otherwise fall back to Math.random.
export function generateLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `loc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `loc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
