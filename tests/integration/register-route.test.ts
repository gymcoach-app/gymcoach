import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcrypt';
import { db } from '@/lib/db';
import { resetRateLimits } from '@/lib/rate-limit';
import { EXERCISE_CATALOG } from '@/lib/exercise-catalog';

// The route sets the session cookie through next/headers, which only exists
// inside a Next.js request; the cookie jar is the one thing faked here.
const { cookieSet } = vi.hoisted(() => ({ cookieSet: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet }),
}));

import { POST as register } from '@/app/api/auth/register/route';

function registerReq(body: unknown): Request {
  return new Request('http://test.local/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetRateLimits();
  cookieSet.mockReset();
  // A throwaway signing key for the session token; the integration tier sets none.
  vi.stubEnv('JWT_SECRET', 'integration-test-secret-at-least-32-chars');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Issue #593: signup used to create the user, then upsert the starter catalog
// one exercise at a time (about 50 transactions). On a busy server the signup
// form waited for seconds, and the E2E suite timed out on it.
describe('POST /api/auth/register', () => {
  it('creates the account with the whole starter catalog and signs the user in', async () => {
    const res = await register(
      registerReq({ email: 'new@test.dev', password: 'supersecret', displayName: 'New Lifter' }),
    );
    expect(res.status).toBe(200);

    const user = await db.user.findUniqueOrThrow({ where: { email: 'new@test.dev' } });
    expect(user.displayName).toBe('New Lifter');
    expect(await bcrypt.compare('supersecret', user.passwordHash)).toBe(true);
    expect(cookieSet).toHaveBeenCalledTimes(1);

    const seeded = await db.exercise.findMany({ where: { userId: user.id } });
    const byName = new Map(seeded.map((exercise) => [exercise.name, exercise]));
    expect(seeded).toHaveLength(EXERCISE_CATALOG.length);
    for (const entry of EXERCISE_CATALOG) {
      const row = byName.get(entry.name);
      expect(row, `missing ${entry.name}`).toBeDefined();
      expect(row).toMatchObject({
        muscleGroup: entry.muscleGroup,
        category: entry.category,
        equipmentType: entry.equipmentType,
        defaultRestSec: entry.defaultRestSec,
        usesBodyweight: entry.usesBodyweight ?? false,
        notes: entry.notes ?? null,
        isFavorite: false,
      });
    }
  });

  it('spends a bounded number of transactions, whatever the catalog size', async () => {
    // Postgres hands out one transaction id per writing transaction, server
    // wide, so the ids used around the call count the route's writes without
    // depending on timing. Each probe below takes one id itself.
    const xid = async () =>
      (await db.$queryRaw<{ n: bigint }[]>`SELECT pg_current_xact_id()::text::bigint AS n`)[0]!.n;
    const before = await xid();
    const res = await register(registerReq({ email: 'one@test.dev', password: 'supersecret' }));
    expect(res.status).toBe(200);
    const used = Number((await xid()) - before);
    // Expected: 2 (the registration and the second probe). The margin up to 10
    // absorbs a stray autovacuum on the shared test server; the per-exercise
    // upserts used one id per catalog entry, about 50.
    expect(EXERCISE_CATALOG.length).toBeGreaterThan(20);
    expect(used).toBeLessThanOrEqual(10);
  });

  it('leaves no account behind when the catalog cannot be written', async () => {
    const broken = {
      ...EXERCISE_CATALOG[0]!,
      name: 'Broken entry',
      muscleGroup: 'NOT_A_MUSCLE_GROUP' as never,
    };
    EXERCISE_CATALOG.push(broken);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await register(registerReq({ email: 'half@test.dev', password: 'supersecret' }));
      expect(res.status).toBe(500);
      expect(logged).toHaveBeenCalled();
    } finally {
      EXERCISE_CATALOG.pop();
      logged.mockRestore();
    }
    // Before #593 the user row was committed first, so the email was taken and
    // could never be registered again.
    expect(await db.user.count()).toBe(0);
    expect(await db.exercise.count()).toBe(0);
    expect(cookieSet).not.toHaveBeenCalled();

    const retry = await register(registerReq({ email: 'half@test.dev', password: 'supersecret' }));
    expect(retry.status).toBe(200);
  });

  it('answers 409 for an email that already has an account and adds nothing', async () => {
    expect((await register(registerReq({ email: 'dup@test.dev', password: 'supersecret' }))).status).toBe(200);
    const res = await register(registerReq({ email: 'dup@test.dev', password: 'othersecret' }));
    expect(res.status).toBe(409);
    expect(await db.user.count()).toBe(1);
    expect(await db.exercise.count()).toBe(EXERCISE_CATALOG.length);
  });

  it('answers one 200 and one 409, never a 500, to the same signup sent twice at once', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const body = { email: 'twice@test.dev', password: 'supersecret' };
      const statuses = (
        await Promise.all([register(registerReq(body)), register(registerReq(body))])
      ).map((res) => res.status);
      expect(statuses.sort()).toEqual([200, 409]);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
    expect(await db.user.count()).toBe(1);
    expect(await db.exercise.count()).toBe(EXERCISE_CATALOG.length);
    expect(cookieSet).toHaveBeenCalledTimes(1);
  });
});
