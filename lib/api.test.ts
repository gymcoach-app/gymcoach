import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { Prisma } from '@/prisma/generated/client';
import { ApiError, DEFAULT_JSON_BODY_MAX_BYTES, handleApiError, parseJsonBody } from './api';

function jsonRequest(body: string): Request {
  return new Request('http://test.local/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

describe('handleApiError', () => {
  it('maps an ApiError to its own status and message', async () => {
    const res = handleApiError(new ApiError(401, 'Unauthorized'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('maps a Prisma P2002 unique-constraint error to 409', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const res = handleApiError(err);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Conflict: an entry with this value already exists.',
    });
  });

  it('maps a Prisma P2025 record-not-found error to 404', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('missing', {
      code: 'P2025',
      clientVersion: 'test',
    });
    const res = handleApiError(err);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Not found.' });
  });

  it('maps any other error to a generic 500 without leaking details', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = handleApiError(new Error('database password is hunter2'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Server error.' });
    expect(JSON.stringify(body)).not.toContain('hunter2');
    spy.mockRestore();
  });

  it('treats an unknown Prisma code as a 500 (not 409/404)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Prisma.PrismaClientKnownRequestError('boom', {
      code: 'P2003',
      clientVersion: 'test',
    });
    const res = handleApiError(err);
    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});

describe('parseJsonBody', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('returns the parsed data for a valid payload', async () => {
    const data = await parseJsonBody(jsonRequest(JSON.stringify({ name: 'ok' })), schema);
    expect(data).toEqual({ name: 'ok' });
  });

  it('throws a 400 ApiError on invalid JSON', async () => {
    await expect(parseJsonBody(jsonRequest('not json{'), schema)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('throws a 400 ApiError when the payload fails schema validation', async () => {
    await expect(
      parseJsonBody(jsonRequest(JSON.stringify({ name: '' })), schema),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      parseJsonBody(jsonRequest(JSON.stringify({ name: '' })), schema),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('parseJsonBody with a byte cap', () => {
  const schema = z.object({ name: z.string() });

  // A Request whose body is a stream WITHOUT a Content-Length header, like a
  // chunked upload: the cap must hold from the bytes alone.
  function chunkedRequest(chunks: string[]): Request {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Request('http://test.local/api', {
      method: 'POST',
      body: stream,
      // Required by undici for stream bodies; irrelevant to the cap logic.
      duplex: 'half',
    } as RequestInit);
  }

  it('accepts a streamed body under the cap', async () => {
    const body = JSON.stringify({ name: 'ok' });
    const data = await parseJsonBody(chunkedRequest([body]), schema, {
      maxBytes: 1024,
    });
    expect(data).toEqual({ name: 'ok' });
  });

  it('rejects with 413 as soon as the streamed bytes exceed the cap, without a Content-Length', async () => {
    const big = `{"name":"${'x'.repeat(5000)}"}`;
    const halves = [big.slice(0, 2500), big.slice(2500)];
    await expect(
      parseJsonBody(chunkedRequest(halves), schema, { maxBytes: 1000 }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('counts multibyte characters by their encoded size', async () => {
    // 600 two-byte characters = 1200 bytes > 1000, though only 600 chars.
    const big = `{"name":"${'é'.repeat(600)}"}`;
    await expect(
      parseJsonBody(chunkedRequest([big]), schema, { maxBytes: 1000 }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('applies the default cap when the route sets none', async () => {
    const big = `{"name":"${'x'.repeat(DEFAULT_JSON_BODY_MAX_BYTES)}"}`;
    await expect(parseJsonBody(chunkedRequest([big]), schema)).rejects.toMatchObject({
      status: 413,
    });
    const fits = JSON.stringify({ name: 'x'.repeat(DEFAULT_JSON_BODY_MAX_BYTES - 100) });
    await expect(parseJsonBody(chunkedRequest([fits]), schema)).resolves.toMatchObject({
      name: expect.any(String),
    });
  });

  it('still validates the schema under the cap', async () => {
    await expect(
      parseJsonBody(chunkedRequest(['{"name":42}']), schema, { maxBytes: 1024 }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
