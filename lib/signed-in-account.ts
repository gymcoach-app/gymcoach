// ============================================================
// Which account this browser is signed in to, as seen by other tabs
// ============================================================
// The session cookie is shared by every tab of the browser, but a tab only
// learns the signed-in user when the server renders its layout. A tab rendered
// for user A and left open would otherwise keep flushing A's offline queue
// after user B signed in from another tab, with B's cookie (issue #490).
//
// So the signed-in user is mirrored into localStorage, shared by the tabs, and
// every flush checks it before each set (see `flushPendingSets`):
// - `SyncBootstrap` writes the user id its layout was rendered for. A login or
//   signup ends with a navigation that renders that layout, so the new account
//   is recorded right after it signs in.
// - A successful logout writes `NO_ACCOUNT`.
//
// What this does not cover: a tab whose storage is unavailable (private mode,
// blocked storage) never sees another tab's change, and a session that expires
// on its own writes nothing. The server still refuses another account's sets
// (sessions are scoped to the cookie user), so the residual is a refused
// request, not a set saved under the wrong account.

export const SIGNED_IN_ACCOUNT_KEY = 'gymcoach-signed-in-account';
export const NO_ACCOUNT = 'none';

function read(): string | null {
  try {
    return window.localStorage.getItem(SIGNED_IN_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function recordSignedInAccount(userId: string | null): void {
  try {
    window.localStorage.setItem(SIGNED_IN_ACCOUNT_KEY, userId ?? NO_ACCOUNT);
  } catch {
    // Storage unavailable: other tabs cannot be told, see above.
  }
}

// False once another tab recorded a different account (or a logout) than the
// one this tab was rendered for. Nothing recorded yet reads as still current.
export function isSignedInAccount(userId: string): boolean {
  const recorded = read();
  return recorded === null || recorded === userId;
}
