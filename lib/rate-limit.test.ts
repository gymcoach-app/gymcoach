import { describe, it, expect, beforeEach } from 'vitest';
import { clientIp, rateLimit, resetRateLimits, trustedProxyHops } from './rate-limit';

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

  it('falls back to X-Real-IP, then unknown, without X-Forwarded-For', () => {
    expect(clientIp(req({ 'x-real-ip': ' 203.0.113.9 ' }), 1)).toBe('203.0.113.9');
    expect(clientIp(req({}), 1)).toBe('unknown');
  });
});

describe('trustedProxyHops', () => {
  it('reads a whole number of at least 1 and falls back to 1 otherwise', () => {
    expect(trustedProxyHops(undefined)).toBe(1);
    expect(trustedProxyHops('2')).toBe(2);
    expect(trustedProxyHops(' 3 ')).toBe(3);
    for (const bad of ['', '0', '-1', '1.5', 'two', '1e3', '99999999999999999999'])
      expect(trustedProxyHops(bad), bad).toBe(1);
  });

  it('is what clientIp uses by default', () => {
    const r = new Request('http://x/', { headers: { 'x-forwarded-for': 'a, b, c' } });
    const saved = process.env.TRUSTED_PROXY_HOPS;
    try {
      process.env.TRUSTED_PROXY_HOPS = '2';
      expect(clientIp(r)).toBe('b');
      delete process.env.TRUSTED_PROXY_HOPS;
      expect(clientIp(r)).toBe('c');
    } finally {
      if (saved === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = saved;
    }
  });
});
