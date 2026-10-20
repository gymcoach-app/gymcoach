'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { purgeUserCaches } from '@/lib/pwa-cache';
import { recordSignedInAccount } from '@/lib/signed-in-account';
import { deleteSyncedSets } from '@/lib/sync';

export function LogoutButton() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      // Purge first, so the cached data is gone even when the call below fails
      // and the device is handed on anyway (#357).
      await purgeUserCaches();

      let loggedOut = false;
      try {
        const res = await fetch('/api/auth/logout', { method: 'POST' });
        loggedOut = res.ok;
      } catch {
        // Offline: handled below like a refused call.
      }
      if (!loggedOut) {
        // The session cookie is still valid, so do not pretend otherwise.
        toast.error(t('logoutFailed'));
        return;
      }

      // Purge again: a GET started before the first purge can complete and be
      // cached in between. This removes everything cached up to this point; a
      // response still in flight afterwards can still land, and expires on its
      // own schedule or is purged by the next login.
      await purgeUserCaches();
      await deleteSyncedSets();
      // Tells the other open tabs to stop flushing this account's queue (#490).
      recordSignedInAccount(null);
      router.replace('/login');
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleLogout}
      disabled={isPending}
      aria-label={t('logout')}
    >
      <LogOut className="size-4" />
      <span className="ml-2 hidden sm:inline">{t('logout')}</span>
    </Button>
  );
}
