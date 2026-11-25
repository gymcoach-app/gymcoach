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

// ============================================================
// Login and signup pages are never kept (issue #593)
// ============================================================
// Before #593 a login or signup form submitted before the page was
// interactive went out as a GET, and the service worker stored the answer in
// the `pages` cache under its full URL, password included. The service worker
// no longer caches these two pages (lib/pwa-runtime-caching.cjs); this removes
// what an earlier version stored, from every cache and from the URL list
// Workbox keeps beside them for expiration.

// Whether a cached URL is a login or signup page, or carries a password.
export function isAuthPageCacheEntry(href: string): boolean {
  try {
    const url = new URL(href, 'http://local.invalid');
    return (
      url.pathname === '/login' || url.pathname === '/signup' || url.searchParams.has('password')
    );
  } catch {
    return false;
  }
}

// Workbox's expiration plugin: one record per cached URL, `url` included.
export const WORKBOX_EXPIRATION_DB = 'workbox-expiration';
export const WORKBOX_EXPIRATION_STORE = 'cache-entries';

function purgeAuthPagesFromWorkboxExpiration(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve();
    const open = indexedDB.open(WORKBOX_EXPIRATION_DB);
    // Asked to create the database: it did not exist, so there is nothing to
    // clean. Abort, or an empty database would be left where Workbox expects
    // to create its own store.
    open.onupgradeneeded = () => open.transaction?.abort();
    open.onerror = () => resolve();
    open.onblocked = () => resolve();
    open.onsuccess = () => {
      const database = open.result;
      const done = () => {
        database.close();
        resolve();
      };
      try {
        if (!database.objectStoreNames.contains(WORKBOX_EXPIRATION_STORE)) return done();
        const transaction = database.transaction(WORKBOX_EXPIRATION_STORE, 'readwrite');
        transaction.oncomplete = done;
        transaction.onerror = done;
        transaction.onabort = done;
        const cursorRequest = transaction.objectStore(WORKBOX_EXPIRATION_STORE).openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const url = (cursor.value as { url?: unknown } | undefined)?.url;
          if (typeof url === 'string' && isAuthPageCacheEntry(url)) cursor.delete();
          cursor.continue();
        };
      } catch {
        done();
      }
    };
  });
}

// Best-effort, like purgeUserCaches: resolves without throwing whatever the
// browser supports or refuses. The two stores are cleaned apart, so a failure
// of one does not skip the other.
export async function purgeAuthPageCacheEntries(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if ('caches' in window) {
      for (const name of await window.caches.keys()) {
        const cache = await window.caches.open(name);
        for (const request of await cache.keys()) {
          if (isAuthPageCacheEntry(request.url)) await cache.delete(request);
        }
      }
    }
  } catch {
    // What cannot be removed here expires on Workbox's own schedule.
  }
  try {
    await purgeAuthPagesFromWorkboxExpiration();
  } catch {
    // Same: the records go when Workbox expires their entries.
  }
}
