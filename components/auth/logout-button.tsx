'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { purgeUserCaches } from '@/lib/pwa-cache';

export function LogoutButton() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      let loggedOut = true;
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch {
        // Offline: the session cookie may still be valid, so stay on the page.
        loggedOut = false;
      }
      // After the logout call so no in-flight response refills the cache
      // (#357); also when the call fails, since the device is being handed on.
      await purgeUserCaches();
      if (!loggedOut) return;
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
