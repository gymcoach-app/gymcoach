import { test, expect } from '@playwright/test';

// The security headers come from next.config.js; this checks they survive the
// PWA and next-intl config wrappers and reach both pages and API routes.
const expected = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

// A page, an API route and the MCP endpoint (unauthenticated, so a 401).
for (const path of ['/login', '/api/coach', '/mcp/health', '/mcp']) {
  test(`security headers are set on ${path}`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    const headers = res.headers();
    for (const [name, value] of Object.entries(expected)) {
      expect(headers[name], name).toBe(value);
    }
  });
}
