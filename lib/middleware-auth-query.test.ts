import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { AUTH_PAGE_QUERY_ALLOWLIST, middleware } from '@/middleware';

// Issue #593: a login or signup form submitted before the page was interactive
// went out as a GET with the email and the password in the query string. The
// middleware must never pass such a URL on, to the page or to a redirect.

const ORIGIN = 'https://gym.example';
const LEAK = 'displayName=A&email=a%40b.c&password=hunter22';

function get(path: string, cookie?: string, method = 'GET'): NextRequest {
  return new NextRequest(ORIGIN + path, {
    method,
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });
}

// The redirect target, or null when the request is let through.
function target(res: Response): string | null {
  const location = res.headers.get('location');
  return location === null ? null : location.replace(ORIGIN, '');
}

let session: string;

beforeEach(async () => {
  vi.stubEnv('JWT_SECRET', 'unit-test-secret-at-least-32-characters');
  session = await signSession({ userId: 'user-1', email: 'a@b.c' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware, query strings on the login and signup pages', () => {
  it.each(['/login', '/signup'])('redirects %s with form fields to the bare page', async (page) => {
    const res = await middleware(get(`${page}?${LEAK}`));
    expect(res.status).toBe(307);
    expect(target(res)).toBe(page);
  });

  it.each(['/login', '/signup'])('lets the bare %s page through', async (page) => {
    const res = await middleware(get(page));
    expect(target(res)).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('removes every parameter: neither page accepts one', async () => {
    expect([...AUTH_PAGE_QUERY_ALLOWLIST]).toEqual([]);
    expect(target(await middleware(get('/login?next=%2Fhistory')))).toBe('/login');
    expect(target(await middleware(get('/signup?lang=fr&password=hunter22')))).toBe('/signup');
  });

  it('answers 303 to a redirected form POST, so its body is not sent again', async () => {
    // A form POST sent by the browser itself, by someone already signed in...
    const signedIn = await middleware(get('/signup', session, 'POST'));
    expect(signedIn.status).toBe(303);
    expect(target(signedIn)).toBe('/');
    // ...or to a page that needs a session, by someone who is not.
    const signedOut = await middleware(get(`/settings?${LEAK}`, undefined, 'POST'));
    expect(signedOut.status).toBe(303);
    expect(target(signedOut)).toBe('/login');
    // Page reads keep the temporary redirect.
    expect((await middleware(get('/login', session))).status).toBe(307);
    expect((await middleware(get('/settings'))).status).toBe(307);
    expect((await middleware(get('/settings', undefined, 'HEAD'))).status).toBe(307);
  });

  it('does not redirect a form POST, which carries nothing in the URL', async () => {
    expect(target(await middleware(get('/signup', undefined, 'POST')))).toBeNull();
  });

  it.each(['/login', '/signup'])(
    'sends a signed-in visitor of %s to the dashboard without the query string',
    async (page) => {
      const res = await middleware(get(`${page}?${LEAK}`, session));
      expect(target(res)).toBe('/');
    },
  );

  it('sends a signed-out visitor to the login page without the query string', async () => {
    expect(target(await middleware(get(`/?${LEAK}`)))).toBe('/login');
    expect(target(await middleware(get('/history?month=2026-03&day=2026-03-15')))).toBe('/login');
    // An expired or forged session is signed out as well.
    expect(target(await middleware(get(`/settings?${LEAK}`, 'not-a-token')))).toBe('/login');
  });

  it('keeps the query string of a page a signed-in user may read', async () => {
    const res = await middleware(get('/history?month=2026-03', session));
    expect(target(res)).toBeNull();
  });

  it('still answers 401 to an API call without a session', async () => {
    const res = await middleware(get(`/api/profile?${LEAK}`));
    expect(res.status).toBe(401);
    expect(target(res)).toBeNull();
  });
});
