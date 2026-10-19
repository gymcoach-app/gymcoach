// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { resetRateLimits } from '@/lib/rate-limit';
import {
  MCP_MAX_BODY_BYTES,
  MCP_WRITE_RATE_LIMIT,
  MCP_WRITE_RATE_WINDOW_MS,
  consumeMcpWriteQuota,
  readBodyWithLimit,
} from './limits';

beforeEach(() => resetRateLimits());

// A body streamed in chunks with no Content-Length, as a chunked upload would be.
function streamedRequest(chunks: number[]): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });
  return new Request('http://test.local/mcp', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

describe('readBodyWithLimit', () => {
  it('returns the body bytes when it fits', async () => {
    const req = new Request('http://test.local/mcp', { method: 'POST', body: '{"a":1}' });
    const body = await readBodyWithLimit(req, 100);
    expect(new TextDecoder().decode(body!)).toBe('{"a":1}');
  });

  it('accepts a body of exactly the cap', async () => {
    const body = await readBodyWithLimit(streamedRequest([60, 40]), 100);
    expect(body?.byteLength).toBe(100);
  });

  it('refuses a declared Content-Length above the cap without reading the body', async () => {
    const req = new Request('http://test.local/mcp', {
      method: 'POST',
      headers: { 'content-length': String(MCP_MAX_BODY_BYTES + 1) },
      body: 'x',
    });
    expect(await readBodyWithLimit(req, MCP_MAX_BODY_BYTES)).toBeNull();
  });

  it('counts streamed bytes when there is no Content-Length', async () => {
    const req = streamedRequest([60, 60]);
    expect(req.headers.get('content-length')).toBeNull();
    expect(await readBodyWithLimit(req, 100)).toBeNull();
  });

  it('counts streamed bytes when the Content-Length understates the body', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(150));
        controller.close();
      },
    });
    const req = new Request('http://test.local/mcp', {
      method: 'POST',
      headers: { 'content-length': '10' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect(await readBodyWithLimit(req, 100)).toBeNull();
  });

  it('leaves room for the largest equipment image the MCP schema accepts', () => {
    // set_gym_equipment_image allows 7,100,000 base64 characters.
    expect(MCP_MAX_BODY_BYTES).toBeGreaterThan(7_100_000 + 512 * 1024);
  });
});

describe('consumeMcpWriteQuota', () => {
  it('allows the limit within a window and refuses the next call with a retry hint', () => {
    const now = 1_000_000;
    for (let i = 0; i < MCP_WRITE_RATE_LIMIT; i++) {
      expect(() => consumeMcpWriteQuota('token-a', now)).not.toThrow();
    }
    expect(() => consumeMcpWriteQuota('token-a', now)).toThrow(
      /Too many write calls for this GymCoach MCP token\. Retry in 60 s\./,
    );
  });

  it('keeps a separate window per token', () => {
    const now = 1_000_000;
    for (let i = 0; i < MCP_WRITE_RATE_LIMIT; i++) consumeMcpWriteQuota('token-a', now);
    expect(() => consumeMcpWriteQuota('token-b', now)).not.toThrow();
  });

  it('allows writes again once the window has passed', () => {
    const now = 1_000_000;
    for (let i = 0; i < MCP_WRITE_RATE_LIMIT; i++) consumeMcpWriteQuota('token-a', now);
    expect(() => consumeMcpWriteQuota('token-a', now + MCP_WRITE_RATE_WINDOW_MS)).not.toThrow();
  });
});
