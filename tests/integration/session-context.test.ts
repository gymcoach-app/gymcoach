import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db';
import { buildCurrentSessionContext } from '@/lib/coach';
import { READINESS_RECENCY_HOURS } from '@/lib/progression';

// In-session chat context (issue #111): the compact currentSession section the
// chat route attaches to the coach payload. Pure DB-derivation tests - the
// route only forwards the result, and ownership lives in the builder.

async function makeUser(email: string, bodyweight: number | null = null) {
  return db.user.create({ data: { email, passwordHash: 'x', bodyweight } });
}

// One program -> workout with one planned exercise (bench), one ad-hoc
// exercise (pull-ups, usesBodyweight) logged into the session on top of it.
async function seedLiveSession(userId: string) {
  const bench = await db.exercise.create({
    data: { userId, name: 'Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  const pullups = await db.exercise.create({
    data: {
      userId,
      name: 'Pull-ups',
      muscleGroup: 'BACK_WIDTH',
      category: 'COMPOUND',
      usesBodyweight: true,
    },
  });
  const program = await db.program.create({
    data: { userId, name: 'P', phase: 'Base', isActive: true },
  });
  const workout = await db.workout.create({
    data: { programId: program.id, name: 'Push day', order: 1 },
  });
  await db.programExercise.create({
    data: {
      workoutId: workout.id,
      exerciseId: bench.id,
      order: 1,
      targetSets: 3,
      targetRepsMin: 6,
      targetRepsMax: 10,
      targetRIR: 2,
      restSec: 150,
    },
  });
  const session = await db.session.create({
    data: {
      userId,
      workoutId: workout.id,
      startedAt: new Date('2026-06-11T10:00:00Z'),
    },
  });
  await db.set.create({
    data: {
      sessionId: session.id,
      exerciseId: bench.id,
      setNumber: 1,
      weight: 80,
      reps: 8,
      rir: 2,
    },
  });
  await db.set.create({
    data: {
      sessionId: session.id,
      exerciseId: bench.id,
      setNumber: 2,
      weight: 80,
      reps: 7,
      rir: 1,
      isDropSet: false,
    },
  });
  await db.set.create({
    data: {
      sessionId: session.id,
      exerciseId: pullups.id,
      setNumber: 1,
      weight: 0,
      reps: 10,
      isWarmup: false,
    },
  });
  return { session, workout, bench, pullups };
}

describe('buildCurrentSessionContext', () => {
  it('returns the compact live-session shape: workout, targets, sets logged in order', async () => {
    const user = await makeUser('ctx-shape@test.dev');
    const { session } = await seedLiveSession(user.id);

    const ctx = await buildCurrentSessionContext(user.id, session.id);
    expect(ctx).not.toBeNull();
    expect(ctx!.workoutName).toBe('Push day');
    expect(ctx!.startedAt).toBe('2026-06-11T10:00:00.000Z');
    expect(ctx!.readinessToday).toBeNull();

    // Planned exercise first (with its program targets), ad-hoc one after
    // (target null).
    expect(ctx!.exercises.map((e) => e.exerciseName)).toEqual(['Bench', 'Pull-ups']);
    const [benchCtx, pullupsCtx] = ctx!.exercises;
    expect(benchCtx!.target).toEqual({
      targetSets: 3,
      targetRepsMin: 6,
      targetRepsMax: 10,
      targetRIR: 2,
      restSec: 150,
    });
    expect(benchCtx!.setsLogged).toEqual([
      { setNumber: 1, weight: 80, reps: 8, rir: 2, isWarmup: false, isDropSet: false },
      { setNumber: 2, weight: 80, reps: 7, rir: 1, isWarmup: false, isDropSet: false },
    ]);
    expect(pullupsCtx!.target).toBeNull();
    expect(pullupsCtx!.setsLogged).toHaveLength(1);
  });

  it('reports effective loads for bodyweight exercises when the bodyweight is known', async () => {
    const user = await makeUser('ctx-bodyweight@test.dev', 82);
    const { session } = await seedLiveSession(user.id);

    const ctx = await buildCurrentSessionContext(user.id, session.id);
    const pullupsCtx = ctx!.exercises.find((e) => e.exerciseName === 'Pull-ups');
    // 0 added load + 82 kg bodyweight = 82 effective.
    expect(pullupsCtx!.setsLogged[0]!.weight).toBe(82);
    // Non-bodyweight loads are untouched.
    const benchCtx = ctx!.exercises.find((e) => e.exerciseName === 'Bench');
    expect(benchCtx!.setsLogged[0]!.weight).toBe(80);
  });

  it("ownership: returns null for another user's session and for an unknown id", async () => {
    const owner = await makeUser('ctx-owner@test.dev');
    const stranger = await makeUser('ctx-stranger@test.dev');
    const { session } = await seedLiveSession(owner.id);

    expect(await buildCurrentSessionContext(stranger.id, session.id)).toBeNull();
    expect(await buildCurrentSessionContext(owner.id, 'cl0000000000000000000000')).toBeNull();
  });

  it('includes a fresh readiness check-in and ignores a stale one', async () => {
    const user = await makeUser('ctx-readiness@test.dev');
    const { session } = await seedLiveSession(user.id);
    const now = new Date('2026-06-11T12:00:00Z');

    // Stale: outside the recency window that auto-regulates suggestions.
    await db.readinessCheckin.create({
      data: {
        userId: user.id,
        readiness: 1,
        sleepQuality: 1,
        createdAt: new Date(now.getTime() - (READINESS_RECENCY_HOURS + 2) * 60 * 60 * 1000),
      },
    });
    let ctx = await buildCurrentSessionContext(user.id, session.id, now);
    expect(ctx!.readinessToday).toBeNull();

    // Fresh: this morning's check-in rides along, soreness coerced to a map.
    await db.readinessCheckin.create({
      data: {
        userId: user.id,
        readiness: 3,
        sleepQuality: 4,
        soreness: { CHEST: 4 },
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      },
    });
    ctx = await buildCurrentSessionContext(user.id, session.id, now);
    expect(ctx!.readinessToday).toEqual({
      readiness: 3,
      sleepQuality: 4,
      soreness: { CHEST: 4 },
    });
  });

  it('handles a session without a workout (free session): no targets, sets still listed', async () => {
    const user = await makeUser('ctx-free@test.dev');
    const exercise = await db.exercise.create({
      data: { userId: user.id, name: 'Curl', muscleGroup: 'BICEPS', category: 'ISOLATION' },
    });
    const session = await db.session.create({ data: { userId: user.id } });
    await db.set.create({
      data: { sessionId: session.id, exerciseId: exercise.id, setNumber: 1, weight: 20, reps: 12 },
    });

    const ctx = await buildCurrentSessionContext(user.id, session.id);
    expect(ctx!.workoutName).toBeNull();
    expect(ctx!.exercises).toEqual([
      {
        exerciseName: 'Curl',
        muscleGroup: 'BICEPS',
        usesBodyweight: false,
        block: null,
        target: null,
        setsLogged: [
          { setNumber: 1, weight: 20, reps: 12, rir: null, isWarmup: false, isDropSet: false },
        ],
      },
    ]);
  });

  it('splits a repeated exercise into one entry per block, each with its own sets', async () => {
    const user = await makeUser('ctx-blocks@test.dev');
    const squat = await db.exercise.create({
      data: { userId: user.id, name: 'Back squat', muscleGroup: 'QUADS', category: 'COMPOUND' },
    });
    const program = await db.program.create({
      data: { userId: user.id, name: '5/3/1 BBB', phase: 'Base', isActive: true },
    });
    const workout = await db.workout.create({
      data: { programId: program.id, name: 'Squat day', order: 1 },
    });
    // The same lift twice, as the Boring But Big template programs it: the
    // 5/3/1 top sets, then 5x10 back-off sets of the same exercise.
    await db.programExercise.create({
      data: {
        workoutId: workout.id,
        exerciseId: squat.id,
        order: 1,
        targetSets: 3,
        targetRepsMin: 3,
        targetRepsMax: 5,
        targetRIR: 1,
        restSec: 180,
      },
    });
    await db.programExercise.create({
      data: {
        workoutId: workout.id,
        exerciseId: squat.id,
        order: 2,
        targetSets: 5,
        targetRepsMin: 10,
        targetRepsMax: 10,
        targetRIR: 2,
        restSec: 90,
      },
    });
    const session = await db.session.create({
      data: { userId: user.id, workoutId: workout.id, startedAt: new Date('2026-06-11T10:00:00Z') },
    });
    // The top set carries no block, the shape of every set written before the
    // column existed: it must read as the first occurrence, not vanish and not
    // be counted against both rows.
    await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: squat.id,
        setNumber: 1,
        weight: 140,
        reps: 5,
        rir: 1,
      },
    });
    await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: squat.id,
        block: 1,
        setNumber: 1,
        weight: 80,
        reps: 10,
        rir: 2,
      },
    });
    await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: squat.id,
        block: 1,
        setNumber: 2,
        weight: 80,
        reps: 10,
        rir: 2,
      },
    });

    const ctx = await buildCurrentSessionContext(user.id, session.id);

    // Two entries, same exercise name, one per program row in workout order,
    // each carrying its own block and its own targets.
    expect(ctx!.exercises.map((e) => [e.exerciseName, e.block])).toEqual([
      ['Back squat', 0],
      ['Back squat', 1],
    ]);
    const [topSets, backOff] = ctx!.exercises;
    expect(topSets!.target).toEqual({
      targetSets: 3,
      targetRepsMin: 3,
      targetRepsMax: 5,
      targetRIR: 1,
      restSec: 180,
    });
    expect(topSets!.setsLogged).toEqual([
      { setNumber: 1, weight: 140, reps: 5, rir: 1, isWarmup: false, isDropSet: false },
    ]);
    expect(backOff!.target!.targetRepsMin).toBe(10);
    // The 5x10 sets are not handed to the top-set row, and the block's own set
    // numbers (which restart per block) survive intact.
    expect(backOff!.setsLogged).toEqual([
      { setNumber: 1, weight: 80, reps: 10, rir: 2, isWarmup: false, isDropSet: false },
      { setNumber: 2, weight: 80, reps: 10, rir: 2, isWarmup: false, isDropSet: false },
    ]);
  });
});
