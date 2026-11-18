import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { cardioDistanceUnit } from '@/lib/cardio';

// Distance unit (issue #582): the User.distanceUnit column rides the existing
// profile route. Pinned here: a new account has no explicit unit (automatic),
// PATCH /api/profile sets, returns and clears it, the Zod enum refuses
// anything else, another profile save leaves it alone, one user's write never
// touches another user's unit, and the unit never changes what a set or a
// cardio target stores (meters).

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

describe('profile route - distanceUnit (issue #582)', () => {
  it('starts automatic, switches to miles and kilometers, and returns it on GET', async () => {
    const user = await seedUser('distance-set@test.dev');
    actAs(user.id);

    expect((await (await getProfile()).json()).distanceUnit).toBeNull();

    const mi = await patchProfile(patch({ distanceUnit: 'MI' }));
    expect(mi.status).toBe(200);
    expect((await mi.json()).distanceUnit).toBe('MI');
    expect((await (await getProfile()).json()).distanceUnit).toBe('MI');

    const km = await patchProfile(patch({ distanceUnit: 'KM' }));
    expect(km.status).toBe(200);
    expect((await km.json()).distanceUnit).toBe('KM');
  });

  it('returns to automatic with null', async () => {
    const user = await seedUser('distance-auto@test.dev');
    actAs(user.id);
    await patchProfile(patch({ distanceUnit: 'MI' }));

    const res = await patchProfile(patch({ distanceUnit: null }));
    expect(res.status).toBe(200);
    expect((await res.json()).distanceUnit).toBeNull();
    const row = await db.user.findUnique({ where: { id: user.id } });
    expect(row?.distanceUnit).toBeNull();
  });

  it('resolves automatic from the weight unit, and an explicit unit over it', async () => {
    const user = await seedUser('distance-rule@test.dev');
    actAs(user.id);
    const read = async () =>
      cardioDistanceUnit(
        await db.user.findUnique({
          where: { id: user.id },
          select: { unit: true, distanceUnit: true },
        }),
      );

    // New account: kilograms, automatic.
    expect(await read()).toBe('km');
    await patchProfile(patch({ unit: 'LB' }));
    expect(await read()).toBe('mi');
    await patchProfile(patch({ distanceUnit: 'KM' }));
    expect(await read()).toBe('km');
    await patchProfile(patch({ unit: 'KG', distanceUnit: 'MI' }));
    expect(await read()).toBe('mi');
  });

  it('leaves the unit alone when another profile field is saved', async () => {
    const user = await seedUser('distance-keep@test.dev');
    actAs(user.id);
    await patchProfile(patch({ distanceUnit: 'MI' }));

    const res = await patchProfile(patch({ displayName: 'Sam', unit: 'KG' }));
    expect(res.status).toBe(200);
    expect((await res.json()).distanceUnit).toBe('MI');
  });

  it('rejects an unknown unit without writing', async () => {
    const user = await seedUser('distance-bad@test.dev');
    actAs(user.id);
    await patchProfile(patch({ distanceUnit: 'MI' }));

    for (const bad of ['mi', 'km', 'MILES', 'AUTO', '', 5, true, {}]) {
      const res = await patchProfile(patch({ distanceUnit: bad }));
      expect(res.status).toBe(400);
    }
    const row = await db.user.findUnique({ where: { id: user.id } });
    expect(row?.distanceUnit).toBe('MI');
  });

  it("only writes the caller's own unit", async () => {
    const owner = await seedUser('distance-owner@test.dev');
    const other = await seedUser('distance-other@test.dev');
    await db.user.update({ where: { id: other.id }, data: { distanceUnit: 'KM' } });
    actAs(owner.id);

    await patchProfile(patch({ distanceUnit: 'MI' }));

    const otherRow = await db.user.findUnique({ where: { id: other.id } });
    expect(otherRow?.distanceUnit).toBe('KM');
    // And the profile read is the caller's own.
    expect((await (await getProfile()).json()).distanceUnit).toBe('MI');
    actAs(other.id);
    expect((await (await getProfile()).json()).distanceUnit).toBe('KM');
  });

  it('does not change what is stored: meters stay meters whatever the unit', async () => {
    const user = await seedUser('distance-sets@test.dev');
    actAs(user.id);
    const exercise = await db.exercise.create({
      data: { userId: user.id, name: 'Running', muscleGroup: 'OTHER', category: 'CARDIO' },
    });
    const program = await db.program.create({ data: { userId: user.id, name: 'Base', phase: 'Base' } });
    const workout = await db.workout.create({
      data: { programId: program.id, name: 'Run', order: 0 },
    });
    const row = await db.programExercise.create({
      data: {
        workoutId: workout.id,
        exerciseId: exercise.id,
        order: 0,
        targetSets: 1,
        targetRepsMin: 1,
        targetRepsMax: 1,
        targetRIR: 1,
        restSec: 60,
        targetDurationSec: 1800,
        targetDistanceM: 5000,
      },
    });
    const session = await db.session.create({ data: { userId: user.id } });
    const set = await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: exercise.id,
        setNumber: 1,
        weight: 0,
        reps: 1,
        durationSec: 1800,
        distanceM: 5000,
      },
    });

    await patchProfile(patch({ distanceUnit: 'MI' }));
    await patchProfile(patch({ distanceUnit: 'KM' }));
    await patchProfile(patch({ distanceUnit: null }));

    expect((await db.set.findUnique({ where: { id: set.id } }))?.distanceM).toBe(5000);
    expect(
      (await db.programExercise.findUnique({ where: { id: row.id } }))?.targetDistanceM,
    ).toBe(5000);
  });
});
