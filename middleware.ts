import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE } from '@/lib/auth';

// Routes reachable without a valid session.
// /api/auth/logout is public: replaying it without a cookie does nothing
// harmful and lets the client clear state even if the JWT has expired.
// /api/health is the container and uptime probe (exact path only): it answers
// a fixed ok/unavailable body and nothing else.
const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/mcp',
  '/mcp/health',
  '/api/locale',
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
]);

// Query parameters the login and signup pages accept: none, neither page reads
// any. A parameter added to these pages later must be listed here. Next.js's
// own `_rsc` key (on its client-side page requests) needs no entry: it is
// removed from the URL before the middleware sees it (checked on a production
// server: `/login?_rsc=...` is served, not redirected).
export const AUTH_PAGE_QUERY_ALLOWLIST: ReadonlySet<string> = new Set();

// An auth redirect of a request that is not a page read (a form POST sent by
// the browser itself) answers 303: the browser then fetches the target with a
// GET and no body. The default 307 would make it send the body, the password
// included, again to the new URL.
function redirectStatus(req: NextRequest): 303 | 307 {
  return req.method === 'GET' || req.method === 'HEAD' ? 307 : 303;
}

// The same URL without the parameters that are not in the allowlist, or null
// when there is nothing to remove (or the request is not a page read).
function withoutForeignQuery(req: NextRequest): URL | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const url = req.nextUrl.clone();
  let removed = false;
  for (const name of [...url.searchParams.keys()]) {
    if (AUTH_PAGE_QUERY_ALLOWLIST.has(name)) continue;
    url.searchParams.delete(name);
    removed = true;
  }
  return removed ? url : null;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.has(pathname);
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (isPublic) {
    if (pathname === '/login' || pathname === '/signup') {
      // Already signed in: send to the dashboard, without the query string.
      if (session) {
        const url = req.nextUrl.clone();
        url.pathname = '/';
        url.search = '';
        return NextResponse.redirect(url, redirectStatus(req));
      }
      // A query string on these pages is never ours. Before #593 a form
      // submitted before the page was interactive went out as a GET, with the
      // email and the password in it; an old cached copy of the page can still
      // do that. Answer with the bare page, so the address bar, the history
      // entry and the service worker cache never keep such a URL.
      const clean = withoutForeignQuery(req);
      if (clean) return NextResponse.redirect(clean);
    }
    return NextResponse.next();
  }

  if (!session) {
    // API: 401 JSON. Pages: redirect to /login.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // The login page takes no parameter, so nothing of the refused URL's
    // query string is carried over to it.
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url, redirectStatus(req));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclude static resources and PWA assets. /exercise-media holds the
    // public-domain technique frames: they must be reachable without a
    // session because the next/image optimizer fetches the source file
    // through a cookie-less internal request. Redirecting that request to
    // /login handed the optimizer an HTML page and every optimized frame
    // (the live-session strip thumbnails) came back as a 400 in production.
    '/((?!_next/static|_next/image|exercise-media/|icons|manifest.json|favicon.ico|sw.js|workbox-).*)',
  ],
};
