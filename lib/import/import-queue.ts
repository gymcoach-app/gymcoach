// ============================================================
// Sequential import request queue (issue #582) - browser side
// ============================================================
// Every import route charges the same per-user bucket (import:<userId>, 10
// requests a minute, see the routes under app/api/import). A Strava archive
// needs far more requests than one window allows, so they go out one at a
// time, in order, and a 429 is waited out and retried instead of surfaced.
//
// How long to wait, in order of preference: the Retry-After header (seconds),
// a retryAfterSec field in the JSON body, the "Retry in 42s." of the error
// message (what the FIT, GPX and TCX routes send today), then a default.

export class ImportCancelledError extends Error {
  constructor() {
    super('Import cancelled.');
    this.name = 'ImportCancelledError';
  }
}

export interface ImportQueueResponse {
  status: number;
  ok: boolean;
  // The parsed JSON body, or null when there was none.
  json: unknown;
}

export interface ImportQueueOptions {
  fetchImpl?: typeof fetch;
  // Injectable for tests; the default is an abortable setTimeout.
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  // Called before each rate-limit wait with its length in seconds.
  onWait?: (seconds: number) => void;
  // Aborting rejects the pending and the queued requests with
  // ImportCancelledError, including one that is waiting out a 429.
  signal?: AbortSignal;
  // 429 answers tolerated for ONE request before it fails.
  maxWaits?: number;
}

export interface ImportQueue {
  post(url: string, body: unknown): Promise<ImportQueueResponse>;
}

export const IMPORT_QUEUE_DEFAULT_WAIT_SEC = 10;
// The bucket window is 60 s, so no honest answer asks for more.
export const IMPORT_QUEUE_MAX_WAIT_SEC = 60;
export const IMPORT_QUEUE_MAX_WAITS = 5;

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ImportCancelledError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ImportCancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function wholeSeconds(value: unknown): number | null {
  const n = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

// Seconds to wait after a 429, clamped to 1..IMPORT_QUEUE_MAX_WAIT_SEC.
export function retryAfterSeconds(header: string | null | undefined, json: unknown): number {
  const body = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const fromMessage =
    typeof body.error === 'string' ? /retry in (\d{1,4})\s*s/i.exec(body.error)?.[1] : undefined;
  const seconds =
    wholeSeconds(header) ??
    wholeSeconds(body.retryAfterSec) ??
    wholeSeconds(fromMessage) ??
    IMPORT_QUEUE_DEFAULT_WAIT_SEC;
  return Math.min(IMPORT_QUEUE_MAX_WAIT_SEC, Math.max(1, seconds));
}

export function createImportQueue(options: ImportQueueOptions = {}): ImportQueue {
  const {
    sleep = abortableSleep,
    onWait,
    signal,
    maxWaits = IMPORT_QUEUE_MAX_WAITS,
  } = options;
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  // The tail of the chain: a request starts when the one before it settled.
  let tail: Promise<unknown> = Promise.resolve();

  async function send(url: string, body: unknown): Promise<ImportQueueResponse> {
    const payload = JSON.stringify(body);
    for (let waits = 0; ; waits++) {
      if (signal?.aborted) throw new ImportCancelledError();
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal,
        });
      } catch (err) {
        if (signal?.aborted) throw new ImportCancelledError();
        throw err;
      }
      const json: unknown = await res.json().catch(() => null);
      if (res.status !== 429 || waits >= maxWaits) {
        return { status: res.status, ok: res.ok, json };
      }
      const seconds = retryAfterSeconds(res.headers?.get('retry-after'), json);
      onWait?.(seconds);
      await sleep(seconds * 1000, signal);
    }
  }

  return {
    post(url, body) {
      const next = tail.then(
        () => send(url, body),
        () => send(url, body),
      );
      tail = next.catch(() => undefined);
      return next;
    },
  };
}
