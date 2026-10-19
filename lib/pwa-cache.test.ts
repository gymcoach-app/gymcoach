import { describe, it, expect, vi, afterEach } from 'vitest';
import { isPerUserCache, purgeUserCaches } from './pwa-cache';

function stubCaches(names: string[]) {
  const deleted: string[] = [];
  const caches = {
    keys: vi.fn(async () => names),
    delete: vi.fn(async (name: string) => {
      deleted.push(name);
      return true;
    }),
  };
  vi.stubGlobal('caches', caches);
  return { caches, deleted };
}

describe('purgeUserCaches (#357)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deletes the per-user caches and keeps the build-asset caches', async () => {
    const { deleted } = stubCaches([
      'api-get',
      'pages',
      'start-url',
      'workbox-precache-v2-http://localhost/',
      'static-assets',
    ]);

    await purgeUserCaches();

    expect(deleted.sort()).toEqual(['api-get', 'pages', 'start-url']);
  });

  it('treats an unknown cache as per-user', () => {
    expect(isPerUserCache('some-future-cache')).toBe(true);
    expect(isPerUserCache('static-assets')).toBe(false);
  });

  it('resolves without throwing when CacheStorage fails', async () => {
    const { caches } = stubCaches([]);
    caches.keys.mockRejectedValueOnce(new Error('SecurityError'));

    await expect(purgeUserCaches()).resolves.toBeUndefined();
  });

  it('resolves when CacheStorage is unavailable', async () => {
    expect('caches' in window).toBe(false);
    await expect(purgeUserCaches()).resolves.toBeUndefined();
  });
});
