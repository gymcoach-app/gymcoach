import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@/prisma/generated/client';
import { getCurrentUserId } from '@/lib/auth';

// ============================================================
// Helpers for the API routes
// ============================================================
// Centralizes the recurring patterns: auth, Zod body parsing,
// turning Prisma errors into JSON responses.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireApiUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new ApiError(401, 'Unauthorized');
  }
  return userId;
}

export async function parseJsonBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
  opts?: { maxBytes?: number },
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    if (opts?.maxBytes !== undefined) {
      body = JSON.parse(await readBodyWithCap(req, opts.maxBytes));
    } else {
      body = await req.json();
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, 'Invalid JSON');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid data');
  }
  return parsed.data;
}

// Reads the request body as raw bytes while enforcing a hard byte cap DURING
// the read. The Content-Length header is attacker-controlled (absent on
// chunked bodies, or malformed), and App Router route handlers have no
// built-in body size limit, so `req.json()` / `req.arrayBuffer()` would
// buffer an arbitrarily large body into memory before any check runs. Aborts
// with 413 as soon as the cumulative byte count exceeds the cap.
export async function readBodyBytesWithCap(
  req: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        throw new ApiError(413, 'Request body too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    if (received > maxBytes) {
      // Stop pulling the rest of an oversized body.
      await req.body.cancel().catch(() => {});
    }
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

// Text variant of readBodyBytesWithCap, for JSON/CSV/XML bodies.
export async function readBodyWithCap(
  req: Request,
  maxBytes: number,
): Promise<string> {
  return new TextDecoder().decode(await readBodyBytesWithCap(req, maxBytes));
}

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return NextResponse.json(
        { error: 'Conflict: an entry with this value already exists.' },
        { status: 409 },
      );
    }
    if (err.code === 'P2025') {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }
  }

  console.error('[api] unhandled error:', err);
  return NextResponse.json({ error: 'Server error.' }, { status: 500 });
}
