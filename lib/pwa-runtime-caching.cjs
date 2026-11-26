// Service worker route matchers, shared by next.config.js and the tests.
//
// Workbox writes each matcher into sw.js as source text (Function#toString),
// so a matcher must not use anything defined outside its own body.

// App pages kept for offline use: every page navigation except the API and
// the login and signup pages. Those two are useless offline, and before #593
// a form submitted before the page was interactive reached them as
// `/login?email=...&password=...`, a URL that must never be stored.
function isCacheablePage({ request, url }) {
  return (
    request.mode === 'navigate' &&
    !url.pathname.startsWith('/api/') &&
    url.pathname !== '/login' &&
    url.pathname !== '/signup'
  );
}

module.exports = { isCacheablePage };
