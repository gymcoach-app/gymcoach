import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { resetRateLimits } from '@/lib/rate-limit';

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, getCurrentUserId: vi.fn() };
});
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as login } from '@/app/api/auth/login/route';
import { POST as register } from '@/app/api/auth/register/route';
import { POST as activate } from '@/app/api/programs/[id]/activate/route';

// These routes used to buffer the whole request body with req.json() before
// any check, so one huge body could exhaust memory. They now read under a
// 16 KiB cap and answer 413 past it.
const OVERSIZED = 'x'.repeat(20 * 1024);

function jsonReq(url: string, body: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  resetRateLimits();
  mockUserId.mockReset();
});

describe('JSON body caps on the small routes', () => {
  it('login answers 413 to an oversized body and 400 to invalid JSON', async () => {
    const big = JSON.stringify({ email: 'a@test.dev', password: OVERSIZED });
    expect((await login(jsonReq('http://test.local/api/auth/login', big))).status).toBe(413);
    expect((await login(jsonReq('http://test.local/api/auth/login', '{'))).status).toBe(400);
  });

  it('register answers 413 to an oversized body and creates no account', async () => {
    const big = JSON.stringify({
      email: 'big@test.dev',
      password: 'longenough1',
      displayName: OVERSIZED,
    });
    expect((await register(jsonReq('http://test.local/api/auth/register', big))).status).toBe(413);
    expect(await db.user.count()).toBe(0);
    // Invalid JSON still gets the schema's 400.
    expect((await register(jsonReq('http://test.local/api/auth/register', '{'))).status).toBe(400);
  });

  it('activate answers 413 to an oversized body and leaves the program as it was', async () => {
    const user = await db.user.create({ data: { email: 'activate@test.dev', passwordHash: 'x' } });
    const program = await db.program.create({
      data: { userId: user.id, name: 'P', phase: 'Base', isActive: false },
    });
    mockUserId.mockResolvedValue(user.id);
    const params = { params: Promise.resolve({ id: program.id }) };
    const url = `http://test.local/api/programs/${program.id}/activate`;

    const res = await activate(
      jsonReq(url, JSON.stringify({ active: true, pad: OVERSIZED })),
      params,
    );
    expect(res.status).toBe(413);
    expect((await db.program.findUnique({ where: { id: program.id } }))?.isActive).toBe(false);

    // An empty body still means "activate".
    const ok = await activate(new Request(url, { method: 'POST' }), params);
    expect(ok.status).toBe(200);
    expect((await db.program.findUnique({ where: { id: program.id } }))?.isActive).toBe(true);
  });
});
