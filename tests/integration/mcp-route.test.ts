import { describe, expect, it } from 'vitest';

import { GET, OPTIONS, POST } from '@/app/mcp/route';
import { db } from '@/lib/db';
import { generateMcpToken, hashMcpToken } from '@/lib/mcp/auth';
import { MCP_MAX_BODY_BYTES } from '@/lib/mcp/limits';

// Issue #316: with the stateless transport (sessionIdGenerator: undefined) a
// GET routed into the shared handler produced no response at all - the request
// hung until client timeout, so MCP clients that probe with GET before POSTing
// initialize could never connect. GET must answer 405 promptly instead.
describe('MCP route method handling', () => {
  it('answers GET with 405 and an Allow header instead of hanging', async () => {
    const res = await GET(new Request('http://test.local/mcp'));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST, DELETE, OPTIONS');
  });

  // Both GET tests use unauthenticated requests (the old code 401'd them
  // before reaching the transport), so they pin the fix and its before-auth
  // ordering rather than reproducing the literal hang, which needed a valid
  // seeded token.
  it('answers an SSE probe GET carrying a bearer token with 405 too', async () => {
    const res = await GET(
      new Request('http://test.local/mcp', {
        headers: {
          authorization: 'Bearer gmc_not_a_real_token',
          accept: 'text/event-stream',
        },
      }),
    );
    expect(res.status).toBe(405);
  });

  it('still rejects an unauthenticated POST with 401', async () => {
    const res = await POST(
      new Request('http://test.local/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('still answers OPTIONS with 204', async () => {
    const res = await OPTIONS(new Request('http://test.local/mcp', { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
  });
});

// Issue #376: the SDK transport parses the body with no limit, so the route
// caps it before the transport runs, on bytes read and not only on the
// declared Content-Length.
describe('MCP route body cap', () => {
  async function seedToken() {
    const user = await db.user.create({
      data: { email: 'mcp-body-cap@test.dev', passwordHash: 'x' },
    });
    const token = generateMcpToken();
    await db.mcpAccessToken.create({
      data: {
        userId: user.id,
        name: 'body cap test',
        tokenHash: hashMcpToken(token),
        tokenPrefix: token.slice(0, 12),
        canWrite: true,
      },
    });
    return token;
  }

  const mcpHeaders = (token: string) => ({
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  });

  const ping = JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 });

  it('still serves a normal request through the buffered body', async () => {
    const token = await seedToken();
    const res = await POST(
      new Request('http://test.local/mcp', {
        method: 'POST',
        headers: mcpHeaders(token),
        body: ping,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('answers 413 for a body over the cap', async () => {
    const token = await seedToken();
    const padding = 'x'.repeat(MCP_MAX_BODY_BYTES);
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1, params: { padding } });
    const res = await POST(
      new Request('http://test.local/mcp', { method: 'POST', headers: mcpHeaders(token), body }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { message: 'Payload Too Large' } });
  });

  it('answers 413 for a streamed body over the cap with no Content-Length', async () => {
    const token = await seedToken();
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // A little past the cap, then stop: the route must refuse on the count.
        if (sent > MCP_MAX_BODY_BYTES) {
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const req = new Request('http://test.local/mcp', {
      method: 'POST',
      headers: mcpHeaders(token),
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect(req.headers.get('content-length')).toBeNull();
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it('refuses an unauthenticated oversized body with 401 before reading it', async () => {
    const res = await POST(
      new Request('http://test.local/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'x'.repeat(MCP_MAX_BODY_BYTES + 1),
      }),
    );
    expect(res.status).toBe(401);
  });
});
