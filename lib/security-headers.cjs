// Security headers sent on every response (next.config.js `headers()`).
// CommonJS because next.config.js requires it at build time.
//
// - nosniff: browsers do not guess a script or style out of another type.
// - Referrer-Policy: other sites see the origin at most, never a full URL with
//   its query (an MCP connector link carries its token in `?token=`).
// - X-Frame-Options and frame-ancestors: no other site can frame the app
//   (clickjacking). This is the only CSP directive set, so it cannot block
//   the app's own scripts or styles.
// - Permissions-Policy: the app uses none of these browser features.
//
// HSTS is left to the HTTPS reverse proxy: the app cannot know whether it is
// served over TLS, and HSTS on a plain-HTTP LAN instance would lock it out.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

async function headers() {
  return [{ source: '/:path*', headers: securityHeaders }];
}

module.exports = { securityHeaders, headers };
