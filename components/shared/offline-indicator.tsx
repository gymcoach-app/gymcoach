'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CloudOff, RotateCw, Wifi } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { countUnsyncedSets, flushPendingSets } from '@/lib/sync';
import { Button } from '@/components/ui/button';

// Global online/offline indicator + sync queue.
// 3 visual states:
// - Online + 0 pending: nothing (silent to avoid cluttering the nav).
// - Online + N pending: "Syncing N..." badge with a manual retry button.
// - Offline (with or without pending): orange "Offline · N pending" badge.
//
// The component is silent during initial hydration (before IndexedDB has been
// opened) to avoid a "0 pending" flash.
//
// Only the signed-in account's sets are counted and retried (issue #490): on a
// shared device, another account's queued sets stay invisible until it signs
// in again.

export function OfflineIndicator({ userId }: { userId: string | null }) {
  const t = useTranslations('common.offline');
  const [online, setOnline] = useState<boolean | null>(null);
  const [flushing, setFlushing] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const pendingCount = useLiveQuery(
    async () => {
      if (!userId) return 0;
      try {
        return await countUnsyncedSets(userId);
      } catch {
        return 0;
      }
    },
    [userId],
    0,
  );

  if (online === null) return null;

  // Online + empty queue: invisible.
  if (online && pendingCount === 0) return null;

  async function handleManualSync() {
    if (!userId) return;
    setFlushing(true);
    try {
      await flushPendingSets(userId);
    } finally {
      setFlushing(false);
    }
  }

  if (!online) {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        <CloudOff className="size-3.5" />
        <span>{pendingCount > 0 ? t('pending', { count: pendingCount }) : t('offline')}</span>
      </div>
    );
  }

  // Online with a residual queue: show in info mode, with manual retry.
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleManualSync}
      disabled={flushing}
      className="h-7 gap-1.5 px-2 text-xs"
      aria-label={t('syncNow')}
    >
      {flushing ? (
        <RotateCw className="size-3.5 animate-spin" />
      ) : (
        <Wifi className="size-3.5" />
      )}
      <span>{t('syncing', { count: pendingCount })}</span>
    </Button>
  );
}
