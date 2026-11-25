// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WORKBOX_EXPIRATION_DB,
  WORKBOX_EXPIRATION_STORE,
  isAuthPageCacheEntry,
  purgeAuthPageCacheEntries,
} from './pwa-cache';

// Issue #593: the service worker used to keep the login and signup pages in
// its `pages` cache, and before the forms had a method a submit made too early
// stored one under `/login?email=...&password=...`.

const require = createRequire(import.meta.url);
const { isCacheablePage } = require('./pwa-runtime-caching.cjs') as {
  isCacheablePage: (context: { request: { mode: string }; url: URL }) => boolean;
};

const ORIGIN = 'https://gym.example';
const navigate = (href: string) => ({ request: { mode: 'navigate' }, url: new URL(ORIGIN + href) });

describe('isCacheablePage (service worker `pages` cache)', () => {
  // Workbox writes the matcher into sw.js from its source text, so the checks
  // run on the function rebuilt from that text, as the service worker has it.
  const rebuilt = new Function(`return (${isCacheablePage.toString()});`)() as typeof isCacheablePage;

  it.each([isCacheablePage, rebuilt])('never keeps the login and signup pages (%#)', (matches) => {
    expect(matches(navigate('/login'))).toBe(false);
    expect(matches(navigate('/signup'))).toBe(false);
    expect(matches(navigate('/login?email=a%40b.c&password=hunter22'))).toBe(false);
    expect(matches(navigate('/signup?displayName=A&email=a%40b.c&password=hunter22'))).toBe(false);
  });

  it.each([isCacheablePage, rebuilt])('still keeps the app pages, and not the API (%#)', (matches) => {
    expect(matches(navigate('/'))).toBe(true);
    expect(matches(navigate('/history?month=2026-03'))).toBe(true);
    expect(matches(navigate('/session/abc'))).toBe(true);
    // A page whose name merely starts like one of the two.
    expect(matches(navigate('/login-help'))).toBe(true);
    expect(matches(navigate('/api/profile'))).toBe(false);
    expect(matches({ request: { mode: 'cors' }, url: new URL(ORIGIN + '/history') })).toBe(false);
  });

  it('is the matcher next.config.js gives the `pages` cache', () => {
    const config = readFileSync(path.join(__dirname, '..', 'next.config.js'), 'utf8');
    expect(config).toContain("require('./lib/pwa-runtime-caching.cjs')");
    expect(config).toMatch(/urlPattern: isCacheablePage,\s+handler: 'NetworkFirst',\s+options: \{\s+cacheName: 'pages'/);
  });
});

describe('isAuthPageCacheEntry', () => {
  it('names the login and signup pages and any URL carrying a password', () => {
    expect(isAuthPageCacheEntry(`${ORIGIN}/login`)).toBe(true);
    expect(isAuthPageCacheEntry(`${ORIGIN}/signup?displayName=A`)).toBe(true);
    expect(isAuthPageCacheEntry(`${ORIGIN}/?email=a%40b.c&password=hunter22`)).toBe(true);
    expect(isAuthPageCacheEntry('/login?password=x')).toBe(true);
    expect(isAuthPageCacheEntry(`${ORIGIN}/`)).toBe(false);
    expect(isAuthPageCacheEntry(`${ORIGIN}/history?month=2026-03`)).toBe(false);
    expect(isAuthPageCacheEntry(`${ORIGIN}/login-help`)).toBe(false);
  });
});

// CacheStorage holding the given URLs per cache name.
function stubCaches(content: Record<string, string[]>) {
  const store = new Map(Object.entries(content).map(([name, urls]) => [name, [...urls]]));
  vi.stubGlobal('caches', {
    keys: async () => [...store.keys()],
    open: async (name: string) => ({
      keys: async () => (store.get(name) ?? []).map((url) => ({ url })),
      delete: async (request: { url: string }) => {
        const urls = store.get(name) ?? [];
        store.set(
          name,
          urls.filter((url) => url !== request.url),
        );
        return true;
      },
    }),
  });
  return store;
}

// The part of IndexedDB the purge uses, over Workbox's expiration records.
// `exists: false` behaves as a browser does for a database never created: it
// fires upgradeneeded, and reports whether the creation was aborted.
function stubExpirationDb(records: { id: string; url: string }[], { exists = true } = {}) {
  const rows = [...records];
  const state = { opened: [] as string[], createdEmpty: false, closed: 0 };
  vi.stubGlobal('indexedDB', {
    open: (name: string) => {
      state.opened.push(name);
      const request: Record<string, unknown> = {};
      queueMicrotask(() => {
        if (!exists) {
          let aborted = false;
          request.transaction = { abort: () => (aborted = true) };
          (request.onupgradeneeded as (() => void) | undefined)?.();
          if (aborted) return (request.onerror as (() => void) | undefined)?.();
          state.createdEmpty = true;
        }
        request.result = {
          objectStoreNames: { contains: (store: string) => exists && store === WORKBOX_EXPIRATION_STORE },
          close: () => (state.closed += 1),
          transaction: () => {
            const transaction: Record<string, unknown> = {};
            transaction.objectStore = () => ({
              openCursor: () => {
                const cursorRequest: Record<string, unknown> = {};
                let index = 0;
                const step = () =>
                  queueMicrotask(() => {
                    if (index >= rows.length) {
                      cursorRequest.result = null;
                      (cursorRequest.onsuccess as () => void)();
                      return (transaction.oncomplete as () => void)();
                    }
                    cursorRequest.result = {
                      value: rows[index],
                      delete: () => {
                        rows.splice(index, 1);
                        index -= 1;
                      },
                      continue: () => {
                        index += 1;
                        step();
                      },
                    };
                    (cursorRequest.onsuccess as () => void)();
                  });
                step();
                return cursorRequest;
              },
            });
            return transaction;
          },
        };
        (request.onsuccess as (() => void) | undefined)?.();
      });
      return request;
    },
  });
  return { rows, state };
}

describe('purgeAuthPageCacheEntries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('removes the login and signup entries from every cache and keeps the rest', async () => {
    const store = stubCaches({
      pages: [
        `${ORIGIN}/`,
        `${ORIGIN}/login`,
        `${ORIGIN}/login?email=a%40b.c&password=hunter22`,
        `${ORIGIN}/signup?displayName=A&email=a%40b.c&password=hunter22`,
        `${ORIGIN}/history?month=2026-03`,
      ],
      'start-url': [`${ORIGIN}/`],
      others: [`${ORIGIN}/?email=a%40b.c&password=hunter22`, `${ORIGIN}/_next/static/app.js`],
    });
    stubExpirationDb([]);

    await purgeAuthPageCacheEntries();

    expect(store.get('pages')).toEqual([`${ORIGIN}/`, `${ORIGIN}/history?month=2026-03`]);
    expect(store.get('start-url')).toEqual([`${ORIGIN}/`]);
    expect(store.get('others')).toEqual([`${ORIGIN}/_next/static/app.js`]);
    expect(JSON.stringify([...store.values()])).not.toContain('hunter22');
  });

  it("removes the same URLs from Workbox's expiration records", async () => {
    stubCaches({});
    const { rows, state } = stubExpirationDb([
      { id: `pages|${ORIGIN}/`, url: `${ORIGIN}/` },
      { id: `pages|${ORIGIN}/login?password=hunter22`, url: `${ORIGIN}/login?password=hunter22` },
      { id: `pages|${ORIGIN}/signup`, url: `${ORIGIN}/signup` },
      { id: `api-get|${ORIGIN}/api/profile`, url: `${ORIGIN}/api/profile` },
      { id: `pages|${ORIGIN}/login`, url: `${ORIGIN}/login` },
    ]);

    await purgeAuthPageCacheEntries();

    expect(state.opened).toEqual([WORKBOX_EXPIRATION_DB]);
    expect(rows.map((row) => row.url)).toEqual([`${ORIGIN}/`, `${ORIGIN}/api/profile`]);
    expect(state.closed).toBe(1);
  });

  it('does not create the expiration database when Workbox has not', async () => {
    stubCaches({});
    const { state } = stubExpirationDb([], { exists: false });

    await expect(purgeAuthPageCacheEntries()).resolves.toBeUndefined();

    // An empty database left behind would keep Workbox from creating its store.
    expect(state.createdEmpty).toBe(false);
  });

  it('resolves without throwing when the browser refuses', async () => {
    vi.stubGlobal('caches', {
      keys: async () => {
        throw new Error('SecurityError');
      },
    });
    await expect(purgeAuthPageCacheEntries()).resolves.toBeUndefined();
    vi.unstubAllGlobals();
    // Neither CacheStorage nor IndexedDB.
    await expect(purgeAuthPageCacheEntries()).resolves.toBeUndefined();
  });
});
