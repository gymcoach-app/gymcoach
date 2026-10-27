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

// Memory bounds. Keys come partly from client input (the client IP), so once
// the map grows past SWEEP_AT it is swept of expired buckets (at most once per
// SWEEP_INTERVAL_MS, so a flood of new keys does not pay for a full scan each
// time), and it never holds more than MAX_BUCKETS: when it is full, the oldest
// bucket (first in insertion order) is dropped to make room.
const SWEEP_AT = 10_000;
const SWEEP_INTERVAL_MS = 1_000;
const MAX_BUCKETS = 50_000;
let lastSweepAt = Number.NEGATIVE_INFINITY;

function makeRoom(now: number): void {
  if (buckets.size < SWEEP_AT) return;
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS) {
    lastSweepAt = now;
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next();
    if (oldest.done) break;
    buckets.delete(oldest.value);
  }
}

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
    // Delete first so a renewed key moves to the end of the insertion order.
    buckets.delete(key);
    makeRoom(now);
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
// default 1). 0 means the app port is reached directly, with no proxy.
// Anything that is not a whole number falls back to the default.
export function trustedProxyHops(raw: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
  if (raw === undefined || !/^\s*\d+\s*$/.test(raw)) return 1;
  const hops = Number(raw);
  return Number.isSafeInteger(hops) ? hops : 1;
}

// The single rate-limit key used with TRUSTED_PROXY_HOPS=0.
export const DIRECT_CLIENT = 'direct';

// Client IP for rate limiting. Proxies append the address they received the
// request from to X-Forwarded-For, after whatever the client sent, so only the
// right end of the list is trustworthy: with N trusted proxies the client is
// the Nth entry from the right (the leftmost one when the list is shorter).
// Reading the leftmost entry would let a client pick its own rate-limit bucket
// (found in the review of #505). Without X-Forwarded-For, X-Real-IP is used.
//
// With 0 hops there is no proxy, and no trustworthy address either: Next.js
// fills X-Forwarded-For from the socket only when the request has none, so a
// client that sends its own header picks the value, and route handlers have
// no other access to the peer address. Every client then shares one key, so
// spoofing cannot buy fresh buckets; the cost is that all visitors share the
// login and signup budget, which is why a proxy is the recommended setup.
export function clientIp(req: Request, hops: number = trustedProxyHops()): string {
  if (hops < 1) return DIRECT_CLIENT;
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

// Test helper: how many buckets are held.
export function rateLimitBucketCount(): number {
  return buckets.size;
}

// Test helper: clears all buckets.
export function resetRateLimits(): void {
  buckets.clear();
  lastSweepAt = Number.NEGATIVE_INFINITY;
}
