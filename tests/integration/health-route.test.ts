import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { GET } from '@/app/api/health/route';

// GET /api/health against the real test database (issue #576), and the
// container probe script against a local HTTP server. The failure paths of the
// route (query throws, query hangs) are unit tested in lib/health.test.ts.

describe('GET /api/health (real database)', () => {
  it('answers 200 with exactly {"status":"ok"}', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('{"status":"ok"}');
  });
});

describe('scripts/healthcheck.cjs', () => {
  const script = join(process.cwd(), 'scripts', 'healthcheck.cjs');
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server?.close(resolve));
      server = undefined;
    }
  });

  async function listen(status: number, seen: string[]): Promise<number> {
    server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  function run(port: number): Promise<number> {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [script],
        { env: { PATH: process.env.PATH, PORT: String(port) }, timeout: 15000 },
        (error) => resolve(error ? (typeof error.code === 'number' ? error.code : -1) : 0),
      );
    });
  }

  it('exits 0 on a 200 from /api/health on the configured port', async () => {
    const seen: string[] = [];
    const port = await listen(200, seen);
    expect(await run(port)).toBe(0);
    expect(seen).toEqual(['GET /api/health']);
  });

  it.each([503, 401, 500])('exits 1 on a %i', async (status) => {
    const port = await listen(status, []);
    expect(await run(port)).toBe(1);
  });

  it('exits 1 when nothing listens on the port', async () => {
    const port = await listen(200, []);
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
    expect(await run(port)).toBe(1);
  });
});
