import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as createEquipment } from '@/app/api/gyms/[id]/equipment/route';
import { PUT as updateWeights } from '@/app/api/gym-equipment/[id]/weights/route';

function request(url: string, method = 'GET', body?: unknown): Request {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seedUser(label: string) {
  const user = await db.user.create({
    data: { email: `weights-${label}-${Date.now()}@test.dev`, passwordHash: 'unused' },
  });
  const gym = await db.gym.create({ data: { userId: user.id, name: `${label} gym` } });
  return { user, gym };
}

async function seedExercise(
  userId: string,
  name: string,
  equipmentType: 'CABLE' | 'OTHER' | 'MACHINE',
) {
  return db.exercise.create({
    data: {
      userId,
      name,
      muscleGroup: 'BACK_THICKNESS',
      category: 'COMPOUND',
      equipmentType,
    },
  });
}

async function configFor(gymId: string, exerciseId: string) {
  return db.gymExerciseConfig.findUnique({
    where: { gymId_exerciseId: { gymId, exerciseId } },
  });
}

beforeEach(() => mockUserId.mockReset());

describe('gym equipment weights-only API (#380)', () => {
  it('writes the weight list and leaves name, type and availability untouched', async () => {
    const { user, gym } = await seedUser('weights-only');
    const cableRow = await seedExercise(user.id, 'Cable row', 'CABLE');
    const landmine = await seedExercise(user.id, 'Landmine press', 'OTHER');
    mockUserId.mockResolvedValue(user.id);

    const createdResponse = await createEquipment(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'POST', {
        name: 'Cable station',
        equipmentType: 'CABLE',
        weightOptions: [10, 20],
        exerciseIds: [cableRow.id, landmine.id],
      }),
      params(gym.id),
    );
    expect(createdResponse.status).toBe(201);
    const equipmentId = (await createdResponse.json()).equipment.id as string;

    // A rename made since the page loaded: the session snapshot still holds the
    // old name, and a weights-only save must not put it back.
    const renamed = await createEquipment(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'POST', {
        equipmentId,
        name: 'Cable station A',
        equipmentType: 'CABLE',
        weightOptions: [10, 20],
        exerciseIds: [cableRow.id, landmine.id],
      }),
      params(gym.id),
    );
    expect(renamed.status).toBe(200);

    // The lifter marks both exercises unavailable after the page loaded.
    await db.gymExerciseConfig.update({
      where: { gymId_exerciseId: { gymId: gym.id, exerciseId: cableRow.id } },
      data: { isAvailable: false },
    });
    await db.gymExerciseConfig.update({
      where: { gymId_exerciseId: { gymId: gym.id, exerciseId: landmine.id } },
      data: { isAvailable: false },
    });

    const response = await updateWeights(
      request(`http://test.local/api/gym-equipment/${equipmentId}/weights`, 'PUT', {
        weightOptions: [30, 15],
      }),
      params(equipmentId),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.equipment).toMatchObject({
      id: equipmentId,
      name: 'Cable station A',
      equipmentType: 'CABLE',
      weightOptions: [15, 30],
    });

    // The name and the type are exactly what the server held before the save.
    const item = await db.gymEquipment.findUniqueOrThrow({ where: { id: equipmentId } });
    expect(item.name).toBe('Cable station A');
    expect(item.equipmentType).toBe('CABLE');
    expect(item.weightOptions).toEqual([15, 30]);

    // The cable exercise's saved load options follow the item's new stack, and
    // its availability flag is untouched - the surprise this endpoint removes.
    const cableConfig = await configFor(gym.id, cableRow.id);
    expect(cableConfig).toMatchObject({ isAvailable: false, weightOptions: [15, 30] });

    // An OTHER exercise never inherits a cable stack, and it stays unavailable
    // with its own options exactly as they were.
    const landmineConfig = await configFor(gym.id, landmine.id);
    expect(landmineConfig).toMatchObject({ isAvailable: false, weightOptions: [] });
  });

  it('creates no exercise config, so a linked exercise cannot be re-enabled by a save', async () => {
    const { user, gym } = await seedUser('no-config');
    const cableRow = await seedExercise(user.id, 'Cable row', 'CABLE');
    mockUserId.mockResolvedValue(user.id);

    const createdResponse = await createEquipment(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'POST', {
        name: 'Cable station',
        equipmentType: 'CABLE',
        weightOptions: [10, 20],
        exerciseIds: [cableRow.id],
      }),
      params(gym.id),
    );
    const equipmentId = (await createdResponse.json()).equipment.id as string;

    // The lifter removed the exercise from the gym's availability list.
    await db.gymExerciseConfig.deleteMany({
      where: { gymId: gym.id, exerciseId: cableRow.id },
    });

    const response = await updateWeights(
      request(`http://test.local/api/gym-equipment/${equipmentId}/weights`, 'PUT', {
        weightOptions: [25, 50],
      }),
      params(equipmentId),
    );
    expect(response.status).toBe(200);

    expect(await configFor(gym.id, cableRow.id)).toBeNull();
    const item = await db.gymEquipment.findUniqueOrThrow({ where: { id: equipmentId } });
    expect(item.weightOptions).toEqual([25, 50]);
  });

  it('refuses an item owned by another trainee and changes nothing', async () => {
    const { user, gym } = await seedUser('owner');
    const cableRow = await seedExercise(user.id, 'Cable row', 'CABLE');
    mockUserId.mockResolvedValue(user.id);
    const createdResponse = await createEquipment(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'POST', {
        name: 'Cable station',
        equipmentType: 'CABLE',
        weightOptions: [10, 20],
        exerciseIds: [cableRow.id],
      }),
      params(gym.id),
    );
    const equipmentId = (await createdResponse.json()).equipment.id as string;

    const { user: stranger } = await seedUser('stranger');
    mockUserId.mockResolvedValue(stranger.id);

    const response = await updateWeights(
      request(`http://test.local/api/gym-equipment/${equipmentId}/weights`, 'PUT', {
        weightOptions: [99],
      }),
      params(equipmentId),
    );
    expect(response.status).toBe(404);

    const item = await db.gymEquipment.findUniqueOrThrow({ where: { id: equipmentId } });
    expect(item.weightOptions).toEqual([10, 20]);
  });

  it('rejects a body that is not a weight list, and a weight outside the bounds', async () => {
    const { user, gym } = await seedUser('validation');
    const cableRow = await seedExercise(user.id, 'Cable row', 'CABLE');
    mockUserId.mockResolvedValue(user.id);

    const createdResponse = await createEquipment(
      request(`http://test.local/api/gyms/${gym.id}/equipment`, 'POST', {
        name: 'Cable station',
        equipmentType: 'CABLE',
        weightOptions: [10, 20],
        exerciseIds: [cableRow.id],
      }),
      params(gym.id),
    );
    const equipmentId = (await createdResponse.json()).equipment.id as string;

    const missing = await updateWeights(
      request(`http://test.local/api/gym-equipment/${equipmentId}/weights`, 'PUT', {}),
      params(equipmentId),
    );
    expect(missing.status).toBe(400);

    const outOfRange = await updateWeights(
      request(`http://test.local/api/gym-equipment/${equipmentId}/weights`, 'PUT', {
        weightOptions: [0.05],
      }),
      params(equipmentId),
    );
    expect(outOfRange.status).toBe(400);

    const item = await db.gymEquipment.findUniqueOrThrow({ where: { id: equipmentId } });
    expect(item.weightOptions).toEqual([10, 20]);
  });
});
