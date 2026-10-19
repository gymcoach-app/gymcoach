// Service-worker caches that may hold one user's responses (issue #357).
//
// Workbox keeps authenticated `GET /api/*` responses in `api-get` and app pages
// in `pages` (next.config.js), plus the next-pwa `start-url` entry. CacheStorage
// is per origin, not per account, so on a shared device the next user could be
// served the previous user's cached data until the entries expire. Every cache
// is treated as per-user except the ones that only hold build assets, so a cache
// added later is purged by default rather than leaked.

const SHARED_CACHE_PREFIXES = [
  'workbox-precache',
  'static-assets',
  'next-static-js-assets',
  'google-fonts',
];

export function isPerUserCache(name: string): boolean {
  return !SHARED_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

// Deletes the per-user caches. Best-effort: it resolves without throwing when
// CacheStorage is unavailable (server, old browser, private mode) or fails, so
// it can never block a logout or a login.
export async function purgeUserCaches(): Promise<void> {
  try {
    if (typeof window === 'undefined' || !('caches' in window)) return;
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames
        .filter(isPerUserCache)
        .map((name) => window.caches.delete(name)),
    );
  } catch {
    // A cache that cannot be read or deleted expires on its own schedule.
  }
}
