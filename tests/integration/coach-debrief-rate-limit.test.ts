import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as requestDebrief } from '@/app/api/coach/route';

// The debrief calls the LLM with the instance's key and stores a CoachSession
// row each time, so it is rate-limited per user (3 a minute, 20 a day). The
// demo provider keeps the test free of any key.
const savedProvider = process.env.LLM_PROVIDER;
beforeAll(() => {
  process.env.LLM_PROVIDER = 'demo';
});
afterAll(() => {
  if (savedProvider === undefined) delete process.env.LLM_PROVIDER;
  else process.env.LLM_PROVIDER = savedProvider;
});

beforeEach(() => {
  mockUserId.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function seedUser(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'x' } });
  mockUserId.mockResolvedValue(user.id);
  return user;
}

describe('POST /api/coach rate limit', () => {
  it('allows 3 debriefs a minute, then answers 429 with Retry-After and stores nothing', async () => {
    const user = await seedUser('coach-burst@test.dev');
    for (let i = 0; i < 3; i++) {
      expect((await requestDebrief()).status).toBe(200);
    }
    const limited = await requestDebrief();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await db.coachSession.count({ where: { userId: user.id } })).toBe(3);
  });

  it('caps a user at 20 debriefs a day even when spread across minutes', async () => {
    const user = await seedUser('coach-daily@test.dev');
    let clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    for (let i = 0; i < 20; i++) {
      // A new minute every 3 calls keeps the per-minute limit out of the way.
      if (i % 3 === 0) clock += 61_000;
      expect((await requestDebrief()).status, `call ${i + 1}`).toBe(200);
    }
    clock += 61_000;
    const limited = await requestDebrief();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(60);
    expect(await db.coachSession.count({ where: { userId: user.id } })).toBe(20);
  });

  it('keeps each user on their own budget', async () => {
    await seedUser('coach-a@test.dev');
    for (let i = 0; i < 3; i++) await requestDebrief();
    expect((await requestDebrief()).status).toBe(429);

    await seedUser('coach-b@test.dev');
    expect((await requestDebrief()).status).toBe(200);
  });
});
