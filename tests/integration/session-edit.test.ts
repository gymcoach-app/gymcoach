import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { getLastPerformances } from '@/lib/last-performance';
import { best1RM } from '@/lib/stats';
import { resetRateLimits } from '@/lib/rate-limit';
import { isTransactionWriteConflict } from '@/lib/tx-conflict';

// Editing a finished session and logging a past one (issue #389). Pinned here:
// - ownership: a stranger gets 404 on every new write, and nothing changes;
// - the live session keeps its guards: without `amend` a finished session
//   still refuses sets and edits, and `amend` is refused while in progress;
// - a backfilled session is finished from the start and leaves the session in
//   progress alone;
// - what is derived follows the corrected data: last performance (the next
//   suggested load), the estimated 1RM over a date window, a goal's achievedAt.

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as startSession } from '@/app/api/sessions/route';
import { POST as logPastSession } from '@/app/api/sessions/past/route';
import { PATCH as patchSession, PUT as putSession } from '@/app/api/sessions/[id]/route';
import { POST as addSet } from '@/app/api/sessions/[id]/sets/route';
import { PATCH as patchSet, DELETE as deleteSet } from '@/app/api/sets/[id]/route';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

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

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function daysAgo(days: number): Date {
  // Whole minutes, like the instants the editor sends.
  return new Date(Math.floor((Date.now() - days * DAY) / MINUTE) * MINUTE);
}

async function seedUser(email = 'owner@test.dev') {
  return db.user.create({ data: { email, passwordHash: 'x' } });
}

async function seedBench(userId: string) {
  return db.exercise.create({
    data: { userId, name: 'Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
}

// A finished session with one working set logged ten minutes in.
async function seedFinishedSession(
  userId: string,
  exerciseId: string,
  startedAt: Date,
  values: { weight: number; reps: number } = { weight: 100, reps: 5 },
) {
  const session = await db.session.create({
    data: { userId, startedAt, finishedAt: new Date(startedAt.getTime() + 60 * MINUTE) },
  });
  const set = await db.set.create({
    data: {
      sessionId: session.id,
      exerciseId,
      setNumber: 1,
      ...values,
      completedAt: new Date(startedAt.getTime() + 10 * MINUTE),
    },
  });
  return { session, set };
}

function strengthSet(exerciseId: string, overrides: Record<string, unknown> = {}) {
  return { exerciseId, setNumber: 1, weight: 100, reps: 5, rir: 2, amend: true, ...overrides };
}

beforeEach(() => {
  mockUserId.mockReset();
  resetRateLimits();
});

describe('ownership: a stranger gets 404 and changes nothing', () => {
  it('PATCH /api/sessions/[id] does not move a stranger\'s session', async () => {
    const owner = await seedUser();
    const stranger = await seedUser('stranger@test.dev');
    const bench = await seedBench(owner.id);
    const startedAt = daysAgo(3);
    const { session, set } = await seedFinishedSession(owner.id, bench.id, startedAt);

    actAs(stranger.id);
    const res = await patchSession(
      jsonReq('PATCH', { startedAt: daysAgo(30).toISOString(), durationMin: 45 }),
      idParams(session.id),
    );
    expect(res.status).toBe(404);

    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.startedAt.getTime()).toBe(startedAt.getTime());
    const setRow = await db.set.findUniqueOrThrow({ where: { id: set.id } });
    expect(setRow.completedAt.getTime()).toBe(set.completedAt.getTime());
  });

  it('the amend set routes refuse a stranger', async () => {
    const owner = await seedUser();
    const stranger = await seedUser('stranger@test.dev');
    const bench = await seedBench(owner.id);
    const strangerBench = await seedBench(stranger.id);
    const { session, set } = await seedFinishedSession(owner.id, bench.id, daysAgo(3));

    actAs(stranger.id);
    const add = await addSet(
      jsonReq('POST', strengthSet(strangerBench.id, { setNumber: 2 })),
      idParams(session.id),
    );
    expect(add.status).toBe(404);
    const patch = await patchSet(
      jsonReq('PATCH', { weight: 200, reps: 1, rir: 0, amend: true }),
      idParams(set.id),
    );
    expect(patch.status).toBe(404);
    const remove = await deleteSet(jsonReq('DELETE', {}), idParams(set.id));
    expect(remove.status).toBe(404);

    const rows = await db.set.findMany({ where: { sessionId: session.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ weight: 100, reps: 5 });
  });

  it('POST /api/sessions/past refuses a stranger\'s workout and gym', async () => {
    const owner = await seedUser();
    const stranger = await seedUser('stranger@test.dev');
    const program = await db.program.create({ data: { userId: owner.id, name: 'PPL', phase: 'MAINTENANCE' } });
    const workout = await db.workout.create({
      data: { programId: program.id, name: 'Push', order: 1 },
    });
    const gym = await db.gym.create({ data: { userId: owner.id, name: 'Home' } });
    const timing = { startedAt: daysAgo(2).toISOString(), durationMin: 60 };

    actAs(stranger.id);
    const byWorkout = await logPastSession(jsonReq('POST', { workoutId: workout.id, ...timing }));
    expect(byWorkout.status).toBe(404);
    const byGym = await logPastSession(jsonReq('POST', { gymId: gym.id, ...timing }));
    expect(byGym.status).toBe(400);
    expect(await db.session.count()).toBe(0);
  });
});

describe('the live session keeps its guards', () => {
  it('a finished session refuses a set and an edit that do not say amend', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const { session, set } = await seedFinishedSession(user.id, bench.id, daysAgo(3));
    actAs(user.id);

    // What the offline queue sends for a set logged before the finish.
    const queued = await addSet(
      jsonReq('POST', strengthSet(bench.id, { setNumber: 2, amend: undefined })),
      idParams(session.id),
    );
    expect(queued.status).toBe(400);
    const edit = await patchSet(jsonReq('PATCH', { weight: 110, reps: 5, rir: 1 }), idParams(set.id));
    expect(edit.status).toBe(400);
    // Only the literal `amend: true` opens a finished session.
    const falseAmend = await patchSet(
      jsonReq('PATCH', { weight: 110, reps: 5, rir: 1, amend: false }),
      idParams(set.id),
    );
    expect(falseAmend.status).toBe(400);

    const rows = await db.set.findMany({ where: { sessionId: session.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ weight: 100, reps: 5, rir: null });
  });

  it('a session in progress refuses amend requests and a timing edit', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const session = await db.session.create({ data: { userId: user.id } });
    const set = await db.set.create({
      data: { sessionId: session.id, exerciseId: bench.id, setNumber: 1, weight: 100, reps: 5 },
    });
    actAs(user.id);

    const add = await addSet(
      jsonReq('POST', strengthSet(bench.id, { setNumber: 2 })),
      idParams(session.id),
    );
    expect(add.status).toBe(409);
    const edit = await patchSet(
      jsonReq('PATCH', { weight: 110, reps: 5, rir: 1, isWarmup: true, amend: true }),
      idParams(set.id),
    );
    expect(edit.status).toBe(409);
    const timing = await patchSession(
      jsonReq('PATCH', { startedAt: daysAgo(2).toISOString(), durationMin: 60 }),
      idParams(session.id),
    );
    expect(timing.status).toBe(409);

    // The live inline edit still works, and still only touches the values.
    const live = await patchSet(
      jsonReq('PATCH', { weight: 102.5, reps: 5, rir: 1, isWarmup: true }),
      idParams(set.id),
    );
    expect(live.status).toBe(200);
    const row = await db.set.findUniqueOrThrow({ where: { id: set.id } });
    expect(row).toMatchObject({ weight: 102.5, reps: 5, rir: 1, isWarmup: false });
    const open = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(open.finishedAt).toBeNull();
  });
});

describe('POST /api/sessions/past', () => {
  it('creates a finished session on the chosen date and leaves the one in progress alone', async () => {
    const user = await seedUser();
    const program = await db.program.create({ data: { userId: user.id, name: 'PPL', phase: 'MAINTENANCE' } });
    const workout = await db.workout.create({
      data: { programId: program.id, name: 'Push', order: 1 },
    });
    actAs(user.id);

    const liveRes = await startSession(jsonReq('POST', { workoutId: workout.id }));
    expect(liveRes.status).toBe(201);
    const live = (await liveRes.json()) as { id: string };

    const startedAt = daysAgo(10);
    const res = await logPastSession(
      jsonReq('POST', { workoutId: workout.id, startedAt: startedAt.toISOString(), durationMin: 75 }),
    );
    expect(res.status).toBe(201);
    const past = (await res.json()) as { id: string };
    expect(past.id).not.toBe(live.id);

    const row = await db.session.findUniqueOrThrow({ where: { id: past.id } });
    expect(row.startedAt.getTime()).toBe(startedAt.getTime());
    expect(row.finishedAt?.getTime()).toBe(startedAt.getTime() + 75 * MINUTE);
    expect(row).toMatchObject({ workoutId: workout.id, programId: program.id, freestyle: false });

    // Still one session in progress, the same one, and a new start resumes it.
    const open = await db.session.findMany({ where: { userId: user.id, finishedAt: null } });
    expect(open.map((s) => s.id)).toEqual([live.id]);
    const resumed = await startSession(jsonReq('POST', { workoutId: workout.id }));
    expect(resumed.status).toBe(200);
    expect(((await resumed.json()) as { id: string }).id).toBe(live.id);
  });

  it('logs a freestyle session when no workout is given', async () => {
    const user = await seedUser();
    actAs(user.id);
    const res = await logPastSession(
      jsonReq('POST', { startedAt: daysAgo(1).toISOString(), durationMin: 30 }),
    );
    expect(res.status).toBe(201);
    const row = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(row).toMatchObject({ workoutId: null, programId: null, freestyle: true });
    expect(row.finishedAt).not.toBeNull();
  });

  it('rejects a future date, a session that would end in the future and a bad body', async () => {
    const user = await seedUser();
    actAs(user.id);
    const tomorrow = new Date(Date.now() + DAY).toISOString();
    const tenMinutesAgo = new Date(Date.now() - 10 * MINUTE).toISOString();

    const cases: unknown[] = [
      { startedAt: tomorrow, durationMin: 60 },
      { startedAt: tenMinutesAgo, durationMin: 60 },
      { startedAt: '2026-11-03', durationMin: 60 },
      { startedAt: '2026-11-03T18:30:00', durationMin: 60 },
      { startedAt: daysAgo(1).toISOString(), durationMin: 0 },
      { startedAt: daysAgo(1).toISOString(), durationMin: 1441 },
      { startedAt: daysAgo(1).toISOString() },
      { durationMin: 60 },
      // New dates start in 2000, like the imports.
      { startedAt: '1999-12-31T10:00:00.000Z', durationMin: 60 },
    ];
    for (const body of cases) {
      const res = await logPastSession(jsonReq('POST', body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await db.session.count()).toBe(0);
  });
});

describe('derived data follows a corrected history', () => {
  it('a set added to a past session is dated inside it and does not become the last performance', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    // The real latest session: last week, 100 x 5.
    const lastWeek = daysAgo(7);
    await seedFinishedSession(user.id, bench.id, lastWeek);
    actAs(user.id);

    const pastStart = daysAgo(30);
    const pastRes = await logPastSession(
      jsonReq('POST', { startedAt: pastStart.toISOString(), durationMin: 60 }),
    );
    const past = (await pastRes.json()) as { id: string };

    const first = await addSet(
      jsonReq('POST', strengthSet(bench.id, { weight: 120, reps: 5 })),
      idParams(past.id),
    );
    expect(first.status).toBe(201);
    const second = await addSet(
      jsonReq('POST', strengthSet(bench.id, { setNumber: 2, weight: 120, reps: 4 })),
      idParams(past.id),
    );
    expect(second.status).toBe(201);

    const added = await db.set.findMany({
      where: { sessionId: past.id },
      orderBy: { setNumber: 'asc' },
    });
    expect(added).toHaveLength(2);
    for (const row of added) {
      expect(row.completedAt.getTime()).toBeGreaterThanOrEqual(pastStart.getTime());
      expect(row.completedAt.getTime()).toBeLessThanOrEqual(pastStart.getTime() + 60 * MINUTE);
    }
    expect(added[1]!.completedAt.getTime()).toBeGreaterThan(added[0]!.completedAt.getTime());

    // The next suggested load reads the last performance: still last week's.
    const last = (await getLastPerformances(user.id, [bench.id], null)).get(bench.id);
    expect(last?.maxWeight).toBe(100);
    expect(last?.sessionStartedAt.getTime()).toBe(lastWeek.getTime());
  });

  it('a corrected weight changes the last performance and the estimated 1RM', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    // Logged as 10 kg by mistake: the lifter did 100.
    const { set } = await seedFinishedSession(user.id, bench.id, daysAgo(2), { weight: 10, reps: 5 });
    actAs(user.id);

    const res = await patchSet(
      jsonReq('PATCH', { weight: 100, reps: 5, rir: 1, amend: true }),
      idParams(set.id),
    );
    expect(res.status).toBe(200);

    const last = (await getLastPerformances(user.id, [bench.id], null)).get(bench.id);
    expect(last).toMatchObject({ maxWeight: 100, repsAtMaxWeight: 5 });
    const sets = await db.set.findMany({
      where: { exerciseId: bench.id, session: { userId: user.id } },
      select: { weight: true, reps: true, isWarmup: true },
    });
    expect(best1RM(sets)).toBeCloseTo(100 * (1 + 5 / 30), 5);
  });

  it('a moved session takes its sets along, out of a date window and behind a newer session', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const recent = await seedFinishedSession(user.id, bench.id, daysAgo(2), { weight: 140, reps: 3 });
    await seedFinishedSession(user.id, bench.id, daysAgo(9), { weight: 100, reps: 5 });
    actAs(user.id);

    // It was logged on the wrong date: it happened two months ago.
    const target = daysAgo(60);
    const res = await patchSession(
      jsonReq('PATCH', { startedAt: target.toISOString(), durationMin: 60 }),
      idParams(recent.session.id),
    );
    expect(res.status).toBe(200);

    const moved = await db.session.findUniqueOrThrow({ where: { id: recent.session.id } });
    expect(moved.startedAt.getTime()).toBe(target.getTime());
    expect(moved.finishedAt?.getTime()).toBe(target.getTime() + 60 * MINUTE);
    const movedSet = await db.set.findUniqueOrThrow({ where: { id: recent.set.id } });
    // Same ten minutes into the session.
    expect(movedSet.completedAt.getTime()).toBe(target.getTime() + 10 * MINUTE);

    // The window the progress page reads (sets completed in the last 4 weeks).
    const since = daysAgo(28);
    const inWindow = await db.set.findMany({
      where: { exerciseId: bench.id, session: { userId: user.id }, completedAt: { gte: since } },
      select: { weight: true, reps: true, isWarmup: true },
    });
    expect(inWindow.map((s) => s.weight)).toEqual([100]);
    expect(best1RM(inWindow)).toBeCloseTo(100 * (1 + 5 / 30), 5);

    // And the session of nine days ago is now the last performance.
    const last = (await getLastPerformances(user.id, [bench.id], null)).get(bench.id);
    expect(last?.maxWeight).toBe(100);
  });

  it('keeps the stored duration when only the date moves, and squeezes the sets into a shorter one', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const startedAt = daysAgo(5);
    // 47 min 20 s: shown as 47 minutes.
    const session = await db.session.create({
      data: {
        userId: user.id,
        startedAt,
        finishedAt: new Date(startedAt.getTime() + 47 * MINUTE + 20 * 1000),
      },
    });
    const offsets = [5, 20, 47];
    const sets = [];
    for (const [index, minutes] of offsets.entries()) {
      sets.push(
        await db.set.create({
          data: {
            sessionId: session.id,
            exerciseId: bench.id,
            setNumber: index + 1,
            weight: 100,
            reps: 5,
            watchAvgHr: 120,
            watchMaxHr: 150,
            completedAt: new Date(startedAt.getTime() + minutes * MINUTE),
          },
        }),
      );
    }
    actAs(user.id);

    const target = daysAgo(6);
    const sameDuration = await patchSession(
      jsonReq('PATCH', { startedAt: target.toISOString() }),
      idParams(session.id),
    );
    expect(sameDuration.status).toBe(200);
    let row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.finishedAt!.getTime() - row.startedAt.getTime()).toBe(47 * MINUTE + 20 * 1000);
    let rows = await db.set.findMany({ where: { sessionId: session.id }, orderBy: { setNumber: 'asc' } });
    expect(rows.map((s) => s.completedAt.getTime() - target.getTime())).toEqual(
      offsets.map((minutes) => minutes * MINUTE),
    );
    // A plain move keeps the per-set heart rate of the watch file.
    expect(rows.every((s) => s.watchAvgHr === 120 && s.watchMaxHr === 150)).toBe(true);

    const shorter = await patchSession(jsonReq('PATCH', { durationMin: 30 }), idParams(session.id));
    expect(shorter.status).toBe(200);
    row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.finishedAt!.getTime() - row.startedAt.getTime()).toBe(30 * MINUTE);
    rows = await db.set.findMany({ where: { sessionId: session.id }, orderBy: { setNumber: 'asc' } });
    const times = rows.map((s) => s.completedAt.getTime());
    expect(times[0]!).toBeGreaterThanOrEqual(target.getTime());
    expect(times[2]!).toBeLessThanOrEqual(target.getTime() + 30 * MINUTE);
    expect(times[0]!).toBeLessThan(times[1]!);
    expect(times[1]!).toBeLessThan(times[2]!);
    // The spacing changed: the per-set heart rate no longer matches the sets.
    expect(rows.every((s) => s.watchAvgHr === null && s.watchMaxHr === null)).toBe(true);
  });

  it('rejects moving a session into the future', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const startedAt = daysAgo(3);
    const { session } = await seedFinishedSession(user.id, bench.id, startedAt);
    actAs(user.id);

    const tomorrow = await patchSession(
      jsonReq('PATCH', { startedAt: new Date(Date.now() + DAY).toISOString(), durationMin: 60 }),
      idParams(session.id),
    );
    expect(tomorrow.status).toBe(400);
    const endsLater = await patchSession(
      jsonReq('PATCH', {
        startedAt: new Date(Date.now() - 10 * MINUTE).toISOString(),
        durationMin: 120,
      }),
      idParams(session.id),
    );
    expect(endsLater.status).toBe(400);
    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.startedAt.getTime()).toBe(startedAt.getTime());
  });

  it('re-derives a goal\'s achievedAt from the corrected sets', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const recent = await seedFinishedSession(user.id, bench.id, daysAgo(2), { weight: 110, reps: 5 });
    const goal = await db.exerciseGoal.create({
      data: {
        userId: user.id,
        exerciseId: bench.id,
        targetWeight: 110,
        targetReps: 5,
        achievedAt: recent.set.completedAt,
      },
    });
    const achievedAt = async () =>
      (await db.exerciseGoal.findUniqueOrThrow({ where: { id: goal.id } })).achievedAt;
    actAs(user.id);

    // A session logged afterwards, dated a month ago, already met the target:
    // the goal was achieved then, not two days ago.
    const pastStart = daysAgo(30);
    const past = (await (
      await logPastSession(jsonReq('POST', { startedAt: pastStart.toISOString(), durationMin: 60 }))
    ).json()) as { id: string };
    const addRes = await addSet(
      jsonReq('POST', strengthSet(bench.id, { weight: 115, reps: 5 })),
      idParams(past.id),
    );
    const added = (await addRes.json()) as { id: string; completedAt: string };
    expect((await achievedAt())?.getTime()).toBe(new Date(added.completedAt).getTime());

    // Marked as a warm-up: it no longer counts, the later set does again.
    const warmup = await patchSet(
      jsonReq('PATCH', { weight: 115, reps: 5, rir: 2, isWarmup: true, amend: true }),
      idParams(added.id),
    );
    expect(warmup.status).toBe(200);
    expect((await achievedAt())?.getTime()).toBe(recent.set.completedAt.getTime());

    // Moving the achieving session moves the date the goal was achieved.
    const target = daysAgo(12);
    await patchSession(
      jsonReq('PATCH', { startedAt: target.toISOString(), durationMin: 60 }),
      idParams(recent.session.id),
    );
    expect((await achievedAt())?.getTime()).toBe(target.getTime() + 10 * MINUTE);

    // The weight was a typo: nothing meets the target anymore.
    const corrected = await patchSet(
      jsonReq('PATCH', { weight: 100, reps: 5, rir: 2, amend: true }),
      idParams(recent.set.id),
    );
    expect(corrected.status).toBe(200);
    expect(await achievedAt()).toBeNull();
  });
});

describe('editing the sets of a finished session', () => {
  it('changes the set type, and never renumbers: a removed set leaves its gap, an added one goes after', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const { session, set } = await seedFinishedSession(user.id, bench.id, daysAgo(3));
    actAs(user.id);
    const ids = [set.id];
    for (const setNumber of [2, 3]) {
      const res = await addSet(
        jsonReq('POST', strengthSet(bench.id, { setNumber, weight: 100 + setNumber, reps: 5 })),
        idParams(session.id),
      );
      ids.push(((await res.json()) as { id: string }).id);
    }

    const drop = await patchSet(
      jsonReq('PATCH', { weight: 80, reps: 8, rir: 0, isWarmup: false, isDropSet: true, amend: true }),
      idParams(ids[2]!),
    );
    expect(drop.status).toBe(200);
    expect(await db.set.findUniqueOrThrow({ where: { id: ids[2]! } })).toMatchObject({
      weight: 80,
      reps: 8,
      rir: 0,
      isWarmup: false,
      isDropSet: true,
    });

    const remove = await deleteSet(jsonReq('DELETE', {}), idParams(ids[1]!));
    expect(remove.status).toBe(200);
    const rows = await db.set.findMany({
      where: { sessionId: session.id },
      orderBy: { setNumber: 'asc' },
    });
    // The stored numbers are what a re-import matches on: they stay.
    expect(rows.map((r) => [r.id, r.setNumber])).toEqual([
      [ids[0], 1],
      [ids[2], 3],
    ]);

    // The server numbers an added set after the last one, whatever is sent.
    const again = await addSet(
      jsonReq('POST', strengthSet(bench.id, { setNumber: 2 })),
      idParams(session.id),
    );
    expect(((await again.json()) as { setNumber: number }).setNumber).toBe(4);
  });

  it('keeps the block asked for when the session already has sets in it', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    // No workout behind the session anymore, but its sets still carry blocks.
    const { session } = await seedFinishedSession(user.id, bench.id, daysAgo(3));
    await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: bench.id,
        setNumber: 1,
        weight: 60,
        reps: 10,
        block: 1,
        completedAt: new Date(session.startedAt.getTime() + 30 * MINUTE),
      },
    });
    actAs(user.id);

    const second = await addSet(
      jsonReq('POST', strengthSet(bench.id, { weight: 60, reps: 10, block: 1 })),
      idParams(session.id),
    );
    expect(second.status).toBe(201);
    expect(await second.json()).toMatchObject({ block: 1, setNumber: 2 });

    // A block no set of the session uses is not invented.
    const unknown = await addSet(
      jsonReq('POST', strengthSet(bench.id, { block: 2 })),
      idParams(session.id),
    );
    expect(await unknown.json()).toMatchObject({ block: null, setNumber: 2 });
  });

  it('keeps the recorded track of an imported activity when its values are corrected', async () => {
    const user = await seedUser();
    const running = await db.exercise.create({
      data: { userId: user.id, name: 'Running', muscleGroup: 'OTHER', category: 'CARDIO' },
    });
    const startedAt = daysAgo(4);
    const session = await db.session.create({
      data: { userId: user.id, startedAt, finishedAt: new Date(startedAt.getTime() + 30 * MINUTE) },
    });
    const track = [
      { t: 0, d: 0, hr: 120 },
      { t: 900, d: 2500, hr: 150 },
    ];
    const set = await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: running.id,
        setNumber: 1,
        weight: 0,
        reps: 1,
        durationSec: 1800,
        distanceM: 5000,
        track,
        completedAt: new Date(startedAt.getTime() + 30 * MINUTE),
      },
    });
    actAs(user.id);

    const res = await patchSet(
      jsonReq('PATCH', { durationSec: 1750, distanceM: 5100, amend: true }),
      idParams(set.id),
    );
    expect(res.status).toBe(200);
    const row = await db.set.findUniqueOrThrow({ where: { id: set.id } });
    expect(row).toMatchObject({ durationSec: 1750, distanceM: 5100 });
    expect(row.track).toEqual(track);
  });

  it('leaves the set numbers of a session in progress alone on delete', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const session = await db.session.create({ data: { userId: user.id } });
    const rows = [];
    for (const setNumber of [1, 2, 3]) {
      rows.push(
        await db.set.create({
          data: { sessionId: session.id, exerciseId: bench.id, setNumber, weight: 100, reps: 5 },
        }),
      );
    }
    actAs(user.id);
    const remove = await deleteSet(jsonReq('DELETE', {}), idParams(rows[1]!.id));
    expect(remove.status).toBe(200);
    const left = await db.set.findMany({
      where: { sessionId: session.id },
      orderBy: { setNumber: 'asc' },
    });
    expect(left.map((r) => r.setNumber)).toEqual([1, 3]);
  });

  it('edits the cardio fields of a cardio set, and only with the matching shape', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const running = await db.exercise.create({
      data: { userId: user.id, name: 'Running', muscleGroup: 'OTHER', category: 'CARDIO' },
    });
    const { session, set: strength } = await seedFinishedSession(user.id, bench.id, daysAgo(3));
    actAs(user.id);

    const addRes = await addSet(
      jsonReq('POST', {
        exerciseId: running.id,
        setNumber: 1,
        weight: 0,
        reps: 1,
        durationSec: 1500,
        distanceM: 5000,
        amend: true,
      }),
      idParams(session.id),
    );
    expect(addRes.status).toBe(201);
    const cardio = (await addRes.json()) as { id: string };

    const edit = await patchSet(
      jsonReq('PATCH', { durationSec: 1620, distanceM: 5200, avgHr: 150, maxHr: 171, amend: true }),
      idParams(cardio.id),
    );
    expect(edit.status).toBe(200);
    expect(await db.set.findUniqueOrThrow({ where: { id: cardio.id } })).toMatchObject({
      weight: 0,
      reps: 1,
      durationSec: 1620,
      distanceM: 5200,
      avgHr: 150,
      maxHr: 171,
    });

    // Strength values on the cardio set, cardio values on the strength set,
    // and out-of-range cardio values are all refused.
    const wrongShapes: [string, unknown][] = [
      [cardio.id, { weight: 50, reps: 5, rir: 1, amend: true }],
      [strength.id, { durationSec: 600, amend: true }],
      [cardio.id, { durationSec: 0, amend: true }],
      [cardio.id, { durationSec: 600, avgHr: 20, amend: true }],
    ];
    for (const [id, body] of wrongShapes) {
      const res = await patchSet(jsonReq('PATCH', body), idParams(id));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await db.set.findUniqueOrThrow({ where: { id: strength.id } })).toMatchObject({
      weight: 100,
      reps: 5,
      durationSec: null,
    });
  });
});

describe('timing edits send only what changed', () => {
  it('keeps the seconds of the start when only the duration changes, and moves no set', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const startedAt = new Date(daysAgo(5).getTime() + 27_450);
    const session = await db.session.create({
      data: { userId: user.id, startedAt, finishedAt: new Date(startedAt.getTime() + 47 * MINUTE) },
    });
    const set = await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: bench.id,
        setNumber: 1,
        weight: 100,
        reps: 5,
        completedAt: new Date(startedAt.getTime() + 10 * MINUTE),
      },
    });
    actAs(user.id);

    const res = await patchSession(jsonReq('PATCH', { durationMin: 60 }), idParams(session.id));
    expect(res.status).toBe(200);
    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.startedAt.getTime()).toBe(startedAt.getTime());
    expect(row.finishedAt!.getTime()).toBe(startedAt.getTime() + 60 * MINUTE);
    const setRow = await db.set.findUniqueOrThrow({ where: { id: set.id } });
    expect(setRow.completedAt.getTime()).toBe(set.completedAt.getTime());
  });

  it('re-dates a session longer than 24 hours and keeps its length', async () => {
    const user = await seedUser();
    const startedAt = daysAgo(20);
    const length = 3 * DAY + 12_345;
    const session = await db.session.create({
      data: { userId: user.id, startedAt, finishedAt: new Date(startedAt.getTime() + length) },
    });
    actAs(user.id);

    const target = daysAgo(40);
    const res = await patchSession(
      jsonReq('PATCH', { startedAt: target.toISOString() }),
      idParams(session.id),
    );
    expect(res.status).toBe(200);
    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.startedAt.getTime()).toBe(target.getTime());
    expect(row.finishedAt!.getTime()).toBe(target.getTime() + length);
  });

  it('refuses an empty edit and a date before 2000, but still edits an older imported session', async () => {
    const user = await seedUser();
    const old = new Date('1998-05-04T10:00:00.000Z');
    const session = await db.session.create({
      data: { userId: user.id, startedAt: old, finishedAt: new Date(old.getTime() + 30 * MINUTE) },
    });
    actAs(user.id);

    expect((await patchSession(jsonReq('PATCH', {}), idParams(session.id))).status).toBe(400);
    const before2000 = await patchSession(
      jsonReq('PATCH', { startedAt: '1999-06-01T10:00:00.000Z' }),
      idParams(session.id),
    );
    expect(before2000.status).toBe(400);

    const duration = await patchSession(jsonReq('PATCH', { durationMin: 45 }), idParams(session.id));
    expect(duration.status).toBe(200);
    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.startedAt.getTime()).toBe(old.getTime());
    expect(row.finishedAt!.getTime()).toBe(old.getTime() + 45 * MINUTE);
  });

  it('moves several hundred sets in one statement, to the millisecond', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const startedAt = new Date(daysAgo(6).getTime() + 123);
    const session = await db.session.create({
      data: { userId: user.id, startedAt, finishedAt: new Date(startedAt.getTime() + 90 * MINUTE) },
    });
    await db.set.createMany({
      data: Array.from({ length: 400 }, (_, index) => ({
        sessionId: session.id,
        exerciseId: bench.id,
        setNumber: index + 1,
        weight: 100,
        reps: 5,
        completedAt: new Date(startedAt.getTime() + index * 13_007),
      })),
    });
    actAs(user.id);

    const target = daysAgo(70);
    const res = await patchSession(
      jsonReq('PATCH', { startedAt: target.toISOString() }),
      idParams(session.id),
    );
    expect(res.status).toBe(200);
    const rows = await db.set.findMany({
      where: { sessionId: session.id },
      orderBy: { setNumber: 'asc' },
      select: { completedAt: true },
    });
    expect(rows.map((row) => row.completedAt.getTime() - target.getTime())).toEqual(
      Array.from({ length: 400 }, (_, index) => index * 13_007),
    );
  });
});

describe('a move does not judge a goal again', () => {
  it('moves the date with the set that stamped it, whatever the bodyweight is today', async () => {
    const user = await db.user.create({
      data: { email: 'owner@test.dev', passwordHash: 'x', bodyweight: 80 },
    });
    const pullup = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Pull-up',
        muscleGroup: 'BACK_WIDTH',
        category: 'COMPOUND',
        usesBodyweight: true,
      },
    });
    // 80 kg of bodyweight + 20 kg met the 100 kg target that day.
    const { session, set } = await seedFinishedSession(user.id, pullup.id, daysAgo(3), {
      weight: 20,
      reps: 5,
    });
    const goal = await db.exerciseGoal.create({
      data: {
        userId: user.id,
        exerciseId: pullup.id,
        targetWeight: 100,
        targetReps: 5,
        achievedAt: set.completedAt,
      },
    });
    // The lifter is lighter today: judged again, the set would no longer count.
    await db.user.update({ where: { id: user.id }, data: { bodyweight: 70 } });
    actAs(user.id);

    const target = daysAgo(9);
    const res = await patchSession(
      jsonReq('PATCH', { startedAt: target.toISOString() }),
      idParams(session.id),
    );
    expect(res.status).toBe(200);
    const row = await db.exerciseGoal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(row.achievedAt?.getTime()).toBe(target.getTime() + 10 * MINUTE);
  });

  it('never stamps an unachieved goal, and leaves a date stamped by another session alone', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const squat = await db.exercise.create({
      data: { userId: user.id, name: 'Squat', muscleGroup: 'QUADS', category: 'COMPOUND' },
    });
    const startedAt = daysAgo(3);
    const { session, set: benchSet } = await seedFinishedSession(user.id, bench.id, startedAt, {
      weight: 120,
      reps: 5,
    });
    await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: squat.id,
        setNumber: 1,
        weight: 90,
        reps: 5,
        completedAt: new Date(startedAt.getTime() + 20 * MINUTE),
      },
    });
    // Bench: the set meets the target but the goal was never stamped.
    const unachieved = await db.exerciseGoal.create({
      data: { userId: user.id, exerciseId: bench.id, targetWeight: 110, targetReps: 5 },
    });
    // Squat: achieved a month ago by another session; this one does not qualify.
    const elsewhere = daysAgo(30);
    const stamped = await db.exerciseGoal.create({
      data: {
        userId: user.id,
        exerciseId: squat.id,
        targetWeight: 100,
        targetReps: 5,
        achievedAt: elsewhere,
      },
    });
    actAs(user.id);

    const res = await patchSession(
      jsonReq('PATCH', { startedAt: daysAgo(50).toISOString() }),
      idParams(session.id),
    );
    expect(res.status).toBe(200);
    expect(benchSet.weight).toBe(120);
    expect(
      (await db.exerciseGoal.findUniqueOrThrow({ where: { id: unachieved.id } })).achievedAt,
    ).toBeNull();
    expect(
      (await db.exerciseGoal.findUniqueOrThrow({ where: { id: stamped.id } })).achievedAt?.getTime(),
    ).toBe(elsewhere.getTime());
  });

  it('brings the date earlier when a qualifying set lands before it', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const stamping = await seedFinishedSession(user.id, bench.id, daysAgo(10), {
      weight: 110,
      reps: 5,
    });
    const later = await seedFinishedSession(user.id, bench.id, daysAgo(2), { weight: 115, reps: 5 });
    const goal = await db.exerciseGoal.create({
      data: {
        userId: user.id,
        exerciseId: bench.id,
        targetWeight: 110,
        targetReps: 5,
        achievedAt: stamping.set.completedAt,
      },
    });
    actAs(user.id);

    // The "later" session actually happened three weeks ago.
    const target = daysAgo(21);
    await patchSession(
      jsonReq('PATCH', { startedAt: target.toISOString() }),
      idParams(later.session.id),
    );
    const row = await db.exerciseGoal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(row.achievedAt?.getTime()).toBe(target.getTime() + 10 * MINUTE);
  });
});

describe('PUT /api/sessions/[id] on a finished session', () => {
  it('finish is a no-op success, so a stale tab cannot undo an edited duration', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const startedAt = daysAgo(3);
    const { session } = await seedFinishedSession(user.id, bench.id, startedAt);
    actAs(user.id);
    await patchSession(jsonReq('PATCH', { durationMin: 90 }), idParams(session.id));

    const res = await putSession(jsonReq('PUT', { finish: true }), idParams(session.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { finishedAt: string };
    expect(new Date(body.finishedAt).getTime()).toBe(startedAt.getTime() + 90 * MINUTE);

    const notes = await putSession(jsonReq('PUT', { notes: 'felt good' }), idParams(session.id));
    expect(notes.status).toBe(200);
    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.notes).toBe('felt good');
    expect(row.finishedAt!.getTime()).toBe(startedAt.getTime() + 90 * MINUTE);
  });

  it('still finishes a session in progress', async () => {
    const user = await seedUser();
    const session = await db.session.create({ data: { userId: user.id } });
    actAs(user.id);
    const res = await putSession(jsonReq('PUT', { finish: true }), idParams(session.id));
    expect(res.status).toBe(200);
    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.finishedAt).not.toBeNull();
  });
});

describe('concurrent edits of a finished session', () => {
  it('dates a set added during a move inside the window the session ends up in', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const { session } = await seedFinishedSession(user.id, bench.id, daysAgo(3));
    actAs(user.id);

    for (let round = 0; round < 6; round += 1) {
      const target = daysAgo(20 + round * 10);
      const move = () =>
        patchSession(jsonReq('PATCH', { startedAt: target.toISOString() }), idParams(session.id));
      const add = () =>
        addSet(jsonReq('POST', strengthSet(bench.id, { weight: 50 + round })), idParams(session.id));
      const [moved, added] =
        round % 2 === 0 ? await Promise.all([move(), add()]) : (await Promise.all([add(), move()])).reverse();
      expect(moved!.status).toBe(200);
      expect(added!.status).toBe(201);

      const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
      expect(row.startedAt.getTime()).toBe(target.getTime());
      const sets = await db.set.findMany({ where: { sessionId: session.id } });
      expect(sets).toHaveLength(round + 2);
      for (const set of sets) {
        expect(set.completedAt.getTime()).toBeGreaterThanOrEqual(row.startedAt.getTime());
        expect(set.completedAt.getTime()).toBeLessThanOrEqual(row.finishedAt!.getTime());
      }
    }
  });

  it('lets a move, set edits and a set delete of the same session run together', async () => {
    const user = await seedUser();
    const bench = await seedBench(user.id);
    const startedAt = daysAgo(3);
    const { session, set } = await seedFinishedSession(user.id, bench.id, startedAt);
    await db.exerciseGoal.create({
      data: { userId: user.id, exerciseId: bench.id, targetWeight: 100, targetReps: 5 },
    });
    const others = [];
    for (const setNumber of [2, 3, 4]) {
      others.push(
        await db.set.create({
          data: {
            sessionId: session.id,
            exerciseId: bench.id,
            setNumber,
            weight: 100,
            reps: 5,
            completedAt: new Date(startedAt.getTime() + (10 + setNumber) * MINUTE),
          },
        }),
      );
    }
    actAs(user.id);

    const responses = await Promise.all([
      patchSession(jsonReq('PATCH', { startedAt: daysAgo(15).toISOString() }), idParams(session.id)),
      patchSet(jsonReq('PATCH', { weight: 105, reps: 5, rir: 1, amend: true }), idParams(set.id)),
      patchSet(
        jsonReq('PATCH', { weight: 95, reps: 6, rir: 2, isWarmup: true, amend: true }),
        idParams(others[0]!.id),
      ),
      deleteSet(jsonReq('DELETE', {}), idParams(others[1]!.id)),
      patchSession(jsonReq('PATCH', { durationMin: 75 }), idParams(session.id)),
    ]);
    expect(responses.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(3);
  });

  it('gets the retryable error of a raw query in the shape the retry loop looks for', async () => {
    const user = await seedUser();
    let releaseSecond: () => void = () => undefined;
    const firstCommitted = new Promise<void>((resolve) => (releaseSecond = resolve));
    let snapshotTaken: () => void = () => undefined;
    const secondStarted = new Promise<void>((resolve) => (snapshotTaken = resolve));

    const second = db
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id}`;
          snapshotTaken();
          await firstCommitted;
          // The row changed after this transaction's snapshot: SQLSTATE 40001.
          await tx.$executeRaw`UPDATE "User" SET "passwordHash" = 'second' WHERE id = ${user.id}`;
        },
        { isolationLevel: 'Serializable' },
      )
      .then(
        () => null,
        (err: unknown) => err,
      );
    await secondStarted;
    await db.user.update({ where: { id: user.id }, data: { passwordHash: 'first' } });
    releaseSecond();

    const err = await second;
    expect(err).not.toBeNull();
    expect((err as { code?: string }).code).toBe('P2010');
    expect(isTransactionWriteConflict(err)).toBe(true);
  });
});

describe('POST /api/sessions/past rate limit', () => {
  it('allows 30 workouts a minute per user, then answers 429', async () => {
    const user = await seedUser();
    const other = await seedUser('other@test.dev');
    actAs(user.id);
    const body = { startedAt: daysAgo(2).toISOString(), durationMin: 30 };
    for (let index = 0; index < 30; index += 1) {
      expect((await logPastSession(jsonReq('POST', body))).status).toBe(201);
    }
    expect((await logPastSession(jsonReq('POST', body))).status).toBe(429);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(30);

    // The budget is per user.
    actAs(other.id);
    expect((await logPastSession(jsonReq('POST', body))).status).toBe(201);
  });
});
