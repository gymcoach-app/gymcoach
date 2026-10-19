import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db';
import { getLastPerformances } from '@/lib/last-performance';

async function makeUser(email: string) {
  return db.user.create({ data: { email, passwordHash: 'x' } });
}

async function makeExercise(userId: string, name = 'Bench') {
  return db.exercise.create({
    data: { userId, name, muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
}

// A set's date controls both "most recent session" ordering and seeding.
function at(daysAgo: number): Date {
  return new Date(Date.UTC(2026, 0, 30 - daysAgo, 12, 0, 0));
}

describe('getLastPerformances', () => {
  it('returns the most recent session with its max load and reps at that load', async () => {
    const user = await makeUser('lp-recent@test.dev');
    const exo = await makeExercise(user.id);

    // Older session: should be ignored once a newer one exists.
    const older = await db.session.create({
      data: { userId: user.id, startedAt: at(7) },
    });
    await db.set.create({
      data: { sessionId: older.id, exerciseId: exo.id, setNumber: 1, weight: 80, reps: 8, completedAt: at(7) },
    });

    // Newer session: a warmup (excluded), then working sets. Top load 100,
    // reached for 5 then 6 reps -> repsAtMaxWeight must be the higher (6).
    const newer = await db.session.create({
      data: { userId: user.id, startedAt: at(1) },
    });
    await db.set.createMany({
      data: [
        { sessionId: newer.id, exerciseId: exo.id, setNumber: 1, weight: 60, reps: 12, isWarmup: true, completedAt: at(1) },
        { sessionId: newer.id, exerciseId: exo.id, setNumber: 2, weight: 90, reps: 8, completedAt: at(1) },
        { sessionId: newer.id, exerciseId: exo.id, setNumber: 3, weight: 100, reps: 5, completedAt: at(1) },
        { sessionId: newer.id, exerciseId: exo.id, setNumber: 4, weight: 100, reps: 6, completedAt: at(1) },
      ],
    });

    const map = await getLastPerformances(user.id, [exo.id], null);
    const perf = map.get(exo.id);

    expect(perf).toBeDefined();
    expect(perf!.sessionStartedAt.getTime()).toBe(at(1).getTime());
    expect(perf!.maxWeight).toBe(100);
    expect(perf!.repsAtMaxWeight).toBe(6);
    // Warmup excluded: 3 working sets only.
    expect(perf!.sets).toHaveLength(3);
    expect(perf!.sets.some((s) => s.weight === 60)).toBe(false);
    // Strength exercise: no cardio totals (issue #176).
    expect(perf!.cardio).toBeNull();
  });

  it('sums cardio duration/distance and averages heart rate (issue #176)', async () => {
    const user = await makeUser('lp-cardio@test.dev');
    const exo = await db.exercise.create({
      data: { userId: user.id, name: 'Running', muscleGroup: 'OTHER', category: 'CARDIO' },
    });

    const session = await db.session.create({ data: { userId: user.id, startedAt: at(1) } });
    // Two cardio sets: 20:00 / 3 km / 150 bpm and 10:00 / 2 km (no HR).
    await db.set.createMany({
      data: [
        {
          sessionId: session.id,
          exerciseId: exo.id,
          setNumber: 1,
          weight: 0,
          reps: 1,
          durationSec: 1200,
          distanceM: 3000,
          avgHr: 150,
          completedAt: at(1),
        },
        {
          sessionId: session.id,
          exerciseId: exo.id,
          setNumber: 2,
          weight: 0,
          reps: 1,
          durationSec: 600,
          distanceM: 2000,
          avgHr: null,
          completedAt: at(1),
        },
      ],
    });

    const map = await getLastPerformances(user.id, [exo.id], null);
    const perf = map.get(exo.id);
    expect(perf?.cardio).toEqual({ durationSec: 1800, distanceM: 5000, avgHr: 150 });
  });

  it('excludes the current session via excludeSessionId', async () => {
    const user = await makeUser('lp-exclude@test.dev');
    const exo = await makeExercise(user.id);

    const previous = await db.session.create({ data: { userId: user.id, startedAt: at(5) } });
    await db.set.create({
      data: { sessionId: previous.id, exerciseId: exo.id, setNumber: 1, weight: 70, reps: 10, completedAt: at(5) },
    });
    const current = await db.session.create({ data: { userId: user.id, startedAt: at(0) } });
    await db.set.create({
      data: { sessionId: current.id, exerciseId: exo.id, setNumber: 1, weight: 110, reps: 3, completedAt: at(0) },
    });

    // Excluding the current session, the last performance is the previous one.
    const map = await getLastPerformances(user.id, [exo.id], current.id);
    expect(map.get(exo.id)?.maxWeight).toBe(70);

    // With no exclusion, the current session wins.
    const all = await getLastPerformances(user.id, [exo.id], null);
    expect(all.get(exo.id)?.maxWeight).toBe(110);
  });

  it("does not leak another user's sets", async () => {
    const owner = await makeUser('lp-owner@test.dev');
    const exo = await makeExercise(owner.id);
    const session = await db.session.create({ data: { userId: owner.id, startedAt: at(2) } });
    await db.set.create({
      data: { sessionId: session.id, exerciseId: exo.id, setNumber: 1, weight: 120, reps: 5, completedAt: at(2) },
    });

    const stranger = await makeUser('lp-stranger@test.dev');
    // The stranger asks for the owner's exercise id: ownership is enforced on
    // the session, so nothing is returned.
    const map = await getLastPerformances(stranger.id, [exo.id], null);
    expect(map.has(exo.id)).toBe(false);
  });

  it('returns an empty map when there is no history', async () => {
    const user = await makeUser('lp-empty@test.dev');
    const exo = await makeExercise(user.id);
    const map = await getLastPerformances(user.id, [exo.id], null);
    expect(map.size).toBe(0);
  });
});
