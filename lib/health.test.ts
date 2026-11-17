import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lives in lib/ rather than beside the route: vitest.config.ts only includes
// lib/** and components/** as unit tests.

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $queryRaw: queryRaw } }));

import { GET } from '@/app/api/health/route';
import { HEALTH_DB_TIMEOUT_MS, isDatabaseHealthy } from '@/lib/health';
import { middleware } from '@/middleware';

const SECRET_ERROR =
  'connect ECONNREFUSED 10.1.2.3:5432 postgresql://gymcoach:hunter2@db:5432/gymcoach';

beforeEach(() => {
  queryRaw.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isDatabaseHealthy', () => {
  it('is true when the query answers', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    expect(await isDatabaseHealthy()).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('is false when the query rejects', async () => {
    queryRaw.mockRejectedValue(new Error(SECRET_ERROR));
    expect(await isDatabaseHealthy()).toBe(false);
  });

  it('is false when the client throws synchronously', async () => {
    queryRaw.mockImplementation(() => {
      throw new Error(SECRET_ERROR);
    });
    expect(await isDatabaseHealthy()).toBe(false);
  });

  it('is false once the timeout passes without an answer', async () => {
    vi.useFakeTimers();
    let release: (value: unknown) => void = () => {};
    queryRaw.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    let settled: boolean | null = null;
    const result = isDatabaseHealthy().then((value) => {
      settled = value;
      return value;
    });
    await vi.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(false);
    // Let the held query finish so the next test starts a fresh probe.
    release([]);
    await vi.advanceTimersByTimeAsync(0);
  });

  it('shares one query between callers while it is pending, then probes again', async () => {
    let release: (value: unknown) => void = () => {};
    queryRaw.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = isDatabaseHealthy();
    const second = isDatabaseHealthy();
    const third = isDatabaseHealthy();
    // The query starts on a microtask.
    await Promise.resolve();
    expect(queryRaw).toHaveBeenCalledTimes(1);
    release([]);
    expect(await Promise.all([first, second, third])).toEqual([true, true, true]);

    queryRaw.mockResolvedValueOnce([]);
    expect(await isDatabaseHealthy()).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('does not start a second query while a timed-out one is still pending', async () => {
    vi.useFakeTimers();
    let release: (value: unknown) => void = () => {};
    queryRaw.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = isDatabaseHealthy();
    await vi.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS);
    expect(await first).toBe(false);
    const second = isDatabaseHealthy();
    await vi.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS);
    expect(await second).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    release([]);
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe('GET /api/health', () => {
  it('answers 200 {"status":"ok"} and is never cached when the database answers', async () => {
    queryRaw.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('{"status":"ok"}');
  });

  it('answers 503 with a fixed body and no error detail when the query throws', async () => {
    queryRaw.mockRejectedValue(new Error(SECRET_ERROR));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).toBe('{"status":"unavailable"}');
    for (const leak of ['ECONNREFUSED', '10.1.2.3', 'hunter2', 'postgresql', 'error', 'stack']) {
      expect(text).not.toContain(leak);
    }
    // Nothing leaks through a header either.
    expect(JSON.stringify([...res.headers.entries()])).not.toMatch(/ECONNREFUSED|hunter2/);
  });

  it('answers 503 when the query does not come back in time', async () => {
    vi.useFakeTimers();
    let release: (value: unknown) => void = () => {};
    queryRaw.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const response = GET();
    await vi.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS);
    const res = await response;
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"status":"unavailable"}');
    release([]);
    await vi.advanceTimersByTimeAsync(0);
  });

  it('is rendered per request', async () => {
    const route = await import('@/app/api/health/route');
    expect(route.dynamic).toBe('force-dynamic');
  });
});

describe('middleware exemption for /api/health', () => {
  const run = (path: string) => middleware(new NextRequest(`http://gymcoach.local:3000${path}`));

  it('lets the exact path through without a session', async () => {
    const res = await run('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it.each(['/api/health/', '/api/health/db', '/api/healthz', '/api/health.json', '/api/Health'])(
    'still refuses %s without a session',
    async (path) => {
      const res = await run(path);
      expect(res.status).toBe(401);
    },
  );
});
