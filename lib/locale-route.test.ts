import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/locale/route';

// Lives in lib/ rather than beside the route: vitest.config.ts only includes
// lib/** and components/** as unit tests.

function request(url: string, body: unknown, headers: Record<string, string> = {}, raw = false) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

describe('POST /api/locale', () => {
  it('accepts Simplified Chinese and persists its exact locale identifier', async () => {
    const response = await POST(
      request('http://gymcoach.local:3030/api/locale', { locale: 'zh-CN' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ locale: 'zh-CN' });
    expect(response.headers.get('set-cookie')).toContain('gymcoach.locale=zh-CN');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets the locale cookie with the expected attributes', async () => {
    const response = await POST(request('http://gymcoach.local:3030/api/locale', { locale: 'ru' }));
    const cookie = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ locale: 'ru' });
    expect(cookie).toContain('gymcoach.locale=ru');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=31536000');
    expect(cookie).toContain('SameSite=lax');
  });

  it('leaves the cookie non-secure outside production by default', async () => {
    const response = await POST(request('https://gymcoach.example/api/locale', { locale: 'en' }));
    expect(response.headers.get('set-cookie')).not.toContain('Secure');
  });

  it('follows SESSION_COOKIE_SECURE=true', async () => {
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    const response = await POST(
      request('http://gymcoach.internal:3030/api/locale', { locale: 'en' }),
    );
    expect(response.headers.get('set-cookie')).toContain('Secure');
  });

  it('follows SESSION_COOKIE_SECURE=false', async () => {
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');
    const response = await POST(request('https://gymcoach.example/api/locale', { locale: 'en' }));
    expect(response.headers.get('set-cookie')).not.toContain('Secure');
  });

  it('ignores a client-supplied X-Forwarded-Proto header', async () => {
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    const downgrade = await POST(
      request(
        'https://gymcoach.example/api/locale',
        { locale: 'en' },
        { 'x-forwarded-proto': 'http' },
      ),
    );
    expect(downgrade.headers.get('set-cookie')).toContain('Secure');

    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');
    const upgrade = await POST(
      request(
        'http://gymcoach.local:3030/api/locale',
        { locale: 'en' },
        { 'x-forwarded-proto': 'https' },
      ),
    );
    expect(upgrade.headers.get('set-cookie')).not.toContain('Secure');
  });

  it('rejects malformed JSON without setting a locale cookie', async () => {
    const response = await POST(request('https://gymcoach.example/api/locale', '{', {}, true));
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a null body with 400, not 500', async () => {
    const response = await POST(request('https://gymcoach.example/api/locale', null));
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects unsupported locales without setting a cookie', async () => {
    const response = await POST(request('https://gymcoach.example/api/locale', { locale: 'ja' }));
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a cross-origin request before touching the cookie', async () => {
    const response = await POST(
      request(
        'https://gymcoach.example/api/locale',
        { locale: 'en' },
        { origin: 'https://evil.example' },
      ),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses an opaque "null" origin', async () => {
    const response = await POST(
      request('https://gymcoach.example/api/locale', { locale: 'en' }, { origin: 'null' }),
    );
    expect(response.status).toBe(403);
  });

  it('accepts a same-origin request, including behind a forwarding proxy', async () => {
    const direct = await POST(
      request(
        'https://gymcoach.example/api/locale',
        { locale: 'fr' },
        { origin: 'https://gymcoach.example' },
      ),
    );
    expect(direct.status).toBe(200);

    const proxied = await POST(
      request(
        'http://gymcoach.internal:3030/api/locale',
        { locale: 'fr' },
        { origin: 'https://gymcoach.example', 'x-forwarded-host': 'gymcoach.example' },
      ),
    );
    expect(proxied.status).toBe(200);
    expect(proxied.headers.get('set-cookie')).toContain('gymcoach.locale=fr');

    // Two proxies in a row append to the header; the browser-facing host comes first.
    const chained = await POST(
      request(
        'http://gymcoach.internal:3030/api/locale',
        { locale: 'fr' },
        {
          origin: 'https://gymcoach.example',
          'x-forwarded-host': 'gymcoach.example, edge.internal',
        },
      ),
    );
    expect(chained.status).toBe(200);
  });
});
