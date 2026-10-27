import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cookieSecureFlag } from '@/lib/auth';
import { ApiError, readJsonWithCap, SMALL_JSON_BODY_MAX_BYTES } from '@/lib/api';
import { localeCookieMaxAge, localeCookieName, locales } from '@/i18n/config';

// Public route (listed in middleware PUBLIC_PATHS) so the login and signup
// pages can switch language too. It replaced a Server Action, which had the
// framework's origin check for free; the same-origin check below keeps that
// property so a cross-site page cannot flip a visitor's language.

const localeSchema = z.object({ locale: z.enum(locales) });

function requestHost(request: NextRequest): string {
  // Chained proxies append to X-Forwarded-Host; the first entry is the host the
  // browser addressed, which is the one the Origin header must match.
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  return forwarded || (request.headers.get('host') ?? request.nextUrl.host);
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).host === requestHost(request);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused.' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await readJsonWithCap(request, SMALL_JSON_BODY_MAX_BYTES);
  } catch (err) {
    if (err instanceof ApiError && err.status === 413) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const parsed = localeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Unsupported locale.' }, { status: 400 });
  }
  const { locale } = parsed.data;

  const response = NextResponse.json({ locale }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(localeCookieName, locale, {
    path: '/',
    maxAge: localeCookieMaxAge,
    sameSite: 'lax',
    // Same env-driven rule as the session cookie (SESSION_COOKIE_SECURE, production
    // default): a plain-HTTP self-hoster already opts out there for login to work.
    secure: cookieSecureFlag(),
  });

  return response;
}
