import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { buildProgramFromGenerated } from '@/lib/program-generation';
import { getTemplateBySlug } from '@/lib/programs/templates';
import { getLastPerformances } from '@/lib/last-performance';
import { blockIndexByRow, blockKey } from '@/lib/exercise-blocks';

// Issue #429: a workout that programs the same lift twice (the built-in 5/3/1
// Boring But Big template: the 5/3/1 sets, then 5x10 of the same lift) logs
// each occurrence as its own block, and "last session" reads each block's own
// sets. A workout without a repeat stores and reads exactly as before.

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as postSet } from '@/app/api/sessions/[id]/sets/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function setReq(body: Record<string, unknown>): Request {
  return new Request('http://test.local/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postFor(sessionId: string, body: Record<string, unknown>) {
  return postSet(setReq(body), { params: Promise.resolve({ id: sessionId }) });
}

// Instantiates 5/3/1 BBB and returns day 1 (Overhead Press twice) with its
// repeated rows in workout order.
async function seedBbb(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'x' } });
  const template = getTemplateBySlug('531-bbb-4day');
  expect(template).toBeDefined();
  const programId = await buildProgramFromGenerated(user.id, template!.program);
  const workout = await db.workout.findFirstOrThrow({
    where: { programId, name: 'Day 1 - Overhead Press' },
    include: { exercises: { orderBy: { order: 'asc' }, include: { exercise: true } } },
  });
  const press = workout.exercises.filter((pe) => pe.exercise.name === 'Overhead Press');
  const chinup = workout.exercises.find((pe) => pe.exercise.name === 'Chin-up');
  expect(press).toHaveLength(2);
  expect(chinup).toBeDefined();
  return { user, programId, workout, main: press[0]!, bbb: press[1]!, chinup: chinup! };
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('5/3/1 BBB: a repeated lift logs as two blocks (issue #429)', () => {
  it('materializes the template with the main lift and its BBB row as blocks 0 and 1', async () => {
    const { workout, main, bbb, chinup } = await seedBbb('bbb-template@test.dev');
    const blocks = blockIndexByRow(workout.exercises);
    expect(blocks.get(main.id)).toBe(0);
    expect(blocks.get(bbb.id)).toBe(1);
    expect(blocks.get(chinup.id)).toBeNull();
    expect(main.targetSets).toBe(3);
    expect(bbb.targetSets).toBe(5);
  });

  it('stores each block on its sets and NULL for an exercise programmed once', async () => {
    const { user, programId, workout, main, chinup } = await seedBbb('bbb-log@test.dev');
    const session = await db.session.create({
      data: { userId: user.id, programId, workoutId: workout.id },
    });
    actAs(user.id);

    // The 5/3/1 sets (block 0), then the 5x10 (block 1), each numbered
    // within its own block.
    for (const [setNumber, weight, reps] of [
      [1, 40, 5],
      [2, 45, 5],
      [3, 50, 8],
    ] as const) {
      const res = await postFor(session.id, {
        exerciseId: main.exerciseId,
        setNumber,
        weight,
        reps,
        block: 0,
      });
      expect(res.status).toBe(201);
    }
    for (let setNumber = 1; setNumber <= 5; setNumber++) {
      const res = await postFor(session.id, {
        exerciseId: main.exerciseId,
        setNumber,
        weight: 27.5,
        reps: 10,
        block: 1,
      });
      expect(res.status).toBe(201);
    }
    // A client that sends a block for an exercise the workout holds once
    // still stores NULL, so single-occurrence rows are unchanged.
    const chin = await postFor(session.id, {
      exerciseId: chinup.exerciseId,
      setNumber: 1,
      weight: 0,
      reps: 8,
      block: 1,
    });
    expect(chin.status).toBe(201);

    const rows = await db.set.findMany({
      where: { sessionId: session.id },
      orderBy: [{ block: 'asc' }, { setNumber: 'asc' }],
    });
    const press = rows.filter((r) => r.exerciseId === main.exerciseId);
    expect(press.filter((r) => r.block === 0).map((r) => [r.setNumber, r.weight])).toEqual([
      [1, 40],
      [2, 45],
      [3, 50],
    ]);
    expect(press.filter((r) => r.block === 1)).toHaveLength(5);
    expect(press.filter((r) => r.block === 1).every((r) => r.reps === 10)).toBe(true);
    expect(rows.find((r) => r.exerciseId === chinup.exerciseId)?.block).toBeNull();
  });

  it('normalizes a missing or out-of-range block on a repeated lift to the first block', async () => {
    const { user, programId, workout, main } = await seedBbb('bbb-normalize@test.dev');
    const session = await db.session.create({
      data: { userId: user.id, programId, workoutId: workout.id },
    });
    actAs(user.id);

    // An old offline client queues sets without the field at all.
    const legacy = await postFor(session.id, {
      exerciseId: main.exerciseId,
      setNumber: 1,
      weight: 40,
      reps: 5,
    });
    expect(legacy.status).toBe(201);
    // Inside the schema bound but past the workout's two occurrences (a row
    // removed since the set was queued).
    const stale = await postFor(session.id, {
      exerciseId: main.exerciseId,
      setNumber: 2,
      weight: 40,
      reps: 5,
      block: 4,
    });
    expect(stale.status).toBe(201);

    const blocks = (await db.set.findMany({ where: { sessionId: session.id } })).map(
      (r) => r.block,
    );
    expect(blocks).toEqual([0, 0]);
  });

  it('rejects a malformed block with 400 and stores nothing', async () => {
    const { user, programId, workout, main } = await seedBbb('bbb-invalid@test.dev');
    const session = await db.session.create({
      data: { userId: user.id, programId, workoutId: workout.id },
    });
    actAs(user.id);

    for (const block of [-1, 1.5, 20, '1']) {
      const res = await postFor(session.id, {
        exerciseId: main.exerciseId,
        setNumber: 1,
        weight: 40,
        reps: 5,
        block,
      });
      expect(res.status).toBe(400);
    }
    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(0);
  });

  it("reads each block's last session separately for progression", async () => {
    const { user, programId, workout, main } = await seedBbb('bbb-last@test.dev');
    const previous = await db.session.create({
      data: {
        userId: user.id,
        programId,
        workoutId: workout.id,
        startedAt: new Date('2026-10-01T10:00:00.000Z'),
        finishedAt: new Date('2026-10-01T11:00:00.000Z'),
      },
    });
    await db.set.createMany({
      data: [
        { setNumber: 1, weight: 40, reps: 5, block: 0, minute: 1 },
        { setNumber: 2, weight: 45, reps: 5, block: 0, minute: 2 },
        { setNumber: 3, weight: 50, reps: 8, block: 0, minute: 3 },
        { setNumber: 1, weight: 27.5, reps: 10, block: 1, minute: 10 },
        { setNumber: 2, weight: 27.5, reps: 10, block: 1, minute: 11 },
      ].map(({ minute, ...set }) => ({
        ...set,
        sessionId: previous.id,
        exerciseId: main.exerciseId,
        completedAt: new Date(Date.UTC(2026, 9, 1, 10, minute)),
      })),
    });

    const perf = await getLastPerformances(user.id, [main.exerciseId], null, [
      { exerciseId: main.exerciseId, block: 0 },
      { exerciseId: main.exerciseId, block: 1 },
    ]);

    // The per-exercise entry is unchanged: every working set of the session.
    expect(perf.get(main.exerciseId)?.sets).toHaveLength(5);
    // Block 0 is the 5/3/1 work only; block 1 the 5x10 only.
    const mainBlock = perf.get(blockKey(main.exerciseId, 0));
    expect(mainBlock?.sets.map((s) => s.weight)).toEqual([40, 45, 50]);
    expect(mainBlock?.maxWeight).toBe(50);
    const bbbBlock = perf.get(blockKey(main.exerciseId, 1));
    expect(bbbBlock?.sets.map((s) => [s.weight, s.reps])).toEqual([
      [27.5, 10],
      [27.5, 10],
    ]);
    expect(bbbBlock?.repsAtMaxWeight).toBe(10);
  });

  it('reads sets stored before blocks existed as the first block, never as a later one', async () => {
    const { user, main } = await seedBbb('bbb-legacy@test.dev');
    const old = await db.session.create({
      data: {
        userId: user.id,
        startedAt: new Date('2026-09-01T10:00:00.000Z'),
        finishedAt: new Date('2026-09-01T11:00:00.000Z'),
      },
    });
    await db.set.create({
      data: {
        sessionId: old.id,
        exerciseId: main.exerciseId,
        setNumber: 1,
        weight: 50,
        reps: 5,
        completedAt: new Date('2026-09-01T10:05:00.000Z'),
      },
    });

    const perf = await getLastPerformances(user.id, [], null, [
      { exerciseId: main.exerciseId, block: 0 },
      { exerciseId: main.exerciseId, block: 1 },
    ]);
    expect(perf.get(blockKey(main.exerciseId, 0))?.maxWeight).toBe(50);
    expect(perf.has(blockKey(main.exerciseId, 1))).toBe(false);
  });

  it('reads a set stored on a since-removed row as the first block when the count is known', async () => {
    // Issue #475: the workout held the press three times when these sets were
    // logged; it holds it twice now, so a block 2 set has no row of its own.
    const { user, main } = await seedBbb('bbb-removed-row@test.dev');
    const old = await db.session.create({
      data: {
        userId: user.id,
        startedAt: new Date('2026-09-02T10:00:00.000Z'),
        finishedAt: new Date('2026-09-02T11:00:00.000Z'),
      },
    });
    await db.set.create({
      data: {
        sessionId: old.id,
        exerciseId: main.exerciseId,
        setNumber: 1,
        weight: 52.5,
        reps: 5,
        block: 2,
        completedAt: new Date('2026-09-02T10:05:00.000Z'),
      },
    });

    const withCount = await getLastPerformances(user.id, [], null, [
      { exerciseId: main.exerciseId, block: 0, occurrences: 2 },
      { exerciseId: main.exerciseId, block: 1, occurrences: 2 },
    ]);
    expect(withCount.get(blockKey(main.exerciseId, 0))?.maxWeight).toBe(52.5);
    expect(withCount.has(blockKey(main.exerciseId, 1))).toBe(false);

    // Without the count the lookup keeps its historical filter.
    const without = await getLastPerformances(user.id, [], null, [
      { exerciseId: main.exerciseId, block: 0 },
    ]);
    expect(without.has(blockKey(main.exerciseId, 0))).toBe(false);
  });

  it("never counts another user's workout rows when normalizing a block (issue #317)", async () => {
    // A session pointing at a stranger's BBB workout (not reachable through
    // the session routes, which check ownership) must not let that workout
    // decide the block: the count query is scoped to the caller's programs.
    const owner = await seedBbb('bbb-owner@test.dev');
    const stranger = await db.user.create({
      data: { email: 'bbb-stranger@test.dev', passwordHash: 'x' },
    });
    const press = await db.exercise.create({
      data: { userId: stranger.id, name: 'Overhead Press', muscleGroup: 'SHOULDERS_FRONT', category: 'COMPOUND' },
    });
    await db.programExercise.updateMany({
      where: { workoutId: owner.workout.id, exerciseId: owner.main.exerciseId },
      data: { exerciseId: press.id },
    });
    const session = await db.session.create({
      data: { userId: stranger.id, workoutId: owner.workout.id },
    });
    actAs(stranger.id);

    const res = await postFor(session.id, {
      exerciseId: press.id,
      setNumber: 1,
      weight: 40,
      reps: 5,
      block: 1,
    });
    expect(res.status).toBe(201);
    const stored = await db.set.findFirstOrThrow({ where: { sessionId: session.id } });
    expect(stored.block).toBeNull();
  });
});
