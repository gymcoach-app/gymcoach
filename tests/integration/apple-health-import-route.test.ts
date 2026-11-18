import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { resetRateLimits } from '@/lib/rate-limit';
import { APPLE_HEALTH_MAX_WORKOUTS_PER_REQUEST } from '@/lib/schemas/import';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as postImport } from '@/app/api/import/apple-health/route';
import { POST as postFit } from '@/app/api/import/fit/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function importReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://test.local/api/import/apple-health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function seedUser(email: string) {
  return db.user.create({ data: { email, passwordHash: 'x' } });
}

const RUN = {
  activityType: 'Running',
  startedAt: '2024-03-05T06:12:44.000Z',
  durationSec: 1830,
  distanceM: 5200,
  avgHr: 152,
  maxHr: 178,
};
const RIDE = {
  activityType: 'Cycling',
  startedAt: '2024-03-06T17:00:00.000Z',
  durationSec: 3600,
  distanceM: 24945,
  avgHr: 140,
  maxHr: null,
};
const HIIT = {
  activityType: 'HighIntensityIntervalTraining',
  startedAt: '2024-03-07T17:00:00.000Z',
  durationSec: 1200,
  distanceM: null,
  avgHr: null,
  maxHr: null,
};
const ROW = { ...HIIT, activityType: 'Rowing', startedAt: '2024-03-08T17:00:00.000Z' };

const WEIGHTS = [
  { measuredAt: '2024-03-05T06:00:00.000Z', weightKg: 81.4 },
  { measuredAt: '2024-03-06T06:00:00.000Z', weightKg: 81.1 },
];

beforeEach(() => {
  mockUserId.mockReset();
  resetRateLimits();
});

describe('POST /api/import/apple-health (preview)', () => {
  it('counts the workouts by exercise and writes nothing', async () => {
    const user = await seedUser('ah-preview@test.dev');
    actAs(user.id);

    const res = await postImport(
      importReq({ mode: 'preview', workouts: [RIDE, RUN, HIIT, ROW], bodyMass: WEIGHTS }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: 'preview',
      workouts: {
        importable: 4,
        duplicates: 0,
        conflicts: 0,
        byExercise: [
          { exerciseName: 'Cardio (imported)', count: 1 },
          { exerciseName: 'Cycling', count: 1 },
          { exerciseName: 'Rowing machine', count: 1 },
          { exerciseName: 'Running', count: 1 },
        ],
      },
      bodyMass: { importable: 2, duplicates: 0 },
    });

    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.exercise.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.bodyweightEntry.count({ where: { userId: user.id } })).toBe(0);
  });

  it('counts as duplicates the workouts within 2 minutes of an existing session', async () => {
    const user = await seedUser('ah-dup@test.dev');
    actAs(user.id);
    await db.session.createMany({
      data: [
        // 1 min 59 s after the run: inside the window.
        { userId: user.id, startedAt: new Date('2024-03-05T06:14:43.000Z') },
        // 2 min 1 s before the ride: outside.
        { userId: user.id, startedAt: new Date('2024-03-06T16:57:59.000Z') },
      ],
    });

    const res = await postImport(importReq({ mode: 'preview', workouts: [RUN, RIDE] }));
    expect((await res.json()).workouts).toEqual({
      importable: 1,
      duplicates: 1,
      conflicts: 0,
      byExercise: [{ exerciseName: 'Cycling', count: 1 }],
    });
  });

  it('counts one effort recorded twice in the same export once', async () => {
    const user = await seedUser('ah-twice@test.dev');
    actAs(user.id);
    const again = { ...RUN, startedAt: '2024-03-05T06:13:10.000Z', avgHr: null, maxHr: null };

    const res = await postImport(importReq({ mode: 'preview', workouts: [again, RUN] }));
    expect((await res.json()).workouts).toMatchObject({ importable: 1, duplicates: 1 });
  });

  it("does not count another user's sessions or weights as duplicates", async () => {
    const userA = await seedUser('ah-dup-a@test.dev');
    const userB = await seedUser('ah-dup-b@test.dev');
    await db.session.create({
      data: { userId: userB.id, startedAt: new Date(RUN.startedAt) },
    });
    await db.bodyweightEntry.create({
      data: { userId: userB.id, weightKg: 70, measuredAt: new Date(WEIGHTS[0]!.measuredAt) },
    });

    actAs(userA.id);
    const res = await postImport(importReq({ mode: 'preview', workouts: [RUN], bodyMass: WEIGHTS }));
    expect(await res.json()).toMatchObject({
      workouts: { importable: 1, duplicates: 0 },
      bodyMass: { importable: 2, duplicates: 0 },
    });
  });

  it('flags workouts whose default name is taken by a non-cardio exercise', async () => {
    const user = await seedUser('ah-conflict-preview@test.dev');
    actAs(user.id);
    await db.exercise.create({
      data: { userId: user.id, name: 'Running', muscleGroup: 'QUADS', category: 'COMPOUND' },
    });

    const res = await postImport(importReq({ mode: 'preview', workouts: [RUN, RIDE] }));
    expect((await res.json()).workouts).toEqual({
      importable: 1,
      duplicates: 0,
      conflicts: 1,
      byExercise: [{ exerciseName: 'Cycling', count: 1 }],
    });
  });

  it('requires auth', async () => {
    mockUserId.mockResolvedValue(null);
    const res = await postImport(importReq({ mode: 'preview', workouts: [RUN] }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/import/apple-health (confirm)', () => {
  it('creates one session with one cardio set per workout, on owner-scoped exercises', async () => {
    const user = await seedUser('ah-confirm@test.dev');
    actAs(user.id);

    const res = await postImport(importReq({ mode: 'confirm', workouts: [RUN, RIDE, HIIT] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: 'confirm',
      createdSessions: 3,
      createdSets: 3,
      createdExercises: 3,
      skippedDuplicates: 0,
      skippedConflicts: 0,
      bodyMass: { created: 0, duplicates: 0 },
    });

    const sessions = await db.session.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: 'asc' },
      include: { sets: { include: { exercise: true } } },
    });
    expect(sessions).toHaveLength(3);
    const run = sessions[0]!;
    expect(run.startedAt.toISOString()).toBe('2024-03-05T06:12:44.000Z');
    expect(run.finishedAt?.toISOString()).toBe('2024-03-05T06:43:14.000Z');
    expect(run.notes).toBe('Imported from Apple Health (Running).');
    expect(run.sets).toHaveLength(1);
    expect(run.sets[0]).toMatchObject({
      setNumber: 1,
      weight: 0,
      reps: 1,
      durationSec: 1830,
      distanceM: 5200,
      avgHr: 152,
      maxHr: 178,
    });
    expect(run.sets[0]?.completedAt?.toISOString()).toBe('2024-03-05T06:43:14.000Z');
    expect(run.sets[0]?.exercise).toMatchObject({
      name: 'Running',
      category: 'CARDIO',
      muscleGroup: 'OTHER',
      userId: user.id,
    });
    expect(sessions[1]!.sets[0]).toMatchObject({ distanceM: 24945, avgHr: 140, maxHr: null });
    expect(sessions[1]!.sets[0]?.exercise.name).toBe('Cycling');
    expect(sessions[2]!.sets[0]).toMatchObject({ durationSec: 1200, distanceM: null });
    expect(sessions[2]!.sets[0]?.exercise.name).toBe('Cardio (imported)');
  });

  it('reuses the cardio exercise a FIT import created (same names, one exercise)', async () => {
    const user = await seedUser('ah-shared-names@test.dev');
    actAs(user.id);
    // Official Garmin SDK fixture: running, start 2026-03-15T09:00:00Z.
    const fit =
      'DgLYUlkAAAAuRklUmYtAAAAAAAUAAQIBAoQCAoQEBIYDBIwABP8AAAAQKRlE0gQAAEEAABIACP0EhgIEhgUBAgcEhggEhgkEhhABAhEBAgHsLhlEECkZRAFg4xYAYOMWACChBwCWr/Jq';
    const fitRes = await postFit(
      new Request('http://test.local/api/import/fit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fit, mode: 'confirm' }),
      }),
    );
    expect(fitRes.status).toBe(200);

    const res = await postImport(importReq({ mode: 'confirm', workouts: [RUN] }));
    expect(await res.json()).toMatchObject({ createdSessions: 1, createdExercises: 0 });
    expect(await db.exercise.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.set.count({ where: { session: { userId: user.id } } })).toBe(2);
  });

  it('skips duplicates, so importing the same export twice adds nothing', async () => {
    const user = await seedUser('ah-twice-confirm@test.dev');
    actAs(user.id);
    const body = { mode: 'confirm', workouts: [RUN, RIDE], bodyMass: WEIGHTS };

    const first = await postImport(importReq(body));
    expect(await first.json()).toMatchObject({
      createdSessions: 2,
      bodyMass: { created: 2, duplicates: 0 },
    });

    // A newer export: the same history plus one new workout and one new weight.
    const second = await postImport(
      importReq({
        mode: 'confirm',
        workouts: [RUN, RIDE, ROW],
        bodyMass: [...WEIGHTS, { measuredAt: '2024-03-08T06:00:00.000Z', weightKg: 80.9 }],
      }),
    );
    expect(await second.json()).toEqual({
      mode: 'confirm',
      createdSessions: 1,
      createdSets: 1,
      createdExercises: 1,
      skippedDuplicates: 2,
      skippedConflicts: 0,
      bodyMass: { created: 1, duplicates: 2 },
    });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(3);
    expect(await db.bodyweightEntry.count({ where: { userId: user.id } })).toBe(3);
  });

  it('skips only the workouts whose name collides with a non-cardio exercise', async () => {
    const user = await seedUser('ah-conflict@test.dev');
    actAs(user.id);
    const squat = await db.exercise.create({
      data: { userId: user.id, name: 'Running', muscleGroup: 'QUADS', category: 'COMPOUND' },
    });

    const res = await postImport(importReq({ mode: 'confirm', workouts: [RUN, RIDE] }));
    expect(await res.json()).toMatchObject({
      createdSessions: 1,
      createdExercises: 1,
      skippedConflicts: 1,
    });
    expect(await db.set.count({ where: { exerciseId: squat.id } })).toBe(0);
    expect(
      (await db.exercise.findUniqueOrThrow({ where: { id: squat.id } })).category,
    ).toBe('COMPOUND');
  });

  it("never writes into another user's account, even when their exercise has the name", async () => {
    const owner = await seedUser('ah-owner@test.dev');
    const stranger = await seedUser('ah-stranger@test.dev');
    const ownersRunning = await db.exercise.create({
      data: { userId: owner.id, name: 'Running', muscleGroup: 'OTHER', category: 'CARDIO' },
    });
    await db.bodyweightEntry.create({
      data: { userId: owner.id, weightKg: 90, measuredAt: new Date('2024-01-01T06:00:00.000Z') },
    });
    await db.user.update({ where: { id: owner.id }, data: { bodyweight: 90 } });

    actAs(stranger.id);
    const res = await postImport(
      importReq({ mode: 'confirm', workouts: [RUN], bodyMass: WEIGHTS }),
    );
    expect(await res.json()).toMatchObject({
      createdSessions: 1,
      createdExercises: 1,
      bodyMass: { created: 2 },
    });

    // The owner's account is untouched.
    expect(await db.session.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.set.count({ where: { exerciseId: ownersRunning.id } })).toBe(0);
    expect(await db.bodyweightEntry.count({ where: { userId: owner.id } })).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).bodyweight).toBe(90);

    // The stranger got their own rows, on their own exercise.
    const set = await db.set.findFirstOrThrow({
      where: { session: { userId: stranger.id } },
      include: { exercise: true },
    });
    expect(set.exercise.userId).toBe(stranger.id);
    expect(set.exerciseId).not.toBe(ownersRunning.id);
  });
});

describe('POST /api/import/apple-health (body weight)', () => {
  it('adds entries at their measured time and re-syncs the current bodyweight', async () => {
    const user = await seedUser('ah-weight@test.dev');
    actAs(user.id);

    const res = await postImport(importReq({ mode: 'confirm', bodyMass: WEIGHTS }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      createdSessions: 0,
      bodyMass: { created: 2, duplicates: 0 },
    });

    const entries = await db.bodyweightEntry.findMany({
      where: { userId: user.id },
      orderBy: { measuredAt: 'asc' },
    });
    expect(entries.map((e) => [e.measuredAt.toISOString(), e.weightKg, e.note])).toEqual([
      ['2024-03-05T06:00:00.000Z', 81.4, 'Imported from Apple Health.'],
      ['2024-03-06T06:00:00.000Z', 81.1, 'Imported from Apple Health.'],
    ]);
    // The newest entry is the current value the rest of the app reads.
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).bodyweight).toBe(81.1);
  });

  it('skips a day that already has an entry, and a second entry of the same day', async () => {
    const user = await seedUser('ah-weight-dup@test.dev');
    actAs(user.id);
    await db.bodyweightEntry.create({
      data: { userId: user.id, weightKg: 82, measuredAt: new Date('2024-03-05T21:30:00.000Z') },
    });
    const bodyMass = [
      ...WEIGHTS,
      // Same UTC day as the second entry.
      { measuredAt: '2024-03-06T22:00:00.000Z', weightKg: 81.6 },
    ];

    const preview = await postImport(importReq({ mode: 'preview', bodyMass }));
    expect((await preview.json()).bodyMass).toEqual({ importable: 1, duplicates: 2 });

    const res = await postImport(importReq({ mode: 'confirm', bodyMass }));
    expect((await res.json()).bodyMass).toEqual({ created: 1, duplicates: 2 });
    const entries = await db.bodyweightEntry.findMany({
      where: { userId: user.id },
      orderBy: { measuredAt: 'asc' },
    });
    expect(entries.map((e) => e.weightKg)).toEqual([82, 81.1]);
  });

  it('does not move the current bodyweight when the imported entries are older', async () => {
    const user = await seedUser('ah-weight-old@test.dev');
    actAs(user.id);
    await db.bodyweightEntry.create({
      data: { userId: user.id, weightKg: 79, measuredAt: new Date('2024-06-01T06:00:00.000Z') },
    });
    await db.user.update({ where: { id: user.id }, data: { bodyweight: 79 } });

    await postImport(importReq({ mode: 'confirm', bodyMass: WEIGHTS }));
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).bodyweight).toBe(79);
  });
});

describe('POST /api/import/apple-health (validation and limits)', () => {
  it.each([
    ['a strength workout', { workouts: [{ ...RUN, activityType: 'TraditionalStrengthTraining' }] }],
    ['an activity type that is not a plain name', { workouts: [{ ...RUN, activityType: 'Run<b>' }] }],
    ['a duration over 24 hours', { workouts: [{ ...RUN, durationSec: 86401 }] }],
    ['a zero duration', { workouts: [{ ...RUN, durationSec: 0 }] }],
    ['a fractional duration', { workouts: [{ ...RUN, durationSec: 12.5 }] }],
    ['a distance over 1000 km', { workouts: [{ ...RUN, distanceM: 1000001 }] }],
    ['a negative distance', { workouts: [{ ...RUN, distanceM: -1 }] }],
    ['an average heart rate under 40', { workouts: [{ ...RUN, avgHr: 39 }] }],
    ['a peak heart rate over 250', { workouts: [{ ...RUN, maxHr: 251 }] }],
    ['a start before 2000', { workouts: [{ ...RUN, startedAt: '1999-12-31T23:59:59.000Z' }] }],
    ['a start in the far future', { workouts: [{ ...RUN, startedAt: '2999-01-01T00:00:00.000Z' }] }],
    ['a start that is not an ISO instant', { workouts: [{ ...RUN, startedAt: '2024-03-05 07:12:44 +0100' }] }],
    ['a missing field', { workouts: [{ activityType: 'Running', startedAt: RUN.startedAt }] }],
    ['a body weight under 20 kg', { bodyMass: [{ ...WEIGHTS[0], weightKg: 19.9 }] }],
    ['a body weight over 300 kg', { bodyMass: [{ ...WEIGHTS[0], weightKg: 300.1 }] }],
    ['a body weight sent as text', { bodyMass: [{ ...WEIGHTS[0], weightKg: '80' }] }],
    ['an empty batch', { workouts: [], bodyMass: [] }],
    ['no batch at all', {}],
    [
      'more workouts than one request may carry',
      { workouts: Array.from({ length: APPLE_HEALTH_MAX_WORKOUTS_PER_REQUEST + 1 }, () => RUN) },
    ],
  ])('rejects %s with a 400 and writes nothing', async (_label, payload) => {
    const user = await seedUser('ah-invalid@test.dev');
    actAs(user.id);

    const res = await postImport(importReq({ mode: 'confirm', ...payload }));
    expect(res.status).toBe(400);
    expect(await db.session.count()).toBe(0);
    expect(await db.exercise.count()).toBe(0);
    expect(await db.bodyweightEntry.count()).toBe(0);
  });

  it('rejects an unknown mode and invalid JSON', async () => {
    const user = await seedUser('ah-mode@test.dev');
    actAs(user.id);
    expect((await postImport(importReq({ mode: 'apply', workouts: [RUN] }))).status).toBe(400);
    expect((await postImport(importReq('{not json'))).status).toBe(400);
  });

  it('refuses a body over the cap, declared or streamed', async () => {
    const user = await seedUser('ah-cap@test.dev');
    actAs(user.id);

    const declared = await postImport(
      importReq({ mode: 'preview', workouts: [RUN] }, { 'content-length': String(600 * 1024) }),
    );
    expect(declared.status).toBe(413);

    const padded = JSON.stringify({
      mode: 'confirm',
      workouts: [RUN],
      padding: 'x'.repeat(600 * 1024),
    });
    const streamed = await postImport(importReq(padded));
    expect(streamed.status).toBe(413);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('accepts a full batch of workouts', async () => {
    const user = await seedUser('ah-full@test.dev');
    actAs(user.id);
    const start = Date.UTC(2022, 0, 1);
    const workouts = Array.from({ length: APPLE_HEALTH_MAX_WORKOUTS_PER_REQUEST }, (_, i) => ({
      ...RUN,
      startedAt: new Date(start + i * 3_600_000).toISOString(),
    }));

    const res = await postImport(importReq({ mode: 'confirm', workouts }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      createdSessions: APPLE_HEALTH_MAX_WORKOUTS_PER_REQUEST,
      createdExercises: 1,
    });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(
      APPLE_HEALTH_MAX_WORKOUTS_PER_REQUEST,
    );
  });

  it('charges the shared import:<userId> bucket and tells the client when to retry', async () => {
    const user = await seedUser('ah-rate@test.dev');
    const other = await seedUser('ah-rate-other@test.dev');
    actAs(user.id);

    // Two charges through another import route: the bucket is shared.
    for (let i = 0; i < 2; i++) {
      await postFit(
        new Request('http://test.local/api/import/fit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fit: 'AAAA', mode: 'preview' }),
        }),
      );
    }
    for (let i = 0; i < 8; i++) {
      const res = await postImport(importReq({ mode: 'preview', workouts: [RUN] }));
      expect(res.status).toBe(200);
    }

    const limited = await postImport(importReq({ mode: 'confirm', workouts: [RUN] }));
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.error).toMatch(/Too many import requests/);
    expect(body.retryAfterSec).toBeGreaterThan(0);
    expect(body.retryAfterSec).toBeLessThanOrEqual(60);
    expect(limited.headers.get('Retry-After')).toBe(String(body.retryAfterSec));
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);

    // The bucket is per user: someone else is not limited.
    actAs(other.id);
    const fine = await postImport(importReq({ mode: 'preview', workouts: [RUN] }));
    expect(fine.status).toBe(200);
  });
});
