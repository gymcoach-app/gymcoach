import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

// Effort scale (issue #390): the User.effortScale column rides the existing
// profile route. Pinned here: a new account defaults to RIR, PATCH
// /api/profile sets and returns the scale, the Zod enum refuses anything else,
// another profile save leaves it alone, and one user's write never touches
// another user's scale.

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { GET as getProfile, PATCH as patchProfile } from '@/app/api/profile/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function patch(body: unknown): Request {
  return new Request('http://test.local/api/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedUser(email: string) {
  return db.user.create({ data: { email, passwordHash: 'x' } });
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('profile route - effortScale (issue #390)', () => {
  it('defaults to RIR, switches to RPE and back, and returns it on GET', async () => {
    const user = await seedUser('effort-set@test.dev');
    actAs(user.id);

    expect((await (await getProfile()).json()).effortScale).toBe('RIR');

    const rpe = await patchProfile(patch({ effortScale: 'RPE' }));
    expect(rpe.status).toBe(200);
    expect((await rpe.json()).effortScale).toBe('RPE');
    expect((await (await getProfile()).json()).effortScale).toBe('RPE');

    const rir = await patchProfile(patch({ effortScale: 'RIR' }));
    expect(rir.status).toBe(200);
    expect((await rir.json()).effortScale).toBe('RIR');
  });

  it('leaves the scale alone when another profile field is saved', async () => {
    const user = await seedUser('effort-keep@test.dev');
    actAs(user.id);
    await patchProfile(patch({ effortScale: 'RPE' }));

    const res = await patchProfile(patch({ displayName: 'Sam' }));
    expect(res.status).toBe(200);
    expect((await res.json()).effortScale).toBe('RPE');
  });

  it('rejects an unknown scale without writing', async () => {
    const user = await seedUser('effort-bad@test.dev');
    actAs(user.id);
    await patchProfile(patch({ effortScale: 'RPE' }));

    for (const bad of ['rpe', 'BORG', 8, null]) {
      const res = await patchProfile(patch({ effortScale: bad }));
      expect(res.status).toBe(400);
    }
    const row = await db.user.findUnique({ where: { id: user.id } });
    expect(row?.effortScale).toBe('RPE');
  });

  it("only writes the caller's own scale", async () => {
    const owner = await seedUser('effort-owner@test.dev');
    const other = await seedUser('effort-other@test.dev');
    actAs(owner.id);

    await patchProfile(patch({ effortScale: 'RPE' }));

    const otherRow = await db.user.findUnique({ where: { id: other.id } });
    expect(otherRow?.effortScale).toBe('RIR');
  });

  it('does not change what a set stores: RIR stays RIR whatever the scale', async () => {
    const user = await seedUser('effort-sets@test.dev');
    actAs(user.id);
    const exercise = await db.exercise.create({
      data: { userId: user.id, name: 'Squat', muscleGroup: 'QUADS', category: 'COMPOUND' },
    });
    const session = await db.session.create({ data: { userId: user.id } });
    const set = await db.set.create({
      data: { sessionId: session.id, exerciseId: exercise.id, setNumber: 1, weight: 100, reps: 5, rir: 2 },
    });

    await patchProfile(patch({ effortScale: 'RPE' }));

    expect((await db.set.findUnique({ where: { id: set.id } }))?.rir).toBe(2);
  });
});
