import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

// Backup export/restore completeness (issue #168): the export must carry every
// user-owned model/field, the restore must be a lossless, ownership-scoped
// round trip, version 1 files must keep importing, and a malformed or
// oversized file must be rejected without partially written data.

// Auth is read through getCurrentUserId (via requireApiUserId in @/lib/api).
vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);
const EQUIPMENT_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EQUIPMENT_PNG_BASE64 = 'iVBORw0KGgo=';

import { GET as getBackup, POST as postBackup } from '@/app/api/backup/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function jsonReq(body: unknown): Request {
  return new Request('http://test.local/api/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Order-insensitive deep normalization: sorts every array (the export order of
// sets depends on regenerated cuids) and every object key, so two dumps can be
// compared field-for-field.
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(sortDeep).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .map(([k, val]) => [k, sortDeep(val)] as const)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  }
  return v;
}

// Strips the fields that legitimately differ between two accounts/exports.
function comparable(dump: Record<string, unknown>): unknown {
  const { exportedAt: _exportedAt, user: _user, ...rest } = dump;
  return sortDeep(rest);
}

// Seeds a user with at least one row in every exported model, exercising all
// the fields issue #168 found missing.
async function seedFullUser(email: string) {
  const user = await db.user.create({
    data: {
      email,
      passwordHash: 'x',
      displayName: 'Julien',
      bodyweight: 82.5,
      bodyweightGoalKg: 78,
      sex: 'MALE',
      heightCm: 181,
      goal: 'HYPERTROPHY',
      weeklyFrequency: 4,
      unit: 'LB',
      deloadUntil: new Date('2026-07-05T00:00:00.000Z'),
    },
  });
  const bench = await db.exercise.create({
    data: {
      userId: user.id,
      name: 'Bench Press',
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
      equipmentType: 'BARBELL',
      isFavorite: true,
    },
  });
  const pullup = await db.exercise.create({
    data: {
      userId: user.id,
      name: 'Pull-up',
      muscleGroup: 'BACK_WIDTH',
      category: 'COMPOUND',
      usesBodyweight: true,
      equipmentType: 'BODYWEIGHT',
    },
  });
  const running = await db.exercise.create({
    data: {
      userId: user.id,
      name: 'Running',
      muscleGroup: 'OTHER',
      category: 'CARDIO',
      equipmentType: 'CARDIO',
    },
  });
  const gym = await db.gym.create({
    data: {
      userId: user.id,
      name: 'Basement',
      dumbbellWeights: [10, 12, 14, 16, 19],
      plateWeights: [1.25, 2.5, 5, 10, 20],
      barWeights: [20],
      exerciseConfigs: {
        create: { exerciseId: running.id, isAvailable: false, weightOptions: [] },
      },
    },
  });
  await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });
  const equipment = await db.gymEquipment.create({
    data: {
      gymId: gym.id,
      name: 'Competition bench station',
      equipmentType: 'BARBELL',
      description: 'Flat bench with uprights and safety arms.',
      manufacturer: 'GymCo',
      modelName: 'Bench Pro',
      quantity: 2,
      weightOptions: [20, 40, 60, 80, 100],
      imageData: EQUIPMENT_PNG,
      imageMimeType: 'image/png',
      exerciseLinks: { create: { exerciseId: bench.id } },
    },
  });
  const program = await db.program.create({
    data: {
      userId: user.id,
      name: 'Block 1',
      phase: 'accumulation',
      isActive: true,
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      workouts: {
        create: [
          {
            name: 'Upper A',
            dayOfWeek: 1,
            order: 1,
            exercises: {
              create: [
                {
                  exerciseId: bench.id,
                  order: 1,
                  targetSets: 3,
                  targetRepsMin: 5,
                  targetRepsMax: 8,
                  targetRIR: 2,
                  restSec: 120,
                  supersetGroup: 1,
                },
                {
                  exerciseId: pullup.id,
                  order: 2,
                  targetSets: 3,
                  targetRepsMin: 6,
                  targetRepsMax: 10,
                  targetRIR: 2,
                  restSec: 120,
                  supersetGroup: 1,
                },
              ],
            },
          },
        ],
      },
    },
    include: { workouts: true },
  });
  await db.session.create({
    data: {
      userId: user.id,
      programId: program.id,
      workoutId: program.workouts[0]?.id ?? null,
      startedAt: new Date('2026-06-01T10:00:00.000Z'),
      finishedAt: new Date('2026-06-01T11:00:00.000Z'),
      notes: 'good session',
      gymId: gym.id,
      sets: {
        create: [
          {
            exerciseId: bench.id,
            gymEquipmentId: equipment.id,
            equipmentNameSnapshot: 'Competition bench station',
            equipmentLoadSnapshot: {
              version: 1,
              equipmentType: 'BARBELL',
              manufacturer: 'GymCo',
              modelName: 'Bench Pro',
              weightOptions: [20, 40, 60, 80, 100],
            },
            setNumber: 1,
            weight: 100,
            reps: 5,
            rir: 2,
            isDropSet: true,
            notes: 'top set',
            completedAt: new Date('2026-06-01T10:10:00.000Z'),
          },
          // Second block of a repeated lift (issue #429, v8).
          {
            exerciseId: bench.id,
            setNumber: 1,
            weight: 60,
            reps: 10,
            block: 1,
            completedAt: new Date('2026-06-01T10:30:00.000Z'),
          },
          {
            exerciseId: running.id,
            setNumber: 1,
            weight: 0,
            reps: 1,
            durationSec: 1800,
            distanceM: 5000,
            avgHr: 152,
            maxHr: 181,
            completedAt: new Date('2026-06-01T10:50:00.000Z'),
          },
        ],
      },
    },
  });
  await db.coachSession.create({
    data: {
      userId: user.id,
      weekStart: new Date('2026-06-01T00:00:00.000Z'),
      weekEnd: new Date('2026-06-07T00:00:00.000Z'),
      prompt: 'week summary',
      response: 'keep going',
      createdAt: new Date('2026-06-07T18:00:00.000Z'),
    },
  });
  await db.exerciseGoal.create({
    data: {
      userId: user.id,
      exerciseId: bench.id,
      targetWeight: 120,
      targetReps: 5,
      createdAt: new Date('2026-05-15T09:00:00.000Z'),
      achievedAt: new Date('2026-06-01T10:10:00.000Z'),
    },
  });
  await db.bodyweightEntry.createMany({
    data: [
      {
        userId: user.id,
        weightKg: 83.1,
        measuredAt: new Date('2026-05-20T07:00:00.000Z'),
        note: 'morning',
      },
      { userId: user.id, weightKg: 82.5, measuredAt: new Date('2026-06-05T07:00:00.000Z') },
    ],
  });
  await db.readinessCheckin.create({
    data: {
      userId: user.id,
      readiness: 4,
      sleepQuality: 3,
      soreness: { QUADS: 4, CHEST: 2 },
      note: 'legs heavy',
      createdAt: new Date('2026-06-01T09:00:00.000Z'),
    },
  });
  await db.conversation.create({
    data: {
      userId: user.id,
      title: 'Plateau on bench',
      createdAt: new Date('2026-06-02T08:00:00.000Z'),
      updatedAt: new Date('2026-06-02T08:05:00.000Z'),
      messages: {
        create: [
          {
            role: 'USER',
            content: 'My bench is stuck.',
            createdAt: new Date('2026-06-02T08:00:00.000Z'),
          },
          {
            role: 'ASSISTANT',
            content: 'Try a back-off set.',
            createdAt: new Date('2026-06-02T08:05:00.000Z'),
          },
        ],
      },
    },
  });
  return user;
}

async function countsFor(userId: string) {
  return {
    exercises: await db.exercise.count({ where: { userId } }),
    programs: await db.program.count({ where: { userId } }),
    sessions: await db.session.count({ where: { userId } }),
    sets: await db.set.count({ where: { session: { userId } } }),
    coachSessions: await db.coachSession.count({ where: { userId } }),
    goals: await db.exerciseGoal.count({ where: { userId } }),
    bodyweightEntries: await db.bodyweightEntry.count({ where: { userId } }),
    readinessCheckins: await db.readinessCheckin.count({ where: { userId } }),
    conversations: await db.conversation.count({ where: { userId } }),
    messages: await db.message.count({ where: { conversation: { userId } } }),
    gyms: await db.gym.count({ where: { userId } }),
    gymConfigs: await db.gymExerciseConfig.count({ where: { gym: { userId } } }),
    gymEquipment: await db.gymEquipment.count({ where: { gym: { userId } } }),
    gymEquipmentLinks: await db.gymEquipmentExercise.count({
      where: { equipment: { gym: { userId } } },
    }),
  };
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('GET /api/backup - export completeness (issue #168)', () => {
  it('exports version 8 with set blocks and all earlier backup fields', async () => {
    const user = await seedFullUser('a@test.dev');
    actAs(user.id);

    const res = await getBackup();
    expect(res.status).toBe(200);
    const dump = await res.json();

    expect(dump.version).toBe(8);
    expect(dump.profile).toMatchObject({
      displayName: 'Julien',
      bodyweight: 82.5,
      bodyweightGoalKg: 78,
      sex: 'MALE',
      heightCm: 181,
      goal: 'HYPERTROPHY',
      weeklyFrequency: 4,
      unit: 'LB',
      deloadUntil: '2026-07-05T00:00:00.000Z',
      activeGymName: 'Basement',
    });

    const pullup = dump.exercises.find((e: { name: string }) => e.name === 'Pull-up');
    expect(pullup.usesBodyweight).toBe(true);
    expect(pullup.equipmentType).toBe('BODYWEIGHT');
    // v7 (issue #404): the favourite flag rides along.
    expect(pullup.isFavorite).toBe(false);
    expect(dump.exercises.find((e: { name: string }) => e.name === 'Bench Press').isFavorite).toBe(
      true,
    );
    expect(dump.gyms).toEqual([
      {
        name: 'Basement',
        dumbbellWeights: [10, 12, 14, 16, 19],
        plateWeights: [1.25, 2.5, 5, 10, 20],
        barWeights: [20],
        equipment: [
          {
            name: 'Competition bench station',
            equipmentType: 'BARBELL',
            description: 'Flat bench with uprights and safety arms.',
            manufacturer: 'GymCo',
            modelName: 'Bench Pro',
            quantity: 2,
            weightOptions: [20, 40, 60, 80, 100],
            imageUrl: null,
            imageMimeType: 'image/png',
            imageBase64: EQUIPMENT_PNG_BASE64,
            exerciseNames: ['Bench Press'],
          },
        ],
        exerciseConfigs: [{ exerciseName: 'Running', isAvailable: false, weightOptions: [] }],
      },
    ]);
    expect(dump.sessions[0].gymName).toBe('Basement');

    const sets = dump.sessions[0].sets as Array<Record<string, unknown>>;
    const benchSet = sets.find((s) => s.exerciseName === 'Bench Press' && s.block == null);
    // v8 (issue #429): the block of a repeated lift rides along.
    expect(sets.find((s) => s.exerciseName === 'Bench Press' && s.block === 1)).toMatchObject({
      weight: 60,
      reps: 10,
    });
    expect(benchSet).toMatchObject({
      gymEquipmentName: 'Competition bench station',
      equipmentNameSnapshot: 'Competition bench station',
      equipmentLoadSnapshot: {
        version: 1,
        equipmentType: 'BARBELL',
        manufacturer: 'GymCo',
        modelName: 'Bench Pro',
        weightOptions: [20, 40, 60, 80, 100],
      },
    });
    const cardio = sets.find((s) => s.exerciseName === 'Running');
    expect(cardio).toMatchObject({ durationSec: 1800, distanceM: 5000, avgHr: 152, maxHr: 181 });

    const peGroups = dump.programs[0].workouts[0].exercises.map(
      (pe: { supersetGroup: number | null }) => pe.supersetGroup,
    );
    expect(peGroups).toEqual([1, 1]);

    expect(dump.exerciseGoals).toEqual([
      {
        exerciseName: 'Bench Press',
        targetWeight: 120,
        targetReps: 5,
        createdAt: '2026-05-15T09:00:00.000Z',
        achievedAt: '2026-06-01T10:10:00.000Z',
      },
    ]);
    expect(dump.bodyweightEntries).toHaveLength(2);
    expect(dump.readinessCheckins).toEqual([
      {
        readiness: 4,
        sleepQuality: 3,
        soreness: { QUADS: 4, CHEST: 2 },
        note: 'legs heavy',
        createdAt: '2026-06-01T09:00:00.000Z',
      },
    ]);
    expect(dump.conversations).toHaveLength(1);
    expect(dump.conversations[0].messages).toHaveLength(2);
  });

  it('rejects image-heavy exports before materializing an unrestorable backup', async () => {
    const user = await db.user.create({
      data: { email: 'export-budget@test.dev', passwordHash: 'x' },
    });
    const gym = await db.gym.create({
      data: { userId: user.id, name: 'Image-heavy gym' },
    });
    const maxImage = new Uint8Array(5 * 1024 * 1024);
    maxImage.set(EQUIPMENT_PNG);
    await db.gymEquipment.createMany({
      data: Array.from({ length: 8 }, (_, index) => ({
        gymId: gym.id,
        name: 'Image station ' + index,
        equipmentType: 'MACHINE' as const,
        imageData: maxImage,
        imageMimeType: 'image/png',
      })),
    });
    actAs(user.id);
    const materializeGyms = vi.spyOn(db.gym, 'findMany');

    const response = await getBackup();

    expect(response.status).toBe(413);
    expect(materializeGyms).not.toHaveBeenCalled();
    materializeGyms.mockRestore();
    expect(await response.json()).toEqual({
      error:
        'This backup is larger than the maximum restorable backup size. Reduce uploaded gym equipment images and try again.',
    });
  });
});

describe('POST /api/backup - restore round trip (issue #168)', () => {
  it('restores an export losslessly into a second user, ownership-scoped', async () => {
    const userA = await seedFullUser('a@test.dev');
    actAs(userA.id);
    const dumpA = await (await getBackup()).json();
    const countsA = await countsFor(userA.id);

    const userB = await db.user.create({
      data: { email: 'b@test.dev', passwordHash: 'x' },
    });
    actAs(userB.id);
    const res = await postBackup(jsonReq({ payload: dumpA, confirmReplace: true }));
    expect(res.status).toBe(200);

    // Field-for-field lossless round trip (ids regenerated, so compare the
    // re-export of user B against user A's export).
    const dumpB = await (await getBackup()).json();
    expect(comparable(dumpB)).toEqual(comparable(dumpA));

    // Ownership-scoped: user A's data is untouched, user B owns a full copy.
    expect(await countsFor(userA.id)).toEqual(countsA);
    expect(await countsFor(userB.id)).toEqual(countsA);

    // JSON null convention is preserved by restore: a set with no equipment
    // snapshot stores JSON null, not SQL NULL, matching the normal set writer.
    const [restoredNullState] = await db.$queryRaw<
      Array<{ isDbNull: boolean; isJsonNull: boolean }>
    >`
      SELECT
        s."equipmentLoadSnapshot" IS NULL AS "isDbNull",
        s."equipmentLoadSnapshot" = 'null'::jsonb AS "isJsonNull"
      FROM "Set" s
      JOIN "Session" sess ON sess."id" = s."sessionId"
      JOIN "Exercise" e ON e."id" = s."exerciseId"
      WHERE sess."userId" = ${userB.id} AND e."name" = 'Running'
      LIMIT 1
    `;
    expect(restoredNullState).toEqual({ isDbNull: false, isJsonNull: true });

    // The goal was re-linked to user B's own copy of the exercise.
    const goalB = await db.exerciseGoal.findFirst({
      where: { userId: userB.id },
      include: { exercise: true },
    });
    expect(goalB?.exercise.userId).toBe(userB.id);
    expect(goalB?.exercise.name).toBe('Bench Press');
    // The favourite flag was restored (v7, issue #404).
    expect(goalB?.exercise.isFavorite).toBe(true);
    const pullupB = await db.exercise.findFirst({ where: { userId: userB.id, name: 'Pull-up' } });
    expect(pullupB?.isFavorite).toBe(false);

    // The profile (including deload state) was restored onto user B.
    const profileB = await db.user.findUnique({ where: { id: userB.id } });
    expect(profileB?.displayName).toBe('Julien');
    expect(profileB?.unit).toBe('LB');
    expect(profileB?.bodyweightGoalKg).toBe(78);
    expect(profileB?.deloadUntil?.toISOString()).toBe('2026-07-05T00:00:00.000Z');
    const activeGymB = await db.gym.findFirst({ where: { id: profileB?.activeGymId ?? '' } });
    expect(activeGymB?.name).toBe('Basement');
    expect(profileB?.email).toBe('b@test.dev');
  });

  it('restores a block kept after its back-off row was removed, unchanged (issue #475)', async () => {
    // Reachable state: log a BBB day, then remove the back-off row. The seed's
    // Upper A holds the bench once but keeps its block 1 set. Every reader
    // normalizes at read time, so the restore keeps the stored block exactly.
    const userA = await seedFullUser('blocks-a@test.dev');
    actAs(userA.id);
    const dump = await (await getBackup()).json();

    const userB = await db.user.create({ data: { email: 'blocks-b@test.dev', passwordHash: 'x' } });
    actAs(userB.id);
    const res = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(res.status).toBe(200);

    const bench = await db.set.findMany({
      where: { session: { userId: userB.id, workout: { name: 'Upper A' } }, exercise: { name: 'Bench Press' } },
      orderBy: { block: 'asc' },
      select: { block: true, weight: true },
    });
    expect(
      await db.programExercise.count({
        where: { workout: { name: 'Upper A', program: { userId: userB.id } }, exercise: { name: 'Bench Press' } },
      }),
    ).toBe(1);
    expect(bench).toEqual([
      { block: 1, weight: 60 },
      { block: null, weight: 100 },
    ]);
  });

  it('still restores a version 1 backup (fields and models added in v2 absent)', async () => {
    const user = await db.user.create({
      data: { email: 'v1@test.dev', passwordHash: 'x', displayName: 'Keep Me' },
    });
    actAs(user.id);

    // Shape produced by the pre-#168 route: no profile, no v2 models, sets
    // and program exercises without the v2 fields.
    const v1Payload = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      user: { email: 'v1@test.dev', createdAt: '2025-01-01T00:00:00.000Z' },
      exercises: [
        {
          name: 'Squat',
          muscleGroup: 'QUADS',
          category: 'COMPOUND',
          defaultRestSec: 180,
          notes: null,
        },
      ],
      programs: [
        {
          name: 'Old Block',
          description: null,
          phase: 'base',
          isActive: false,
          startDate: '2025-11-01T00:00:00.000Z',
          endDate: null,
          workouts: [
            {
              name: 'Legs',
              dayOfWeek: 2,
              order: 1,
              exercises: [
                {
                  exerciseName: 'Squat',
                  order: 1,
                  targetSets: 4,
                  targetRepsMin: 5,
                  targetRepsMax: 8,
                  targetRIR: 1,
                  restSec: 180,
                  tempo: null,
                  notes: null,
                },
              ],
            },
          ],
        },
      ],
      sessions: [
        {
          programName: 'Old Block',
          workoutName: 'Legs',
          startedAt: '2025-11-03T10:00:00.000Z',
          finishedAt: null,
          notes: null,
          sets: [
            {
              exerciseName: 'Squat',
              setNumber: 1,
              weight: 140,
              reps: 5,
              rir: 1,
              notes: null,
              isWarmup: false,
              isDropSet: false,
              completedAt: '2025-11-03T10:15:00.000Z',
            },
          ],
        },
      ],
      coachSessions: [],
    };

    const res = await postBackup(jsonReq({ payload: v1Payload, confirmReplace: true }));
    expect(res.status).toBe(200);

    const counts = await countsFor(user.id);
    expect(counts.exercises).toBe(1);
    expect(counts.programs).toBe(1);
    expect(counts.sets).toBe(1);
    expect(counts.goals).toBe(0);
    expect(counts.bodyweightEntries).toBe(0);
    expect(counts.readinessCheckins).toBe(0);
    expect(counts.conversations).toBe(0);

    // v2 fields default to their pre-#168 values.
    const squat = await db.exercise.findFirst({ where: { userId: user.id } });
    expect(squat?.usesBodyweight).toBe(false);
    // v7 field: an older backup imports with no favourites.
    expect(squat?.isFavorite).toBe(false);
    const pe = await db.programExercise.findFirst({
      where: { workout: { program: { userId: user.id } } },
    });
    expect(pe?.supersetGroup).toBeNull();
    const set = await db.set.findFirst({ where: { session: { userId: user.id } } });
    expect(set?.durationSec).toBeNull();
    expect(set?.avgHr).toBeNull();
    expect(set?.maxHr).toBeNull();

    // No profile in a v1 file: the account's profile is left alone.
    const profile = await db.user.findUnique({ where: { id: user.id } });
    expect(profile?.displayName).toBe('Keep Me');
  });
});

describe('POST /api/backup - malformed and oversized input (issue #168)', () => {
  it('rejects out-of-bounds values without touching existing data', async () => {
    const user = await seedFullUser('victim@test.dev');
    actAs(user.id);
    const before = await countsFor(user.id);
    const dump = await (await getBackup()).json();

    dump.sessions[0].sets[0].avgHr = 999; // out of the 40..250 range
    const res = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(res.status).toBe(400);

    // Validation failed before the transaction: nothing was deleted.
    expect(await countsFor(user.id)).toEqual(before);
  });

  it('rejects an out-of-bounds max HR without touching existing data (issue #203)', async () => {
    const user = await seedFullUser('victim-maxhr@test.dev');
    actAs(user.id);
    const before = await countsFor(user.id);
    const dump = await (await getBackup()).json();

    dump.sessions[0].sets[0].maxHr = 999; // out of the 40..250 range
    const res = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(res.status).toBe(400);
    expect(await countsFor(user.id)).toEqual(before);
  });

  it('rejects an out-of-range date as a clean 400, not a Prisma 500', async () => {
    const user = await seedFullUser('victim-date@test.dev');
    actAs(user.id);
    const before = await countsFor(user.id);
    const dump = await (await getBackup()).json();

    // Year 275760 parses in JS Date but is far outside PostgreSQL's range;
    // it must be rejected by validation, not 500 deep in Prisma.
    dump.sessions[0].startedAt = '+275760-09-13T00:00:00.000Z';
    const res = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(res.status).toBe(400);
    expect(await countsFor(user.id)).toEqual(before);
  });

  it('rejects a non-JSON body and a missing confirmReplace', async () => {
    const user = await seedFullUser('victim2@test.dev');
    actAs(user.id);
    const before = await countsFor(user.id);

    const notJson = await postBackup(
      new Request('http://test.local/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json {{{',
      }),
    );
    expect(notJson.status).toBe(400);

    const dump = await (await getBackup()).json();
    const noConfirm = await postBackup(jsonReq({ payload: dump, confirmReplace: false }));
    expect(noConfirm.status).toBe(400);

    expect(await countsFor(user.id)).toEqual(before);
  });

  it('rolls back the whole restore when a row fails mid-transaction', async () => {
    const user = await seedFullUser('victim3@test.dev');
    actAs(user.id);
    const before = await countsFor(user.id);
    const dump = await (await getBackup()).json();
    const pristine = JSON.parse(JSON.stringify(dump));

    // Passes Zod but violates the (userId, name) unique constraint during the
    // restore: the transaction must roll back, leaving the user's previous
    // data fully intact (not wiped, not partially replaced).
    dump.exercises.push({ ...dump.exercises[0] });
    const res = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(res.status).toBe(409);

    expect(await countsFor(user.id)).toEqual(before);
    const dumpAfter = await (await getBackup()).json();
    expect(comparable(dumpAfter)).toEqual(comparable(pristine));
  });

  it('purges the MCP backfill audits of the sets it replaces, and only those', async () => {
    const user = await seedFullUser('audited@test.dev');
    const other = await db.user.create({
      data: { email: 'bystander@test.dev', passwordHash: 'x' },
    });
    const oldSet = await db.set.findFirstOrThrow({ where: { session: { userId: user.id } } });
    const auditData = {
      gymId: 'gym-before-restore',
      exerciseId: oldSet.exerciseId,
      equipmentId: 'equipment-before-restore',
      setIds: [oldSet.id],
      equipmentSnapshot: { gymEquipmentId: 'equipment-before-restore' },
    };
    await db.mcpHistoricalEquipmentBackfillAudit.create({
      data: { ...auditData, userId: user.id },
    });
    await db.mcpHistoricalEquipmentBackfillAudit.create({
      data: { ...auditData, userId: other.id },
    });
    actAs(user.id);
    const dump = await (await getBackup()).json();

    // A restore that fails mid-transaction rolls the purge back with the rest.
    const broken = JSON.parse(JSON.stringify(dump));
    broken.exercises.push({ ...broken.exercises[0] });
    expect((await postBackup(jsonReq({ payload: broken, confirmReplace: true }))).status).toBe(409);
    expect(await db.mcpHistoricalEquipmentBackfillAudit.count({ where: { userId: user.id } })).toBe(
      1,
    );

    const res = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(res.status).toBe(200);

    // The audited set id no longer exists, so its audit is gone with it...
    expect(await db.set.findUnique({ where: { id: oldSet.id } })).toBeNull();
    expect(await db.mcpHistoricalEquipmentBackfillAudit.count({ where: { userId: user.id } })).toBe(
      0,
    );
    // ...while another user's audit trail is untouched.
    expect(
      await db.mcpHistoricalEquipmentBackfillAudit.count({ where: { userId: other.id } }),
    ).toBe(1);
  });

  it('rejects an oversized body with 413 while reading it', async () => {
    const user = await db.user.create({
      data: { email: 'big@test.dev', passwordHash: 'x' },
    });
    actAs(user.id);

    // 50 MiB cap: a body just past it must be cut off during the read.
    const oversized = '{"payload": "' + 'x'.repeat(50 * 1024 * 1024) + '"}';
    const res = await postBackup(
      new Request('http://test.local/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: oversized,
      }),
    );
    expect(res.status).toBe(413);
  });

  it('rejects an array past its cap (oversized backup shape)', async () => {
    const user = await db.user.create({
      data: { email: 'flood@test.dev', passwordHash: 'x' },
    });
    actAs(user.id);

    const entries = Array.from({ length: 20001 }, (_, i) => ({
      weightKg: 80,
      measuredAt: new Date(1700000000000 + i * 1000).toISOString(),
      note: null,
    }));
    const res = await postBackup(
      jsonReq({
        payload: {
          version: 2,
          exercises: [],
          programs: [],
          sessions: [],
          bodyweightEntries: entries,
        },
        confirmReplace: true,
      }),
    );
    expect(res.status).toBe(400);
    expect(await db.bodyweightEntry.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('POST /api/backup - gym normalization on import (issue #286)', () => {
  it('normalizes gym weight arrays and skips duplicate gym names instead of failing', async () => {
    const user = await db.user.create({
      data: { email: 'gyms@test.dev', passwordHash: 'x' },
    });
    actAs(user.id);

    // Hand-edited file: unsorted / duplicated / over-precise weights, and the
    // same gym name twice (which the @@unique([userId, name]) constraint would
    // otherwise reject, aborting the whole restore).
    const res = await postBackup(
      jsonReq({
        payload: {
          version: 3,
          profile: { activeGymName: 'Home' },
          exercises: [
            {
              name: 'Bench Press',
              muscleGroup: 'CHEST',
              category: 'COMPOUND',
              defaultRestSec: 120,
            },
          ],
          programs: [],
          sessions: [],
          gyms: [
            {
              name: ' Home ',
              dumbbellWeights: [20, 10, 12.499, 10],
              plateWeights: [],
              barWeights: [20],
              exerciseConfigs: [
                {
                  exerciseName: 'Bench Press',
                  isAvailable: true,
                  weightOptions: [60, 40, 60],
                },
              ],
            },
            {
              name: 'Home',
              dumbbellWeights: [5],
              plateWeights: [],
              barWeights: [],
              exerciseConfigs: [],
            },
          ],
        },
        confirmReplace: true,
      }),
    );
    expect(res.status).toBe(200);

    const gyms = await db.gym.findMany({
      where: { userId: user.id },
      include: { exerciseConfigs: true },
    });
    expect(gyms).toHaveLength(1);
    const gym = gyms[0]!;
    // First occurrence wins, with the same normalization the gym API applies.
    expect(gym.name).toBe('Home');
    expect(gym.dumbbellWeights).toEqual([10, 12.5, 20]);
    expect(gym.barWeights).toEqual([20]);
    expect(gym.exerciseConfigs[0]!.weightOptions).toEqual([40, 60]);

    // The active gym still resolves to the surviving row.
    const profile = await db.user.findUnique({ where: { id: user.id } });
    expect(profile?.activeGymId).toBe(gym.id);
  });
});
