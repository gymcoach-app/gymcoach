// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { resetRateLimits } from '@/lib/rate-limit';
import {
  MCP_MAX_BODY_BYTES,
  MCP_WRITE_RATE_LIMIT,
  MCP_WRITE_RATE_WINDOW_MS,
  consumeMcpWriteQuota,
  readMcpBody,
} from './limits';

beforeEach(() => resetRateLimits());

function streamRequest(stream: ReadableStream<Uint8Array>, headers?: HeadersInit): Request {
  return new Request('http://test.local/mcp', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

// A body streamed in chunks with no Content-Length, as a chunked upload would be.
function chunkedRequest(chunks: number[], headers?: HeadersInit): Request {
  return streamRequest(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of chunks) controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    }),
    headers,
  );
}

describe('readMcpBody', () => {
  it('returns the body bytes when it fits', async () => {
    const req = new Request('http://test.local/mcp', { method: 'POST', body: '{"a":1}' });
    const read = await readMcpBody(req, 100);
    expect(read.ok && new TextDecoder().decode(read.body)).toBe('{"a":1}');
  });

  it('accepts a body of exactly the cap', async () => {
    const read = await readMcpBody(chunkedRequest([60, 40]), 100);
    expect(read.ok && read.body.byteLength).toBe(100);
  });

  it('refuses a declared Content-Length above the cap without reading the body', async () => {
    let pulled = false;
    const req = streamRequest(
      // highWaterMark 0: pull runs only when someone reads.
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulled = true;
            controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
      { 'content-length': String(MCP_MAX_BODY_BYTES + 1) },
    );
    expect(await readMcpBody(req, MCP_MAX_BODY_BYTES)).toEqual({ ok: false, status: 413 });
    expect(pulled).toBe(false);
  });

  it('counts streamed bytes when there is no Content-Length', async () => {
    const req = chunkedRequest([60, 60]);
    expect(req.headers.get('content-length')).toBeNull();
    expect(await readMcpBody(req, 100)).toEqual({ ok: false, status: 413 });
  });

  it('counts streamed bytes when the Content-Length understates the body', async () => {
    const req = chunkedRequest([150], { 'content-length': '10' });
    expect(await readMcpBody(req, 100)).toEqual({ ok: false, status: 413 });
  });

  it('answers 400 when the body stream fails mid-read', async () => {
    let sent = false;
    const req = streamRequest(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent) {
            controller.error(new Error('client aborted'));
            return;
          }
          sent = true;
          controller.enqueue(new Uint8Array(10));
        },
      }),
    );
    expect(await readMcpBody(req, 100)).toEqual({ ok: false, status: 400 });
  });

  it('caps at 8 MiB, which leaves room for the largest equipment image the schema accepts', () => {
    expect(MCP_MAX_BODY_BYTES).toBe(8 * 1024 * 1024);
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
      'Too many write calls for this GymCoach MCP token. Retry in 60s.',
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
