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

  it('writes the account and every exercise of its catalog in one transaction', async () => {
    const res = await register(registerReq({ email: 'one@test.dev', password: 'supersecret' }));
    expect(res.status).toBe(200);
    // xmin is the id of the transaction that inserted a row. One id shared by
    // the user and all of its exercises means one transaction wrote them; the
    // per-exercise upserts gave every row its own.
    const user = await db.$queryRaw<{ id: string; xmin: string }[]>`
      SELECT id, xmin::text AS xmin FROM "User" WHERE email = 'one@test.dev'`;
    expect(user).toHaveLength(1);
    const exercises = await db.$queryRaw<{ xmin: string; n: bigint }[]>`
      SELECT xmin::text AS xmin, count(*) AS n FROM "Exercise"
      WHERE "userId" = ${user[0]!.id} GROUP BY xmin`;
    expect(EXERCISE_CATALOG.length).toBeGreaterThan(20);
    expect(exercises).toEqual([{ xmin: user[0]!.xmin, n: BigInt(EXERCISE_CATALOG.length) }]);
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
    expect(
      (await register(registerReq({ email: 'dup@test.dev', password: 'supersecret' }))).status,
    ).toBe(200);
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

  it('answers 500, not 409, to a unique violation that is not the email', async () => {
    // The same exercise name twice breaks the (userId, name) index: a defect
    // in the catalog, which must not be reported as "this email is taken".
    EXERCISE_CATALOG.push({ ...EXERCISE_CATALOG[0]! });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await register(
        registerReq({ email: 'catalog@test.dev', password: 'supersecret' }),
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Server error.' });
      expect(logged).toHaveBeenCalledWith(
        '[register] error:',
        expect.objectContaining({ code: 'P2002' }),
      );
    } finally {
      EXERCISE_CATALOG.pop();
      logged.mockRestore();
    }
    expect(await db.user.count()).toBe(0);
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
