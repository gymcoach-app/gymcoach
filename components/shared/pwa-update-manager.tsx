'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { purgeAuthPageCacheEntries } from '@/lib/pwa-cache';

interface Props {
  // Test seam only: production renders the manager with no props and reloads
  // through window.location. Injecting a stub keeps the lifecycle tests free
  // of a real navigation.
  reloadPage?: () => void;
}

// A live session keeps its position, mode and half-typed set in component
// state, so a forced reload there drops the lifter back to exercise 1. Updates
// arriving on these routes wait for the next navigation away or the next
// return to the tab.
const LIVE_SESSION_ROUTE_PREFIX = '/session/';

// Guard against a reload cycle across page loads (mixed-version serving during
// a rolling deploy can make each reload install the other service worker). One
// update reload per window; a second one within it keeps the current bundle
// until a natural navigation.
export const RELOAD_GUARD_STORAGE_KEY = 'gymcoach.pwa.update-reload';
export const RELOAD_GUARD_WINDOW_MS = 30_000;

export function isLiveSessionRoute(pathname: string | null): boolean {
  return pathname !== null && pathname.startsWith(LIVE_SESSION_ROUTE_PREFIX);
}

export function reloadedRecently(now = Date.now()): boolean {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_GUARD_STORAGE_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && now - at < RELOAD_GUARD_WINDOW_MS;
  } catch {
    return false;
  }
}

function markReloaded(now = Date.now()) {
  try {
    window.sessionStorage.setItem(RELOAD_GUARD_STORAGE_KEY, String(now));
  } catch {
    // Storage can be unavailable (private mode, quota); the in-page flag still
    // prevents a double reload within this page load.
  }
}

function reloadCurrentPage() {
  window.location.reload();
}

export function PwaUpdateManager({ reloadPage = reloadCurrentPage }: Props = {}) {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  // Set when a controller replacement was seen but the page could not be
  // reloaded at that moment (hidden tab, or a live session on screen).
  const reloadPendingRef = useRef(false);
  const reloadRef = useRef<() => void>(() => {});

  // Once per page load: drop what an earlier service worker cached for the
  // login and signup pages (#593).
  useEffect(() => {
    void purgeAuthPageCacheEntries();
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let controller = navigator.serviceWorker.controller;
    let reloading = false;

    function reloadForUpdate() {
      if (reloading) return;
      if (document.visibilityState === 'hidden' || isLiveSessionRoute(pathnameRef.current)) {
        reloadPendingRef.current = true;
        return;
      }
      if (reloadedRecently()) {
        reloadPendingRef.current = false;
        return;
      }

      reloading = true;
      markReloaded();
      reloadPage();
    }
    reloadRef.current = reloadForUpdate;

    function handleControllerChange() {
      // A controller appearing for the first time is the initial PWA install,
      // not an update to a page that is already running.
      if (controller === null) {
        controller = navigator.serviceWorker.controller;
        return;
      }

      reloadForUpdate();
    }

    async function checkForUpdate() {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      } catch {
        // Updates are best-effort; offline mode continues through Workbox caches.
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      if (reloadPendingRef.current) {
        reloadForUpdate();
        return;
      }
      void checkForUpdate();
    }

    function handleOnline() {
      void checkForUpdate();
    }

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    void navigator.serviceWorker.ready
      .then((registration) => registration.update())
      .catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [reloadPage]);

  // A pending update reload fires once the app navigates off the live session.
  useEffect(() => {
    pathnameRef.current = pathname;
    if (reloadPendingRef.current && !isLiveSessionRoute(pathname)) {
      reloadRef.current();
    }
  }, [pathname]);

  return null;
}
