import { isIP } from 'node:net';

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

// Buckets live in one map per window length, so a flood of short-window keys
// (login, signup: one minute, keyed by client IP) can only evict other
// short-window buckets, never a long one such as the coach's daily cap. The
// window lengths are a small fixed set chosen in code, so the number of maps
// stays bounded too.
const bucketsByWindow = new Map<number, Map<string, Bucket>>();

// Memory bounds per map. Keys come partly from client input (the client IP),
// so once a map grows past SWEEP_AT it is swept of expired buckets (at most
// once per SWEEP_INTERVAL_MS, so a flood of new keys does not pay for a full
// scan each time), and it never holds more than MAX_BUCKETS: when it is full,
// the oldest bucket (first in insertion order) is dropped to make room. Keys
// are cut to MAX_KEY_LENGTH as a second bound on their size.
const SWEEP_AT = 10_000;
const SWEEP_INTERVAL_MS = 1_000;
const MAX_BUCKETS = 50_000;
const MAX_KEY_LENGTH = 200;
const lastSweepAt = new Map<number, number>();

function makeRoom(buckets: Map<string, Bucket>, windowMs: number, now: number): void {
  if (buckets.size < SWEEP_AT) return;
  if (now - (lastSweepAt.get(windowMs) ?? Number.NEGATIVE_INFINITY) >= SWEEP_INTERVAL_MS) {
    lastSweepAt.set(windowMs, now);
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
  key = key.slice(0, MAX_KEY_LENGTH);
  let buckets = bucketsByWindow.get(windowMs);
  if (!buckets) {
    buckets = new Map();
    bucketsByWindow.set(windowMs, buckets);
  }
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    // Delete first so a renewed key moves to the end of the insertion order.
    buckets.delete(key);
    makeRoom(buckets, windowMs, now);
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
//
// The chosen entry ends up in a bucket key, and with the default of one hop a
// client that reaches the port directly writes it, so only an IPv4 or IPv6
// literal (optionally with a port, see below) is used; anything else reads as
// 'unknown'.
export function clientIp(req: Request, hops: number = trustedProxyHops()): string {
  if (hops < 1) return DIRECT_CLIENT;
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const entries = xff
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length === 0) return 'unknown';
    return ipOrUnknown(entries[Math.max(0, entries.length - hops)]!);
  }
  return ipOrUnknown(req.headers.get('x-real-ip')?.trim() ?? '');
}

// Some proxies (Azure App Service and Application Gateway, IIS ARR) append the
// client port: `203.0.113.7:4444`, `[2001:db8::1]:443`. The port is dropped
// so each visitor keeps their own bucket; a bare IPv6 address keeps its colons.
const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const BRACKETED_IPV6 = /^\[([0-9A-Fa-f:.]+)\](?::\d{1,5})?$/;

function ipOrUnknown(value: string): string {
  const address = IPV4_WITH_PORT.exec(value)?.[1] ?? BRACKETED_IPV6.exec(value)?.[1] ?? value;
  return isIP(address) === 0 ? 'unknown' : address;
}

// Test helper: how many buckets are held.
export function rateLimitBucketCount(): number {
  let count = 0;
  for (const buckets of bucketsByWindow.values()) count += buckets.size;
  return count;
}

// Test helper: clears all buckets.
export function resetRateLimits(): void {
  bucketsByWindow.clear();
  lastSweepAt.clear();
}
