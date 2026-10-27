import { describe, it, expect, beforeEach } from 'vitest';
import {
  DIRECT_CLIENT,
  clientIp,
  rateLimit,
  rateLimitBucketCount,
  resetRateLimits,
  trustedProxyHops,
} from './rate-limit';

beforeEach(() => resetRateLimits());

describe('rateLimit', () => {
  it('allows up to the limit within the window, then blocks', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k', 3, 1000, t0).ok).toBe(true);
    }
    const blocked = rateLimit('k', 3, 1000, t0 + 500);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('resets after the window elapses', () => {
    const t0 = 2_000_000;
    expect(rateLimit('k2', 1, 1000, t0).ok).toBe(true);
    expect(rateLimit('k2', 1, 1000, t0 + 100).ok).toBe(false);
    expect(rateLimit('k2', 1, 1000, t0 + 1000).ok).toBe(true);
  });

  it('tracks each key independently', () => {
    const t0 = 3_000_000;
    expect(rateLimit('a', 1, 1000, t0).ok).toBe(true);
    expect(rateLimit('b', 1, 1000, t0).ok).toBe(true);
    expect(rateLimit('a', 1, 1000, t0).ok).toBe(false);
  });
});

describe('rateLimit memory bounds', () => {
  it('sweeps expired buckets once the map is large', () => {
    const t0 = 4_000_000;
    for (let i = 0; i < 10_000; i++) rateLimit(`old:${i}`, 5, 1000, t0);
    expect(rateLimitBucketCount()).toBe(10_000);
    // All of them have expired; the next new key triggers a sweep.
    rateLimit('fresh', 5, 1000, t0 + 1000);
    expect(rateLimitBucketCount()).toBe(1);
  });

  it('keeps live buckets through a sweep', () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 10_000; i++) rateLimit(`live:${i}`, 5, 60_000, t0);
    rateLimit('fresh', 5, 60_000, t0 + 1000);
    expect(rateLimitBucketCount()).toBe(10_001);
    // A sweep did not reset a live bucket's count.
    for (let i = 0; i < 4; i++) rateLimit('live:0', 5, 60_000, t0 + 1000);
    expect(rateLimit('live:0', 5, 60_000, t0 + 1000).ok).toBe(false);
  });

  it('never holds more than the hard cap, dropping the oldest bucket', () => {
    const t0 = 6_000_000;
    for (let i = 0; i < 50_000; i++) rateLimit(`k:${i}`, 1, 60_000, t0);
    expect(rateLimitBucketCount()).toBe(50_000);
    rateLimit('one-more', 1, 60_000, t0);
    expect(rateLimitBucketCount()).toBe(50_000);
    // The oldest key was dropped, so it starts a fresh window; the newest stays blocked.
    expect(rateLimit('k:0', 1, 60_000, t0).ok).toBe(true);
    expect(rateLimit('k:49999', 1, 60_000, t0).ok).toBe(false);
  });
});

describe('rateLimit keys and windows', () => {
  it('cuts a long key, so its size stays bounded', () => {
    const t0 = 7_000_000;
    const long = 'k'.repeat(10 * 1024);
    expect(rateLimit(long, 1, 1000, t0).ok).toBe(true);
    // Same first 200 characters: the same bucket.
    expect(rateLimit(`${long}different`, 1, 1000, t0).ok).toBe(false);
  });

  it('a flood of short-window keys does not evict a long-window bucket', () => {
    const t0 = 8_000_000;
    const day = 24 * 60 * 60_000;
    expect(rateLimit('coach-day:u', 1, day, t0).ok).toBe(true);
    for (let i = 0; i < 50_001; i++) rateLimit(`login:${i}`, 1, 60_000, t0);
    expect(rateLimit('coach-day:u', 1, day, t0).ok).toBe(false);
  });
});

describe('clientIp', () => {
  const req = (headers: Record<string, string>) => new Request('http://x/', { headers });

  it('takes the entry the nearest proxy added, ignoring a client-supplied leftmost one', () => {
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }), 1)).toBe('203.0.113.7');
    expect(clientIp(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.7' }), 1)).toBe(
      '203.0.113.7',
    );
  });

  it('counts back one entry per trusted proxy', () => {
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 10.0.0.2' }), 2)).toBe(
      '203.0.113.7',
    );
  });

  it('uses the leftmost entry when the list is shorter than the hops', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7' }), 3)).toBe('203.0.113.7');
    expect(clientIp(req({ 'x-forwarded-for': '10.111.1.1' }), 1)).toBe('10.111.1.1');
  });

  it('ignores whitespace and empty entries', () => {
    expect(clientIp(req({ 'x-forwarded-for': ' 6.6.6.6 ,, 203.0.113.7 , ' }), 1)).toBe(
      '203.0.113.7',
    );
    expect(clientIp(req({ 'x-forwarded-for': ' , ' }), 1)).toBe('unknown');
  });

  it('ignores forwarded headers with 0 hops, so every direct client shares one key', () => {
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6' }), 0)).toBe(DIRECT_CLIENT);
    expect(clientIp(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }), 0)).toBe(DIRECT_CLIENT);
    expect(clientIp(req({ 'x-real-ip': '203.0.113.9' }), 0)).toBe(DIRECT_CLIENT);
    expect(clientIp(req({}), 0)).toBe(DIRECT_CLIENT);
  });

  it('reads anything but an IP literal as unknown, however long', () => {
    expect(clientIp(req({ 'x-forwarded-for': 'x'.repeat(10 * 1024) }), 1)).toBe('unknown');
    expect(clientIp(req({ 'x-forwarded-for': `1.1.1.1, ${'9'.repeat(10 * 1024)}` }), 1)).toBe(
      'unknown',
    );
    expect(clientIp(req({ 'x-forwarded-for': 'not-an-ip' }), 1)).toBe('unknown');
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7:' }), 1)).toBe('unknown');
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7:123456' }), 1)).toBe('unknown');
    expect(clientIp(req({ 'x-forwarded-for': '[not-an-ip]:443' }), 1)).toBe('unknown');
    expect(clientIp(req({ 'x-real-ip': 'evil' }), 1)).toBe('unknown');
    expect(clientIp(req({ 'x-forwarded-for': '2001:db8::1' }), 1)).toBe('2001:db8::1');
  });

  it('drops a port that a proxy appended, keeping a bare IPv6 address intact', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7:4444' }), 1)).toBe('203.0.113.7');
    expect(clientIp(req({ 'x-forwarded-for': '[2001:db8::1]:443' }), 1)).toBe('2001:db8::1');
    expect(clientIp(req({ 'x-forwarded-for': '[2001:db8::1]' }), 1)).toBe('2001:db8::1');
    expect(clientIp(req({ 'x-forwarded-for': '2001:db8::1:443' }), 1)).toBe('2001:db8::1:443');
    expect(clientIp(req({ 'x-real-ip': '198.51.100.4:80' }), 1)).toBe('198.51.100.4');
  });

  it('falls back to X-Real-IP, then unknown, without X-Forwarded-For', () => {
    expect(clientIp(req({ 'x-real-ip': ' 203.0.113.9 ' }), 1)).toBe('203.0.113.9');
    expect(clientIp(req({}), 1)).toBe('unknown');
  });
});

describe('trustedProxyHops', () => {
  it('reads a whole number and falls back to 1 otherwise', () => {
    expect(trustedProxyHops(undefined)).toBe(1);
    expect(trustedProxyHops('0')).toBe(0);
    expect(trustedProxyHops(' 0 ')).toBe(0);
    expect(trustedProxyHops('2')).toBe(2);
    expect(trustedProxyHops(' 3 ')).toBe(3);
    for (const bad of ['', '-1', '1.5', 'two', '1e3', '99999999999999999999'])
      expect(trustedProxyHops(bad), bad).toBe(1);
  });

  it('is what clientIp uses by default', () => {
    const r = new Request('http://x/', {
      headers: { 'x-forwarded-for': '198.51.100.1, 198.51.100.2, 198.51.100.3' },
    });
    const saved = process.env.TRUSTED_PROXY_HOPS;
    try {
      process.env.TRUSTED_PROXY_HOPS = '2';
      expect(clientIp(r)).toBe('198.51.100.2');
      delete process.env.TRUSTED_PROXY_HOPS;
      expect(clientIp(r)).toBe('198.51.100.3');
    } finally {
      if (saved === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = saved;
    }
  });
});
