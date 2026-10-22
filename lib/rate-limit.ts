// ============================================================
// In-memory fixed-window rate limiter
// ============================================================
// Lightweight protection for auth endpoints on a single-process self-hosted
// deployment. Not shared across instances; for a multi-instance deployment,
// back this with Redis instead.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

// Allows `limit` calls per `windowMs` for a given key. `now` is injectable for
// deterministic tests.
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (bucket.count < limit) {
    bucket.count += 1;
    return { ok: true, retryAfterSec: 0 };
  }
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
}

// How many reverse proxies sit in front of the app (TRUSTED_PROXY_HOPS,
// default 1). Anything that is not a whole number of at least 1 falls back to
// the default.
export function trustedProxyHops(raw: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
  if (raw === undefined || !/^\s*\d+\s*$/.test(raw)) return 1;
  const hops = Number(raw);
  return Number.isSafeInteger(hops) && hops >= 1 ? hops : 1;
}

// Client IP for rate limiting. Proxies append the address they received the
// request from to X-Forwarded-For, after whatever the client sent, so only the
// right end of the list is trustworthy: with N trusted proxies the client is
// the Nth entry from the right (the leftmost one when the list is shorter).
// Reading the leftmost entry would let a client pick its own rate-limit bucket
// (found in the review of #505). Without X-Forwarded-For, X-Real-IP is used.
export function clientIp(req: Request, hops: number = trustedProxyHops()): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const entries = xff
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length === 0) return 'unknown';
    return entries[Math.max(0, entries.length - hops)]!;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

// Test helper: clears all buckets.
export function resetRateLimits(): void {
  buckets.clear();
}
