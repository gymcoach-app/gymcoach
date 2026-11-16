import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

// Reordering the exercises of a workout (issue #557, step 1):
// PUT /api/workouts/[id]/order takes the complete ordered list of the
// workout's ProgramExercise ids. Pinned here: the new order is persisted as
// 1..n, only an exact permutation of the workout's rows is accepted (so a
// stale client cannot corrupt the order), nothing is written on a refusal,
// and ownership gates the route before the body is looked at.

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { PUT as putWorkoutOrder } from '@/app/api/workouts/[id]/order/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function orderReq(body: unknown): Request {
  return new Request('http://test.local/api', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const targets = {
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 12,
  targetRIR: 2,
  restSec: 90,
};

const EXERCISES = [
  ['Bench', 'CHEST'],
  ['Row', 'BACK_THICKNESS'],
  ['Squat', 'QUADS'],
  ['Running', 'CALVES'],
] as const;

// One user with two workouts: Day A holds bench, row (a superset pair) and
// squat, in that order; Day B holds running.
async function seed(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'x' } });
  const program = await db.program.create({
    data: { userId: user.id, name: 'P', phase: 'Base' },
  });
  const dayA = await db.workout.create({
    data: { programId: program.id, name: 'Day A', order: 1 },
  });
  const dayB = await db.workout.create({
    data: { programId: program.id, name: 'Day B', order: 2 },
  });
  const exercises = [];
  for (const [name, muscleGroup] of EXERCISES) {
    exercises.push(
      await db.exercise.create({
        data: { userId: user.id, name, muscleGroup, category: 'COMPOUND' },
      }),
    );
  }
  const [benchEx, rowEx, squatEx, runEx] = exercises;
  const bench = await db.programExercise.create({
    data: { workoutId: dayA.id, exerciseId: benchEx!.id, order: 1, supersetGroup: 1, ...targets },
  });
  const row = await db.programExercise.create({
    data: { workoutId: dayA.id, exerciseId: rowEx!.id, order: 2, supersetGroup: 1, ...targets },
  });
  const squat = await db.programExercise.create({
    data: { workoutId: dayA.id, exerciseId: squatEx!.id, order: 3, ...targets },
  });
  const running = await db.programExercise.create({
    data: { workoutId: dayB.id, exerciseId: runEx!.id, order: 1, ...targets },
  });
  return { user, dayA, dayB, bench, row, squat, running };
}

// The stored ids of a workout, sorted by `order`, with the order values.
async function storedOrder(workoutId: string): Promise<Array<[string, number]>> {
  const rows = await db.programExercise.findMany({
    where: { workoutId },
    orderBy: { order: 'asc' },
    select: { id: true, order: true },
  });
  return rows.map((row) => [row.id, row.order]);
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('PUT /api/workouts/[id]/order (issue #557)', () => {
  it('persists the new order as 1..n and leaves the other fields alone', async () => {
    const { user, dayA, dayB, bench, row, squat, running } = await seed('order-ok@test.dev');
    actAs(user.id);

    const res = await putWorkoutOrder(
      orderReq({ programExerciseIds: [squat.id, bench.id, row.id] }),
      idParams(dayA.id),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      programExerciseIds: [squat.id, bench.id, row.id],
    });

    expect(await storedOrder(dayA.id)).toEqual([
      [squat.id, 1],
      [bench.id, 2],
      [row.id, 3],
    ]);
    // The pair is still a pair, the targets are untouched, and the other
    // workout did not move.
    const benchAfter = await db.programExercise.findUnique({ where: { id: bench.id } });
    expect(benchAfter?.supersetGroup).toBe(1);
    expect(benchAfter?.targetSets).toBe(3);
    expect(await storedOrder(dayB.id)).toEqual([[running.id, 1]]);
  });

  it('accepts the current order unchanged and normalizes sparse order values', async () => {
    const { user, dayA, bench, row, squat } = await seed('order-same@test.dev');
    await db.programExercise.update({ where: { id: squat.id }, data: { order: 40 } });
    actAs(user.id);

    const res = await putWorkoutOrder(
      orderReq({ programExerciseIds: [bench.id, row.id, squat.id] }),
      idParams(dayA.id),
    );
    expect(res.status).toBe(200);
    expect(await storedOrder(dayA.id)).toEqual([
      [bench.id, 1],
      [row.id, 2],
      [squat.id, 3],
    ]);
  });

  it.each([
    ['a missing id', (ids: Ids) => [ids.squat, ids.bench]],
    ['an extra unknown id', (ids: Ids) => [ids.squat, ids.bench, ids.row, 'does-not-exist']],
    ['a duplicated id', (ids: Ids) => [ids.squat, ids.bench, ids.bench]],
    ['a duplicate on top of the full list', (ids: Ids) => [ids.squat, ids.bench, ids.row, ids.row]],
    ['an unknown id in place of one', (ids: Ids) => [ids.squat, ids.bench, 'does-not-exist']],
    ["another workout's id in place of one", (ids: Ids) => [ids.squat, ids.bench, ids.running]],
    ["another workout's id on top", (ids: Ids) => [ids.squat, ids.bench, ids.row, ids.running]],
    ['an empty list', () => []],
  ])('refuses %s with 400 and writes nothing', async (_label, build) => {
    const { user, dayA, dayB, bench, row, squat, running } = await seed('order-bad@test.dev');
    actAs(user.id);

    const res = await putWorkoutOrder(
      orderReq({
        programExerciseIds: build({
          bench: bench.id,
          row: row.id,
          squat: squat.id,
          running: running.id,
        }),
      }),
      idParams(dayA.id),
    );
    expect(res.status).toBe(400);
    expect(await storedOrder(dayA.id)).toEqual([
      [bench.id, 1],
      [row.id, 2],
      [squat.id, 3],
    ]);
    expect(await storedOrder(dayB.id)).toEqual([[running.id, 1]]);
    const runningAfter = await db.programExercise.findUnique({ where: { id: running.id } });
    expect(runningAfter?.workoutId).toBe(dayB.id);
  });

  it('refuses a malformed body with 400', async () => {
    const { user, dayA, bench } = await seed('order-malformed@test.dev');
    actAs(user.id);
    for (const body of [
      {},
      { programExerciseIds: 'nope' },
      { programExerciseIds: [bench.id, 7] },
    ]) {
      const res = await putWorkoutOrder(orderReq(body), idParams(dayA.id));
      expect(res.status).toBe(400);
    }
  });

  it('accepts an empty list for an empty workout', async () => {
    const { user, dayB, running } = await seed('order-empty@test.dev');
    await db.programExercise.delete({ where: { id: running.id } });
    actAs(user.id);
    const res = await putWorkoutOrder(orderReq({ programExerciseIds: [] }), idParams(dayB.id));
    expect(res.status).toBe(200);
  });

  it('returns 404 to a stranger and leaves the order intact', async () => {
    const { dayA, bench, row, squat } = await seed('order-owner@test.dev');
    const stranger = await db.user.create({
      data: { email: 'order-stranger@test.dev', passwordHash: 'x' },
    });
    actAs(stranger.id);

    const res = await putWorkoutOrder(
      orderReq({ programExerciseIds: [squat.id, bench.id, row.id] }),
      idParams(dayA.id),
    );
    expect(res.status).toBe(404);
    expect(await storedOrder(dayA.id)).toEqual([
      [bench.id, 1],
      [row.id, 2],
      [squat.id, 3],
    ]);
  });

  it('returns 404 for an unknown workout, before any 400 about the body', async () => {
    const { user } = await seed('order-unknown@test.dev');
    actAs(user.id);
    const res = await putWorkoutOrder(orderReq({ nonsense: true }), idParams('no-such-workout'));
    expect(res.status).toBe(404);
  });

  it('refuses an unauthenticated caller', async () => {
    const { dayA, bench, row, squat } = await seed('order-anon@test.dev');
    mockUserId.mockResolvedValue(null as unknown as string);
    const res = await putWorkoutOrder(
      orderReq({ programExerciseIds: [squat.id, bench.id, row.id] }),
      idParams(dayA.id),
    );
    expect(res.status).toBe(401);
    expect((await storedOrder(dayA.id))[0]).toEqual([bench.id, 1]);
  });
});

interface Ids {
  bench: string;
  row: string;
  squat: string;
  running: string;
}
