// Removes sign-in form fields from the address bar (issue #593).
//
// Before #593 the login and signup forms had no `method`, so a submit that
// fired before the page was interactive went out as a GET to
// `/login?email=...&password=...`. The middleware now redirects such a URL to
// the bare page, but a copy of the old page served from a cache, or an old
// bookmark opened offline, can still land on one. The forms call this on
// mount so the parameters do not stay in the address bar or in the entry the
// Back button returns to. It cannot undo what the server already logged.

const FORM_FIELDS = ['password', 'email', 'displayName'];

// The URL without the form fields, or null when it holds none.
export function withoutCredentialParams(href: string): string | null {
  const url = new URL(href);
  let removed = false;
  for (const name of FORM_FIELDS) {
    if (!url.searchParams.has(name)) continue;
    url.searchParams.delete(name);
    removed = true;
  }
  return removed ? url.pathname + url.search + url.hash : null;
}

// Best-effort: never throws, does nothing on the server.
export function scrubCredentialsFromAddressBar(): void {
  try {
    if (typeof window === 'undefined') return;
    const clean = withoutCredentialParams(window.location.href);
    if (clean !== null) window.history.replaceState(window.history.state, '', clean);
  } catch {
    // A URL that cannot be rewritten stays as it is.
  }
}
