import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { headers, securityHeaders } = require('./security-headers.cjs') as {
  headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
  securityHeaders: { key: string; value: string }[];
};

describe('security headers', () => {
  it('apply to every path', async () => {
    const rules = await headers();
    expect(rules).toEqual([{ source: '/:path*', headers: securityHeaders }]);
  });

  it('set the expected values', () => {
    expect(Object.fromEntries(securityHeaders.map((h) => [h.key, h.value]))).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
  });

  it('do not set HSTS, which belongs to the HTTPS proxy', () => {
    expect(securityHeaders.map((h) => h.key.toLowerCase())).not.toContain(
      'strict-transport-security',
    );
  });
});
