// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createImportQueue,
  IMPORT_QUEUE_DEFAULT_WAIT_SEC,
  IMPORT_QUEUE_MAX_WAIT_SEC,
  ImportCancelledError,
  retryAfterSeconds,
} from './import-queue';

function answer(status: number, json: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(json), { status, headers });
}

describe('retryAfterSeconds', () => {
  it('prefers the Retry-After header', () => {
    expect(retryAfterSeconds('7', { retryAfterSec: 30, error: 'Retry in 40s.' })).toBe(7);
  });

  it('falls back to the body field, then to the message of the existing routes', () => {
    expect(retryAfterSeconds(null, { retryAfterSec: 30, error: 'Retry in 40s.' })).toBe(30);
    expect(retryAfterSeconds(null, { error: 'Too many import requests. Retry in 42s.' })).toBe(42);
  });

  it('uses the default when nothing usable is sent', () => {
    expect(retryAfterSeconds(null, null)).toBe(IMPORT_QUEUE_DEFAULT_WAIT_SEC);
    expect(retryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT', {})).toBe(
      IMPORT_QUEUE_DEFAULT_WAIT_SEC,
    );
    expect(retryAfterSeconds('-5', { error: 'Nope.' })).toBe(IMPORT_QUEUE_DEFAULT_WAIT_SEC);
  });

  it('clamps to the bucket window', () => {
    expect(retryAfterSeconds('86400', null)).toBe(IMPORT_QUEUE_MAX_WAIT_SEC);
    expect(retryAfterSeconds(null, { retryAfterSec: 0.2 })).toBe(1);
  });
});

describe('createImportQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts JSON and returns the status and the parsed body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answer(200, { mode: 'preview' }));
    const queue = createImportQueue({ fetchImpl });
    const res = await queue.post('/api/import/gpx', { gpx: '<gpx/>', mode: 'preview' });

    expect(res).toEqual({ status: 200, ok: true, json: { mode: 'preview' } });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/import/gpx');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ gpx: '<gpx/>', mode: 'preview' });
  });

  it('hands a refusal back to the caller instead of throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answer(400, { error: 'Unreadable file.' }));
    const res = await createImportQueue({ fetchImpl }).post('/x', {});
    expect(res).toEqual({ status: 400, ok: false, json: { error: 'Unreadable file.' } });
  });

  it('sends one request at a time, in the order they were queued', async () => {
    const releases: Array<() => void> = [];
    const started: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      started.push(url);
      return new Promise<Response>((resolve) => {
        releases.push(() => resolve(answer(200, { url })));
      });
    });
    const queue = createImportQueue({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const all = Promise.all([queue.post('/a', {}), queue.post('/b', {}), queue.post('/c', {})]);

    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['/a']);
    releases[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['/a', '/b']);
    releases[1]!();
    await vi.advanceTimersByTimeAsync(0);
    releases[2]!();
    expect((await all).map((r) => (r.json as { url: string }).url)).toEqual(['/a', '/b', '/c']);
  });

  it('waits out a 429 for the time the header asks, then sends the same request again', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(answer(429, { error: 'Too many.' }, { 'Retry-After': '12' }))
      .mockResolvedValueOnce(answer(200, { done: true }));
    const onWait = vi.fn();
    // How many requests had gone out when the wait was declared over.
    const sentAtResume: number[] = [];
    const onResume = vi.fn(() => void sentAtResume.push(fetchImpl.mock.calls.length));
    const queue = createImportQueue({ fetchImpl, onWait, onResume });
    const pending = queue.post('/api/import/fit', { fits: ['AA=='], mode: 'confirm' });

    await vi.advanceTimersByTimeAsync(11_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onWait).toHaveBeenCalledWith(12);
    expect(onResume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    // Once per wait, when it ends and before the request goes out again.
    expect(sentAtResume).toEqual([1]);
    expect(await pending).toMatchObject({ status: 200, json: { done: true } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]).toEqual(fetchImpl.mock.calls[0]);
  });

  it('reads the wait from the message of a route that sends no header', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(answer(429, { error: 'Too many import requests. Retry in 33s.' }))
      .mockResolvedValueOnce(answer(200, {}));
    const pending = createImportQueue({ fetchImpl }).post('/api/import/tcx', {});

    await vi.advanceTimersByTimeAsync(32_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).ok).toBe(true);
  });

  it('holds the queue behind a request that is waiting', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(answer(429, {}, { 'Retry-After': '5' }))
      .mockResolvedValue(answer(200, {}));
    const queue = createImportQueue({ fetchImpl });
    const first = queue.post('/first', {});
    const second = queue.post('/second', {});

    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all([first, second]);
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(['/first', '/first', '/second']);
  });

  it('gives up after maxWaits and returns the 429', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => answer(429, {}, { 'Retry-After': '1' }));
    const pending = createImportQueue({ fetchImpl, maxWaits: 2 }).post('/x', {});
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toMatchObject({ status: 429, ok: false });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('keeps going after a request that failed', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(answer(200, {}));
    const queue = createImportQueue({ fetchImpl });
    await expect(queue.post('/a', {})).rejects.toThrow('network down');
    expect((await queue.post('/b', {})).ok).toBe(true);
  });

  it('cancels a rate-limit wait when the signal is aborted', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(async () => answer(429, {}, { 'Retry-After': '30' }));
    const queue = createImportQueue({ fetchImpl, signal: controller.signal });
    const waiting = queue.post('/a', {});
    const queued = queue.post('/b', {});
    const outcomes = Promise.allSettled([waiting, queued]);

    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    const [a, b] = await outcomes;
    expect(a.status === 'rejected' && a.reason).toBeInstanceOf(ImportCancelledError);
    expect(b.status === 'rejected' && b.reason).toBeInstanceOf(ImportCancelledError);
    // Nothing is sent after the cancel, and no timer is left behind.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a fetch aborted mid-flight as a cancel', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const queue = createImportQueue({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
    });
    const pending = queue.post('/a', {});
    const outcome = expect(pending).rejects.toBeInstanceOf(ImportCancelledError);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await outcome;
  });
});
