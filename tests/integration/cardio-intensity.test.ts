import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { buildCoachPayload } from '@/lib/coach';
import { duplicateWorkout } from '@/lib/programs/duplicate';

// Intensity of the cardio target of a programmed exercise (issue #558,
// slice 2): an optional RPE from 1 to 10 and an optional heart rate range in
// bpm next to the duration. Pinned here against a real database: the create
// and update routes store and return them, refuse them on a strength exercise
// or without a duration, bound them, stay owner-scoped; the backup carries
// them both ways and still imports older files; the coach payload names them;
// a copied workout keeps them.

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as postProgramExercise } from '@/app/api/workouts/[id]/program-exercises/route';
import { PUT as putProgramExercise } from '@/app/api/program-exercises/[id]/route';
import { GET as getBackup, POST as postBackup } from '@/app/api/backup/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function jsonReq(method: string, body: unknown): Request {
  return new Request('http://test.local/api', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// The strength columns stay required: a cardio row keeps sending them.
const placeholders = {
  targetSets: 1,
  targetRepsMin: 1,
  targetRepsMax: 1,
  targetRIR: 0,
  restSec: 120,
};

const intensity = { targetRpe: 6, targetHrMin: 140, targetHrMax: 150 };
const noIntensity = { targetRpe: null, targetHrMin: null, targetHrMax: null };

async function seed(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'x' } });
  const running = await db.exercise.create({
    data: { userId: user.id, name: 'Running', muscleGroup: 'OTHER', category: 'CARDIO' },
  });
  const rowing = await db.exercise.create({
    data: { userId: user.id, name: 'Rowing', muscleGroup: 'OTHER', category: 'CARDIO' },
  });
  const bench = await db.exercise.create({
    data: { userId: user.id, name: 'Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  const program = await db.program.create({
    data: { userId: user.id, name: 'Hybrid', phase: 'Base', isActive: true },
  });
  const workout = await db.workout.create({
    data: { programId: program.id, name: 'Day A', order: 1 },
  });
  return { user, running, rowing, bench, program, workout };
}

function post(workoutId: string, body: unknown) {
  return postProgramExercise(jsonReq('POST', body), { params: Promise.resolve({ id: workoutId }) });
}

function put(id: string, body: unknown) {
  return putProgramExercise(jsonReq('PUT', body), { params: Promise.resolve({ id }) });
}

async function stored(id: string) {
  return db.programExercise.findUniqueOrThrow({
    where: { id },
    select: {
      targetDurationSec: true,
      targetDistanceM: true,
      targetRpe: true,
      targetHrMin: true,
      targetHrMax: true,
      exerciseId: true,
    },
  });
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('POST /api/workouts/[id]/program-exercises - cardio intensity (issue #558)', () => {
  it('stores and returns the RPE and the heart rate range of a cardio exercise', async () => {
    const { user, running, workout } = await seed('intensity-create@test.dev');
    actAs(user.id);

    const res = await post(workout.id, {
      exerciseId: running.id,
      ...placeholders,
      targetDurationSec: 1200,
      ...intensity,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ targetDurationSec: 1200, targetDistanceM: null, ...intensity });
    expect(await stored(body.id)).toMatchObject({ targetDurationSec: 1200, ...intensity });
  });

  it('stores each half alone, and no intensity when none is sent', async () => {
    const { user, running, rowing, workout } = await seed('intensity-create-partial@test.dev');
    actAs(user.id);

    const rpeOnly = await post(workout.id, {
      exerciseId: running.id,
      ...placeholders,
      targetDurationSec: 1200,
      targetRpe: 4,
    });
    expect(rpeOnly.status).toBe(201);
    expect(await rpeOnly.json()).toMatchObject({
      targetRpe: 4,
      targetHrMin: null,
      targetHrMax: null,
    });

    // A slice 1 writer, which only knows duration and distance.
    const none = await post(workout.id, {
      exerciseId: rowing.id,
      ...placeholders,
      targetDurationSec: 900,
      targetDistanceM: 2000,
    });
    expect(none.status).toBe(201);
    expect(await none.json()).toMatchObject({
      targetDurationSec: 900,
      targetDistanceM: 2000,
      ...noIntensity,
    });
  });

  it('refuses an intensity on a strength exercise, and writes nothing', async () => {
    const { user, bench, workout } = await seed('intensity-create-strength@test.dev');
    actAs(user.id);

    for (const target of [{ targetRpe: 6 }, { targetHrMin: 140, targetHrMax: 150 }, intensity]) {
      const res = await post(workout.id, { exerciseId: bench.id, ...placeholders, ...target });
      expect(res.status, JSON.stringify(target)).toBe(400);
      expect((await res.json()).error).toMatch(/cardio/i);
    }
    expect(await db.programExercise.count({ where: { workoutId: workout.id } })).toBe(0);

    // Explicit nulls are not a target: the strength row is created.
    const ok = await post(workout.id, { exerciseId: bench.id, ...placeholders, ...noIntensity });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject(noIntensity);
  });

  it('refuses an intensity without a duration', async () => {
    const { user, running, workout } = await seed('intensity-create-no-duration@test.dev');
    actAs(user.id);

    for (const target of [{ targetRpe: 6 }, { targetHrMin: 140, targetHrMax: 150 }]) {
      const res = await post(workout.id, { exerciseId: running.id, ...placeholders, ...target });
      expect(res.status, JSON.stringify(target)).toBe(400);
      expect((await res.json()).error).toMatch(/duration/i);
    }
    expect(await db.programExercise.count({ where: { workoutId: workout.id } })).toBe(0);
  });

  it('bounds the RPE and the heart rate, and takes the range whole and in order', async () => {
    const { user, running, workout } = await seed('intensity-create-bounds@test.dev');
    actAs(user.id);

    for (const bad of [
      { targetRpe: 0 },
      { targetRpe: 11 },
      { targetRpe: 6.5 },
      { targetRpe: '6' },
      { targetHrMin: 39, targetHrMax: 150 },
      { targetHrMin: 140, targetHrMax: 251 },
      { targetHrMin: 140.5, targetHrMax: 150 },
      { targetHrMin: 150, targetHrMax: 140 },
      { targetHrMin: 140 },
      { targetHrMax: 150 },
      { targetHrMin: 140, targetHrMax: null },
    ]) {
      const res = await post(workout.id, {
        exerciseId: running.id,
        ...placeholders,
        targetDurationSec: 1200,
        ...bad,
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await db.programExercise.count({ where: { workoutId: workout.id } })).toBe(0);

    const edges = await post(workout.id, {
      exerciseId: running.id,
      ...placeholders,
      targetDurationSec: 1200,
      targetRpe: 10,
      targetHrMin: 40,
      targetHrMax: 250,
    });
    expect(edges.status).toBe(201);
  });

  it("is a 404 on a stranger's workout, even with a valid intensity", async () => {
    const owner = await seed('intensity-create-owner@test.dev');
    const stranger = await seed('intensity-create-stranger@test.dev');
    actAs(stranger.user.id);

    const res = await post(owner.workout.id, {
      exerciseId: stranger.running.id,
      ...placeholders,
      targetDurationSec: 1200,
      ...intensity,
    });
    expect(res.status).toBe(404);
    expect(await db.programExercise.count({ where: { workoutId: owner.workout.id } })).toBe(0);
  });
});

describe('PUT /api/program-exercises/[id] - cardio intensity (issue #558)', () => {
  async function seedRow(email: string, data: Record<string, unknown> = {}) {
    const ctx = await seed(email);
    const row = await db.programExercise.create({
      data: {
        workoutId: ctx.workout.id,
        exerciseId: ctx.running.id,
        order: 1,
        ...placeholders,
        ...data,
      },
    });
    return { ...ctx, row };
  }

  it('sets, changes and returns the intensity of a cardio row', async () => {
    const { user, running, row } = await seedRow('intensity-put@test.dev', {
      targetDurationSec: 1200,
    });
    actAs(user.id);
    const base = { exerciseId: running.id, ...placeholders, targetDurationSec: 1200 };

    const set = await put(row.id, { ...base, ...intensity });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject(intensity);

    const changed = await put(row.id, {
      ...base,
      targetRpe: 8,
      targetHrMin: 160,
      targetHrMax: 160,
    });
    expect(changed.status).toBe(200);
    expect(await stored(row.id)).toMatchObject({
      targetRpe: 8,
      targetHrMin: 160,
      targetHrMax: 160,
    });

    const cleared = await put(row.id, { ...base, ...noIntensity });
    expect(cleared.status).toBe(200);
    expect(await stored(row.id)).toMatchObject({ targetDurationSec: 1200, ...noIntensity });
  });

  it('leaves the intensity unchanged when the body does not name it', async () => {
    const { user, running, row } = await seedRow('intensity-put-absent@test.dev', {
      targetDurationSec: 1200,
      ...intensity,
    });
    actAs(user.id);

    // A slice 1 writer (duration and distance only), then the superset
    // pairing, which only knows the strength fields.
    const slice1 = await put(row.id, {
      exerciseId: running.id,
      ...placeholders,
      targetDurationSec: 1500,
      targetDistanceM: 5000,
    });
    expect(slice1.status).toBe(200);
    const pairing = await put(row.id, {
      exerciseId: running.id,
      ...placeholders,
      supersetGroup: 1,
    });
    expect(pairing.status).toBe(200);
    expect(await stored(row.id)).toMatchObject({
      targetDurationSec: 1500,
      targetDistanceM: 5000,
      ...intensity,
    });
  });

  it('clears the intensity with the duration', async () => {
    const { user, running, row } = await seedRow('intensity-put-clear@test.dev', {
      targetDurationSec: 1200,
      targetDistanceM: 5000,
      ...intensity,
    });
    actAs(user.id);

    const res = await put(row.id, {
      exerciseId: running.id,
      ...placeholders,
      targetDurationSec: null,
    });
    expect(res.status).toBe(200);
    expect(await stored(row.id)).toMatchObject({
      targetDurationSec: null,
      targetDistanceM: null,
      ...noIntensity,
    });
  });

  it('accepts an intensity alone only when the row already has a duration', async () => {
    const withDuration = await seedRow('intensity-put-alone-a@test.dev', {
      targetDurationSec: 1200,
    });
    actAs(withDuration.user.id);
    const ok = await put(withDuration.row.id, {
      exerciseId: withDuration.running.id,
      ...placeholders,
      ...intensity,
    });
    expect(ok.status).toBe(200);
    expect(await stored(withDuration.row.id)).toMatchObject({
      targetDurationSec: 1200,
      ...intensity,
    });

    const without = await seedRow('intensity-put-alone-b@test.dev');
    actAs(without.user.id);
    for (const target of [{ targetRpe: 6 }, { targetHrMin: 140, targetHrMax: 150 }]) {
      const res = await put(without.row.id, {
        exerciseId: without.running.id,
        ...placeholders,
        ...target,
      });
      expect(res.status, JSON.stringify(target)).toBe(400);
      expect((await res.json()).error).toMatch(/duration/i);
    }
    expect(await stored(without.row.id)).toMatchObject({
      targetDurationSec: null,
      ...noIntensity,
    });
  });

  it('refuses an intensity on a strength exercise and keeps the row as it was', async () => {
    const { user, bench, row } = await seedRow('intensity-put-strength@test.dev', {
      targetDurationSec: 1200,
      ...intensity,
    });
    actAs(user.id);

    const res = await put(row.id, { exerciseId: bench.id, ...placeholders, targetRpe: 6 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cardio/i);
    expect(await stored(row.id)).toMatchObject({ targetDurationSec: 1200, ...intensity });
  });

  it('drops the intensity when the row is switched to a strength exercise', async () => {
    const { user, bench, row } = await seedRow('intensity-put-switch@test.dev', {
      targetDurationSec: 1200,
      ...intensity,
    });
    actAs(user.id);

    const res = await put(row.id, {
      exerciseId: bench.id,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      restSec: 90,
    });
    expect(res.status).toBe(200);
    expect(await stored(row.id)).toMatchObject({
      exerciseId: bench.id,
      targetDurationSec: null,
      ...noIntensity,
    });
  });

  it('bounds the intensity and changes nothing on a refusal', async () => {
    const { user, running, row } = await seedRow('intensity-put-bounds@test.dev', {
      targetDurationSec: 1200,
      ...intensity,
    });
    actAs(user.id);

    for (const bad of [
      { targetRpe: 0 },
      { targetRpe: 11 },
      { targetHrMin: 39, targetHrMax: 150 },
      { targetHrMin: 140, targetHrMax: 251 },
      { targetHrMin: 150, targetHrMax: 140 },
      { targetHrMin: null, targetHrMax: 150 },
      { targetHrMax: 150 },
    ]) {
      const res = await put(row.id, {
        exerciseId: running.id,
        ...placeholders,
        targetDurationSec: 1200,
        ...bad,
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await stored(row.id)).toMatchObject({ targetDurationSec: 1200, ...intensity });
  });

  it("is a 404 on a stranger's row and changes nothing", async () => {
    const owner = await seedRow('intensity-put-owner@test.dev', {
      targetDurationSec: 1200,
      ...intensity,
    });
    const stranger = await seed('intensity-put-stranger@test.dev');
    actAs(stranger.user.id);

    const res = await put(owner.row.id, {
      exerciseId: stranger.running.id,
      ...placeholders,
      targetDurationSec: 600,
      targetRpe: 9,
      targetHrMin: 170,
      targetHrMax: 180,
    });
    expect(res.status).toBe(404);
    expect(await stored(owner.row.id)).toMatchObject({ targetDurationSec: 1200, ...intensity });
  });
});

describe('backup - cardio intensity (issue #558)', () => {
  type DumpExercise = {
    exerciseName: string;
    targetDurationSec?: number | null;
    targetDistanceM?: number | null;
    targetRpe?: number | null;
    targetHrMin?: number | null;
    targetHrMax?: number | null;
  };
  type Dump = {
    version: number;
    programs: Array<{ workouts: Array<{ exercises: DumpExercise[] }> }>;
  };

  async function seedBackupUser(email: string) {
    const ctx = await seed(email);
    await db.programExercise.createMany({
      data: [
        {
          workoutId: ctx.workout.id,
          exerciseId: ctx.running.id,
          order: 1,
          ...placeholders,
          targetDurationSec: 1200,
          ...intensity,
        },
        {
          workoutId: ctx.workout.id,
          exerciseId: ctx.rowing.id,
          order: 2,
          ...placeholders,
          targetDurationSec: 600,
        },
        {
          workoutId: ctx.workout.id,
          exerciseId: ctx.bench.id,
          order: 3,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetRIR: 2,
          restSec: 90,
        },
      ],
    });
    return ctx;
  }

  async function exportOf(userId: string): Promise<Dump> {
    actAs(userId);
    const res = await getBackup();
    expect(res.status).toBe(200);
    return (await res.json()) as Dump;
  }

  function rowsOf(dump: Dump): DumpExercise[] {
    return dump.programs[0]!.workouts[0]!.exercises;
  }

  async function restored(userId: string) {
    const rows = await db.programExercise.findMany({
      where: { workout: { program: { userId } } },
      orderBy: { order: 'asc' },
      select: {
        targetDurationSec: true,
        targetRpe: true,
        targetHrMin: true,
        targetHrMax: true,
        exercise: { select: { name: true } },
      },
    });
    return rows.map((r) => [
      r.exercise.name,
      r.targetDurationSec,
      r.targetRpe,
      r.targetHrMin,
      r.targetHrMax,
    ]);
  }

  const seeded = [
    ['Running', 1200, 6, 140, 150],
    ['Rowing', 600, null, null, null],
    ['Bench', null, null, null, null],
  ];

  it('exports format version 15 with the intensity and restores it into another account', async () => {
    const source = await seedBackupUser('intensity-backup-a@test.dev');
    const dump = await exportOf(source.user.id);

    expect(dump.version).toBe(15);
    expect(
      rowsOf(dump).map((r) => [
        r.exerciseName,
        r.targetDurationSec,
        r.targetRpe,
        r.targetHrMin,
        r.targetHrMax,
      ]),
    ).toEqual(seeded);

    const target = await db.user.create({
      data: { email: 'intensity-backup-b@test.dev', passwordHash: 'x' },
    });
    actAs(target.id);
    const res = await postBackup(jsonReq('POST', { payload: dump, confirmReplace: true }));
    expect(res.status).toBe(200);
    expect(await restored(target.id)).toEqual(seeded);

    // Lossless: the restored account exports the same program rows.
    expect(rowsOf(await exportOf(target.id))).toEqual(rowsOf(dump));
  });

  it('still imports a version 14 backup without the three fields', async () => {
    const source = await seedBackupUser('intensity-backup-old@test.dev');
    const dump = await exportOf(source.user.id);
    dump.version = 14;
    for (const row of rowsOf(dump)) {
      delete row.targetRpe;
      delete row.targetHrMin;
      delete row.targetHrMax;
    }

    actAs(source.user.id);
    const res = await postBackup(jsonReq('POST', { payload: dump, confirmReplace: true }));
    expect(res.status).toBe(200);
    // The duration target of the older format is kept, with no intensity.
    expect(await restored(source.user.id)).toEqual([
      ['Running', 1200, null, null, null],
      ['Rowing', 600, null, null, null],
      ['Bench', null, null, null, null],
    ]);
  });

  it('refuses a backup of a newer format version', async () => {
    const source = await seedBackupUser('intensity-backup-newer@test.dev');
    const dump = await exportOf(source.user.id);
    dump.version = 16;

    actAs(source.user.id);
    const res = await postBackup(jsonReq('POST', { payload: dump, confirmReplace: true }));
    expect(res.status).toBe(400);
    expect(await restored(source.user.id)).toEqual(seeded);
  });

  it('rejects an out-of-bounds intensity without touching existing data', async () => {
    const source = await seedBackupUser('intensity-backup-bounds@test.dev');

    for (const bad of [
      { targetRpe: 0 },
      { targetRpe: 11 },
      { targetRpe: 6.5 },
      { targetHrMin: 39 },
      { targetHrMax: 251 },
      { targetHrMin: 140.5 },
      { targetHrMax: '150' },
    ]) {
      const dump = await exportOf(source.user.id);
      Object.assign(rowsOf(dump)[0]!, bad);
      actAs(source.user.id);
      const res = await postBackup(jsonReq('POST', { payload: dump, confirmReplace: true }));
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await restored(source.user.id)).toEqual(seeded);
    }
  });

  it('never restores an intensity the live routes refuse', async () => {
    const source = await seedBackupUser('intensity-backup-edited@test.dev');
    const dump = await exportOf(source.user.id);
    const rows = rowsOf(dump);
    // A hand-edited file: a reversed range on Running (its RPE stays), half a
    // range on Rowing, an intensity on Bench (strength, and no duration).
    Object.assign(rows[0]!, { targetHrMin: 150, targetHrMax: 140 });
    Object.assign(rows[1]!, { targetHrMin: 120, targetHrMax: null });
    Object.assign(rows[2]!, { ...intensity });

    actAs(source.user.id);
    const res = await postBackup(jsonReq('POST', { payload: dump, confirmReplace: true }));
    expect(res.status).toBe(200);
    expect(await restored(source.user.id)).toEqual([
      ['Running', 1200, 6, null, null],
      ['Rowing', 600, null, null, null],
      ['Bench', null, null, null, null],
    ]);
  });

  it('drops an intensity that has no duration next to it', async () => {
    const source = await seedBackupUser('intensity-backup-no-duration@test.dev');
    const dump = await exportOf(source.user.id);
    Object.assign(rowsOf(dump)[0]!, { targetDurationSec: null });

    actAs(source.user.id);
    const res = await postBackup(jsonReq('POST', { payload: dump, confirmReplace: true }));
    expect(res.status).toBe(200);
    expect((await restored(source.user.id))[0]).toEqual(['Running', null, null, null, null]);
  });
});

describe('buildCoachPayload - cardio intensity in the active program (issue #558)', () => {
  it('carries the RPE and the heart rate range on a cardio exercise that has them', async () => {
    const { user, running, rowing, bench, workout } = await seed('intensity-coach@test.dev');
    await db.programExercise.createMany({
      data: [
        {
          workoutId: workout.id,
          exerciseId: running.id,
          order: 1,
          ...placeholders,
          targetDurationSec: 1200,
          ...intensity,
        },
        {
          workoutId: workout.id,
          exerciseId: rowing.id,
          order: 2,
          ...placeholders,
          targetDurationSec: 600,
          targetRpe: 8,
        },
        {
          workoutId: workout.id,
          exerciseId: bench.id,
          order: 3,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetRIR: 2,
          restSec: 90,
        },
      ],
    });

    const payload = await buildCoachPayload(user.id);
    // Serialized, so a key carrying undefined or null would show up.
    expect(JSON.stringify(payload.activeProgram?.workouts[0]?.exercises)).toBe(
      JSON.stringify([
        {
          exerciseName: 'Running',
          targetSets: 1,
          targetRepsMin: 1,
          targetRepsMax: 1,
          targetRIR: 0,
          targetDurationMin: 20,
          targetRpe: 6,
          targetHrMinBpm: 140,
          targetHrMaxBpm: 150,
        },
        {
          exerciseName: 'Rowing',
          targetSets: 1,
          targetRepsMin: 1,
          targetRepsMax: 1,
          targetRIR: 0,
          targetDurationMin: 10,
          targetRpe: 8,
        },
        { exerciseName: 'Bench', targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRIR: 2 },
      ]),
    );
  });
});

describe('copying a workout - cardio intensity (issue #558)', () => {
  it('keeps the intensity on the copied row', async () => {
    const { user, running, workout } = await seed('intensity-copy@test.dev');
    await db.programExercise.create({
      data: {
        workoutId: workout.id,
        exerciseId: running.id,
        order: 1,
        ...placeholders,
        targetDurationSec: 1200,
        ...intensity,
      },
    });

    const copy = await duplicateWorkout(user.id, workout.id, 'Day A (copy)');
    const rows = await db.programExercise.findMany({
      where: { workoutId: copy.id },
      select: { targetDurationSec: true, targetRpe: true, targetHrMin: true, targetHrMax: true },
    });
    expect(rows).toEqual([{ targetDurationSec: 1200, ...intensity }]);
  });
});
