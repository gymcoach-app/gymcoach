import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { buildCoachPayload } from '@/lib/coach';

// Cardio target of a programmed exercise (issue #558, slice 1): a CARDIO
// exercise in a workout is prescribed by a duration and an optional distance.
// Pinned here against a real database: the create and update routes store and
// return the target, refuse it on a strength exercise, bound it, stay
// owner-scoped; the backup carries it both ways; the coach payload names it.

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
    select: { targetDurationSec: true, targetDistanceM: true, targetSets: true, exerciseId: true },
  });
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('POST /api/workouts/[id]/program-exercises - cardio target (issue #558)', () => {
  it('stores and returns the duration and distance of a cardio exercise', async () => {
    const { user, running, workout } = await seed('cardio-create@test.dev');
    actAs(user.id);

    const res = await post(workout.id, {
      exerciseId: running.id,
      ...placeholders,
      targetDurationSec: 1200,
      targetDistanceM: 5000,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.targetDurationSec).toBe(1200);
    expect(body.targetDistanceM).toBe(5000);
    // The strength columns keep receiving their values.
    expect(body).toMatchObject(placeholders);
    expect(await stored(body.id)).toMatchObject({ targetDurationSec: 1200, targetDistanceM: 5000 });
  });

  it('stores a duration-only target, and no target at all when none is sent', async () => {
    const { user, running, rowing, workout } = await seed('cardio-create-partial@test.dev');
    actAs(user.id);

    const durationOnly = await post(workout.id, {
      exerciseId: running.id,
      ...placeholders,
      targetDurationSec: 1200,
    });
    expect(durationOnly.status).toBe(201);
    expect(await durationOnly.json()).toMatchObject({
      targetDurationSec: 1200,
      targetDistanceM: null,
    });

    // A writer that only knows the strength fields still creates a cardio row.
    const none = await post(workout.id, { exerciseId: rowing.id, ...placeholders });
    expect(none.status).toBe(201);
    expect(await none.json()).toMatchObject({ targetDurationSec: null, targetDistanceM: null });
  });

  it('refuses a cardio target on a strength exercise, and writes nothing', async () => {
    const { user, bench, workout } = await seed('cardio-create-strength@test.dev');
    actAs(user.id);

    for (const target of [
      { targetDurationSec: 1200 },
      { targetDistanceM: 5000 },
      { targetDurationSec: 1200, targetDistanceM: 5000 },
    ]) {
      const res = await post(workout.id, { exerciseId: bench.id, ...placeholders, ...target });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/cardio/i);
    }
    expect(await db.programExercise.count({ where: { workoutId: workout.id } })).toBe(0);

    // Explicit nulls are not a target: the strength row is created.
    const ok = await post(workout.id, {
      exerciseId: bench.id,
      ...placeholders,
      targetDurationSec: null,
      targetDistanceM: null,
    });
    expect(ok.status).toBe(201);
  });

  it('refuses a distance without a duration', async () => {
    const { user, running, workout } = await seed('cardio-create-distance@test.dev');
    actAs(user.id);

    const res = await post(workout.id, {
      exerciseId: running.id,
      ...placeholders,
      targetDistanceM: 5000,
    });
    expect(res.status).toBe(400);
    expect(await db.programExercise.count({ where: { workoutId: workout.id } })).toBe(0);
  });

  it('bounds the target like a logged cardio set', async () => {
    const { user, running, workout } = await seed('cardio-create-bounds@test.dev');
    actAs(user.id);

    for (const target of [
      { targetDurationSec: 0 },
      { targetDurationSec: 86401 },
      { targetDurationSec: 90.5 },
      { targetDurationSec: '1200' },
      { targetDurationSec: 1200, targetDistanceM: 0 },
      { targetDurationSec: 1200, targetDistanceM: -1 },
      { targetDurationSec: 1200, targetDistanceM: 1000001 },
    ]) {
      const res = await post(workout.id, { exerciseId: running.id, ...placeholders, ...target });
      expect(res.status, JSON.stringify(target)).toBe(400);
    }
    expect(await db.programExercise.count({ where: { workoutId: workout.id } })).toBe(0);

    const max = await post(workout.id, {
      exerciseId: running.id,
      ...placeholders,
      targetDurationSec: 86400,
      targetDistanceM: 1000000,
    });
    expect(max.status).toBe(201);
  });

  it("is a 404 on a stranger's workout, even with a valid target", async () => {
    const owner = await seed('cardio-create-owner@test.dev');
    const stranger = await seed('cardio-create-stranger@test.dev');
    actAs(stranger.user.id);

    const res = await post(owner.workout.id, {
      exerciseId: stranger.running.id,
      ...placeholders,
      targetDurationSec: 1200,
    });
    expect(res.status).toBe(404);
    expect(await db.programExercise.count({ where: { workoutId: owner.workout.id } })).toBe(0);
  });
});

describe('PUT /api/program-exercises/[id] - cardio target (issue #558)', () => {
  async function seedRow(email: string, target: Record<string, number> = {}) {
    const ctx = await seed(email);
    const row = await db.programExercise.create({
      data: {
        workoutId: ctx.workout.id,
        exerciseId: ctx.running.id,
        order: 1,
        ...placeholders,
        ...target,
      },
    });
    return { ...ctx, row };
  }

  it('sets, changes and returns the target of a cardio row', async () => {
    const { user, running, row } = await seedRow('cardio-put@test.dev');
    actAs(user.id);

    const set = await put(row.id, {
      exerciseId: running.id,
      ...placeholders,
      targetDurationSec: 1200,
      targetDistanceM: 5000,
    });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ targetDurationSec: 1200, targetDistanceM: 5000 });

    const changed = await put(row.id, {
      exerciseId: running.id,
      ...placeholders,
      targetDurationSec: 1800,
      targetDistanceM: null,
    });
    expect(changed.status).toBe(200);
    expect(await stored(row.id)).toMatchObject({ targetDurationSec: 1800, targetDistanceM: null });
  });

  it('leaves the target unchanged when the body does not name it', async () => {
    const { user, running, row } = await seedRow('cardio-put-absent@test.dev', {
      targetDurationSec: 1200,
      targetDistanceM: 5000,
    });
    actAs(user.id);

    // What the superset pairing and the in-session swap send: strength fields only.
    const res = await put(row.id, { exerciseId: running.id, ...placeholders, supersetGroup: 1 });
    expect(res.status).toBe(200);
    expect(await stored(row.id)).toMatchObject({ targetDurationSec: 1200, targetDistanceM: 5000 });
  });

  it('clears the distance with the duration', async () => {
    const { user, running, row } = await seedRow('cardio-put-clear@test.dev', {
      targetDurationSec: 1200,
      targetDistanceM: 5000,
    });
    actAs(user.id);

    const res = await put(row.id, {
      exerciseId: running.id,
      ...placeholders,
      targetDurationSec: null,
    });
    expect(res.status).toBe(200);
    expect(await stored(row.id)).toMatchObject({ targetDurationSec: null, targetDistanceM: null });
  });

  it('accepts a distance alone only when the row already has a duration', async () => {
    const withDuration = await seedRow('cardio-put-distance-ok@test.dev', {
      targetDurationSec: 1200,
    });
    actAs(withDuration.user.id);
    const ok = await put(withDuration.row.id, {
      exerciseId: withDuration.running.id,
      ...placeholders,
      targetDistanceM: 5000,
    });
    expect(ok.status).toBe(200);
    expect(await stored(withDuration.row.id)).toMatchObject({
      targetDurationSec: 1200,
      targetDistanceM: 5000,
    });

    const without = await seedRow('cardio-put-distance-ko@test.dev');
    actAs(without.user.id);
    const refused = await put(without.row.id, {
      exerciseId: without.running.id,
      ...placeholders,
      targetDistanceM: 5000,
    });
    expect(refused.status).toBe(400);
    expect(await stored(without.row.id)).toMatchObject({
      targetDurationSec: null,
      targetDistanceM: null,
    });
  });

  it('refuses a target on a strength exercise and keeps the row as it was', async () => {
    const { user, bench, row } = await seedRow('cardio-put-strength@test.dev', {
      targetDurationSec: 1200,
    });
    actAs(user.id);

    const res = await put(row.id, {
      exerciseId: bench.id,
      ...placeholders,
      targetDurationSec: 1500,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cardio/i);
    const after = await stored(row.id);
    expect(after.exerciseId).toBe(row.exerciseId);
    expect(after.targetDurationSec).toBe(1200);
  });

  it('drops the target when the row is switched to a strength exercise', async () => {
    const { user, bench, row } = await seedRow('cardio-put-switch@test.dev', {
      targetDurationSec: 1200,
      targetDistanceM: 5000,
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
      targetDistanceM: null,
    });
  });

  it('bounds the target', async () => {
    const { user, running, row } = await seedRow('cardio-put-bounds@test.dev', {
      targetDurationSec: 1200,
    });
    actAs(user.id);

    for (const target of [
      { targetDurationSec: 0 },
      { targetDurationSec: 86401 },
      { targetDurationSec: 1200, targetDistanceM: 1000001 },
      { targetDurationSec: 1200, targetDistanceM: 0 },
    ]) {
      const res = await put(row.id, { exerciseId: running.id, ...placeholders, ...target });
      expect(res.status, JSON.stringify(target)).toBe(400);
    }
    expect(await stored(row.id)).toMatchObject({ targetDurationSec: 1200, targetDistanceM: null });
  });

  it("is a 404 on a stranger's row and changes nothing", async () => {
    const owner = await seedRow('cardio-put-owner@test.dev', { targetDurationSec: 1200 });
    const stranger = await seed('cardio-put-stranger@test.dev');
    actAs(stranger.user.id);

    const res = await put(owner.row.id, {
      exerciseId: stranger.running.id,
      ...placeholders,
      targetDurationSec: 600,
    });
    expect(res.status).toBe(404);
    expect(await stored(owner.row.id)).toMatchObject({
      exerciseId: owner.running.id,
      targetDurationSec: 1200,
    });
  });
});

describe('backup - cardio target (issue #558)', () => {
  type DumpExercise = {
    exerciseName: string;
    targetDurationSec?: number | null;
    targetDistanceM?: number | null;
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
          targetDistanceM: 5000,
        },
        { workoutId: ctx.workout.id, exerciseId: ctx.rowing.id, order: 2, ...placeholders },
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

  async function restoredTargets(userId: string) {
    const rows = await db.programExercise.findMany({
      where: { workout: { program: { userId } } },
      orderBy: { order: 'asc' },
      select: {
        targetDurationSec: true,
        targetDistanceM: true,
        exercise: { select: { name: true } },
      },
    });
    return rows.map((r) => [r.exercise.name, r.targetDurationSec, r.targetDistanceM]);
  }

  it('exports the target and restores it into another account', async () => {
    const source = await seedBackupUser('cardio-backup-a@test.dev');
    const dump = await exportOf(source.user.id);

    expect(
      rowsOf(dump).map((r) => [r.exerciseName, r.targetDurationSec, r.targetDistanceM]),
    ).toEqual([
      ['Running', 1200, 5000],
      ['Rowing', null, null],
      ['Bench', null, null],
    ]);

    const target = await db.user.create({
      data: { email: 'cardio-backup-b@test.dev', passwordHash: 'x' },
    });
    actAs(target.id);
    const res = await postBackup(jsonReq('POST', { payload: dump, confirmReplace: true }));
    expect(res.status).toBe(200);
    expect(await restoredTargets(target.id)).toEqual([
      ['Running', 1200, 5000],
      ['Rowing', null, null],
      ['Bench', null, null],
    ]);

    // Lossless: the restored account exports the same program rows.
    expect(rowsOf(await exportOf(target.id))).toEqual(rowsOf(dump));
  });

  it('still imports an older backup without the two fields', async () => {
    const source = await seedBackupUser('cardio-backup-old@test.dev');
    const dump = await exportOf(source.user.id);
    dump.version = 11;
    for (const row of rowsOf(dump)) {
      delete row.targetDurationSec;
      delete row.targetDistanceM;
    }

    actAs(source.user.id);
    const res = await postBackup(jsonReq('POST', { payload: dump, confirmReplace: true }));
    expect(res.status).toBe(200);
    expect(await restoredTargets(source.user.id)).toEqual([
      ['Running', null, null],
      ['Rowing', null, null],
      ['Bench', null, null],
    ]);
  });

  it('rejects an out-of-bounds target without touching existing data', async () => {
    const source = await seedBackupUser('cardio-backup-bounds@test.dev');
    const before = await restoredTargets(source.user.id);

    for (const bad of [
      { targetDurationSec: 0 },
      { targetDurationSec: 86401 },
      { targetDurationSec: 12.5 },
      { targetDistanceM: 1000001 },
      { targetDistanceM: 0 },
    ]) {
      const dump = await exportOf(source.user.id);
      Object.assign(rowsOf(dump)[0]!, bad);
      actAs(source.user.id);
      const res = await postBackup(jsonReq('POST', { payload: dump, confirmReplace: true }));
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await restoredTargets(source.user.id)).toEqual(before);
    }
  });

  it('never restores a target onto a strength exercise, or a distance without a duration', async () => {
    const source = await seedBackupUser('cardio-backup-edited@test.dev');
    const dump = await exportOf(source.user.id);
    const rows = rowsOf(dump);
    // A hand-edited file: a distance alone on Rowing, a target on Bench.
    Object.assign(rows[1]!, { targetDurationSec: null, targetDistanceM: 3000 });
    Object.assign(rows[2]!, { targetDurationSec: 900, targetDistanceM: 2000 });

    actAs(source.user.id);
    const res = await postBackup(jsonReq('POST', { payload: dump, confirmReplace: true }));
    expect(res.status).toBe(200);
    expect(await restoredTargets(source.user.id)).toEqual([
      ['Running', 1200, 5000],
      ['Rowing', null, null],
      ['Bench', null, null],
    ]);
  });
});

describe('buildCoachPayload - cardio target in the active program (issue #558)', () => {
  it('carries minutes and kilometers on a cardio exercise with a target, and only there', async () => {
    const { user, running, rowing, bench, workout } = await seed('cardio-coach-target@test.dev');
    await db.programExercise.createMany({
      data: [
        {
          workoutId: workout.id,
          exerciseId: running.id,
          order: 1,
          ...placeholders,
          targetDurationSec: 1200,
          targetDistanceM: 5000,
        },
        {
          workoutId: workout.id,
          exerciseId: rowing.id,
          order: 2,
          ...placeholders,
          targetDurationSec: 750,
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
    expect(payload.activeProgram?.workouts[0]?.exercises).toEqual([
      {
        exerciseName: 'Running',
        targetSets: 1,
        targetRepsMin: 1,
        targetRepsMax: 1,
        targetRIR: 0,
        targetDurationMin: 20,
        targetDistanceKm: 5,
      },
      {
        exerciseName: 'Rowing',
        targetSets: 1,
        targetRepsMin: 1,
        targetRepsMax: 1,
        targetRIR: 0,
        targetDurationMin: 12.5,
      },
      { exerciseName: 'Bench', targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRIR: 2 },
    ]);
  });

  it('is unchanged, key for key, for a program without a cardio target', async () => {
    const { user, running, bench, workout } = await seed('cardio-coach-none@test.dev');
    await db.programExercise.createMany({
      data: [
        { workoutId: workout.id, exerciseId: running.id, order: 1, ...placeholders },
        {
          workoutId: workout.id,
          exerciseId: bench.id,
          order: 2,
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
        },
        { exerciseName: 'Bench', targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, targetRIR: 2 },
      ]),
    );
  });
});
