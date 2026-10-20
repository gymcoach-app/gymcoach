'use client';

import { useEffect } from 'react';
import { recordSignedInAccount } from '@/lib/signed-in-account';
import { bindAutoSync, pruneSyncedSets } from '@/lib/sync';

// Invisible component that starts automatic sync on mount.
// Lives in the (app)/ and (print)/ layouts, so it is active on all protected routes.
// - On mount: flush if online + listener for the 'online' event.
// - On mount: prune synced sets older than 7 days to keep Dexie lean.
// `userId` is the signed-in account, read from the session cookie by the
// server layout; the sync only sends that account's rows (issue #490). It is
// also recorded for the other tabs, which stop flushing for a previous account
// once they see it (lib/signed-in-account.ts).
export function SyncBootstrap({ userId }: { userId: string | null }) {
  useEffect(() => {
    if (userId) recordSignedInAccount(userId);
    const cleanup = bindAutoSync(userId);
    void pruneSyncedSets();
    return cleanup;
  }, [userId]);
  return null;
}
