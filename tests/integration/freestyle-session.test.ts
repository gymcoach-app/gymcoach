import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { buildCurrentSessionContext } from '@/lib/coach';
import { getLastPerformances } from '@/lib/last-performance';

// Freestyle sessions (issue #388): a session started without a workout. Pinned
// here: the start route creates and resumes one, the session's own exercise
// list is edited through its routes (owner only, open freestyle sessions
// only, one row per exercise), nothing in a saved program changes, and the
// readers that used to assume a workout (history CSV, last performance, coach
// snapshot, backup) carry the session.

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as startSession } from '@/app/api/sessions/route';
import { GET as getSession, PUT as putSession } from '@/app/api/sessions/[id]/route';
import { POST as addSet } from '@/app/api/sessions/[id]/sets/route';
import { POST as addSessionExercise } from '@/app/api/sessions/[id]/exercises/route';
import {
  PUT as putSessionExercise,
  DELETE as deleteSessionExercise,
} from '@/app/api/sessions/[id]/exercises/[rowId]/route';
import { DELETE as deleteExercise } from '@/app/api/exercises/[id]/route';
import { GET as getHistoryCsv } from '@/app/api/history/csv/route';
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

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function rowParams(id: string, rowId: string) {
  return { params: Promise.resolve({ id, rowId }) };
}

const targets = {
  targetSets: 4,
  targetRepsMin: 8,
  targetRepsMax: 12,
  targetRIR: 2,
  restSec: 120,
};

async function seedUser(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'x' } });
  const bench = await db.exercise.create({
    data: { userId: user.id, name: 'Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  const curl = await db.exercise.create({
    data: { userId: user.id, name: 'Curl', muscleGroup: 'BICEPS', category: 'ISOLATION' },
  });
  return { user, bench, curl };
}

async function startFreestyle(userId: string) {
  actAs(userId);
  const res = await startSession(jsonReq('POST', {}));
  return { res, session: (await res.json()) as { id: string; workoutId: string | null } };
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('POST /api/sessions without a workout (issue #388)', () => {
  it('creates a session with no workout and no program, then resumes it', async () => {
    const { user } = await seedUser('free-start@test.dev');

    const first = await startFreestyle(user.id);
    expect(first.res.status).toBe(201);
    const stored = await db.session.findUniqueOrThrow({ where: { id: first.session.id } });
    expect(stored).toMatchObject({ userId: user.id, workoutId: null, programId: null });
    expect(stored.finishedAt).toBeNull();

    // A second start (double tap, reload) returns the same open session.
    const second = await startFreestyle(user.id);
    expect(second.res.status).toBe(200);
    expect(second.session.id).toBe(first.session.id);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it('accepts an explicit null workoutId and freezes the chosen gym', async () => {
    const { user } = await seedUser('free-gym@test.dev');
    const gym = await db.gym.create({ data: { userId: user.id, name: 'Hotel gym' } });
    actAs(user.id);

    const res = await startSession(jsonReq('POST', { workoutId: null, gymId: gym.id }));
    expect(res.status).toBe(201);
    expect((await res.json()).gymId).toBe(gym.id);
  });

  it('starts a new freestyle session once the previous one is finished', async () => {
    const { user } = await seedUser('free-again@test.dev');
    const first = await startFreestyle(user.id);
    await putSession(jsonReq('PUT', { finish: true }), idParams(first.session.id));

    const second = await startFreestyle(user.id);
    expect(second.res.status).toBe(201);
    expect(second.session.id).not.toBe(first.session.id);
  });

  it('does not resume an open session that runs a workout, nor the other way round', async () => {
    const { user, bench } = await seedUser('free-mixed@test.dev');
    const program = await db.program.create({
      data: { userId: user.id, name: 'P', phase: 'Base', isActive: true },
    });
    const workout = await db.workout.create({
      data: { programId: program.id, name: 'Push', order: 1 },
    });
    await db.programExercise.create({
      data: { workoutId: workout.id, exerciseId: bench.id, order: 1, ...targets },
    });
    actAs(user.id);
    const planned = await (await startSession(jsonReq('POST', { workoutId: workout.id }))).json();

    const free = await startFreestyle(user.id);
    expect(free.res.status).toBe(201);
    expect(free.session.id).not.toBe(planned.id);

    // The workout start still finds its own session, not the freestyle one.
    const again = await startSession(jsonReq('POST', { workoutId: workout.id }));
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(planned.id);
  });

  it("still refuses another user's workout", async () => {
    const owner = await seedUser('free-owner@test.dev');
    const stranger = await seedUser('free-stranger@test.dev');
    const program = await db.program.create({
      data: { userId: owner.user.id, name: 'P', phase: 'Base' },
    });
    const workout = await db.workout.create({
      data: { programId: program.id, name: 'Push', order: 1 },
    });
    actAs(stranger.user.id);
    const res = await startSession(jsonReq('POST', { workoutId: workout.id }));
    expect(res.status).toBe(404);
    expect(await db.session.count()).toBe(0);
  });
});

describe('freestyle exercise list routes (issue #388)', () => {
  it('adds exercises in order and returns them with the session', async () => {
    const { user, bench, curl } = await seedUser('free-list@test.dev');
    const { session } = await startFreestyle(user.id);

    const a = await addSessionExercise(
      jsonReq('POST', { exerciseId: bench.id, ...targets }),
      idParams(session.id),
    );
    expect(a.status).toBe(201);
    const b = await addSessionExercise(
      jsonReq('POST', { exerciseId: curl.id, ...targets, targetSets: 3 }),
      idParams(session.id),
    );
    expect(b.status).toBe(201);

    const loaded = await (await getSession(new Request('http://test.local'), idParams(session.id))).json();
    expect(loaded.workout).toBeNull();
    expect(
      loaded.exercises.map((row: { exercise: { name: string }; order: number; targetSets: number }) => [
        row.exercise.name,
        row.order,
        row.targetSets,
      ]),
    ).toEqual([
      ['Bench', 1, 4],
      ['Curl', 2, 3],
    ]);
    // No program was created or touched on the way.
    expect(await db.program.count()).toBe(0);
    expect(await db.programExercise.count()).toBe(0);
  });

  it('refuses the same exercise twice with 409', async () => {
    const { user, bench } = await seedUser('free-dup@test.dev');
    const { session } = await startFreestyle(user.id);
    await addSessionExercise(jsonReq('POST', { exerciseId: bench.id, ...targets }), idParams(session.id));

    const res = await addSessionExercise(
      jsonReq('POST', { exerciseId: bench.id, ...targets }),
      idParams(session.id),
    );
    expect(res.status).toBe(409);
    expect(await db.sessionExercise.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it('validates the targets and the exercise owner', async () => {
    const { user, bench } = await seedUser('free-valid@test.dev');
    const other = await seedUser('free-valid-other@test.dev');
    const { session } = await startFreestyle(user.id);

    for (const bad of [
      { exerciseId: bench.id, ...targets, targetSets: 0 },
      { exerciseId: bench.id, ...targets, targetRIR: 6 },
      { exerciseId: bench.id, ...targets, restSec: 5 },
      { exerciseId: bench.id, ...targets, targetRepsMin: 12, targetRepsMax: 8 },
      { ...targets },
      // Another account's exercise.
      { exerciseId: other.bench.id, ...targets },
    ]) {
      actAs(user.id);
      const res = await addSessionExercise(jsonReq('POST', bad), idParams(session.id));
      expect(res.status).toBe(400);
    }
    expect(await db.sessionExercise.count()).toBe(0);
  });

  it('replaces the exercise of a row in place and refuses a duplicate', async () => {
    const { user, bench, curl } = await seedUser('free-replace@test.dev');
    const press = await db.exercise.create({
      data: { userId: user.id, name: 'Press', muscleGroup: 'TRICEPS', category: 'COMPOUND' },
    });
    const { session } = await startFreestyle(user.id);
    const row = await (
      await addSessionExercise(jsonReq('POST', { exerciseId: bench.id, ...targets }), idParams(session.id))
    ).json();
    await addSessionExercise(jsonReq('POST', { exerciseId: curl.id, ...targets }), idParams(session.id));

    const swapped = await putSessionExercise(
      jsonReq('PUT', { exerciseId: press.id, ...targets, targetSets: 5 }),
      rowParams(session.id, row.id),
    );
    expect(swapped.status).toBe(200);
    const stored = await db.sessionExercise.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored).toMatchObject({ exerciseId: press.id, order: 1, targetSets: 5 });

    // Curl is already on the list.
    const dup = await putSessionExercise(
      jsonReq('PUT', { exerciseId: curl.id, ...targets }),
      rowParams(session.id, row.id),
    );
    expect(dup.status).toBe(409);
    expect((await db.sessionExercise.findUniqueOrThrow({ where: { id: row.id } })).exerciseId).toBe(
      press.id,
    );
  });

  it('removes a row and keeps the sets already logged', async () => {
    const { user, bench } = await seedUser('free-remove@test.dev');
    const { session } = await startFreestyle(user.id);
    const row = await (
      await addSessionExercise(jsonReq('POST', { exerciseId: bench.id, ...targets }), idParams(session.id))
    ).json();
    const set = await addSet(
      jsonReq('POST', { exerciseId: bench.id, setNumber: 1, weight: 60, reps: 10, rir: 2 }),
      idParams(session.id),
    );
    expect(set.status).toBe(201);

    const res = await deleteSessionExercise(new Request('http://test.local'), rowParams(session.id, row.id));
    expect(res.status).toBe(200);
    expect(await db.sessionExercise.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(1);

    const gone = await deleteSessionExercise(new Request('http://test.local'), rowParams(session.id, row.id));
    expect(gone.status).toBe(404);
  });

  it("answers 404 on another user's session and leaves it untouched", async () => {
    const owner = await seedUser('free-own@test.dev');
    const stranger = await seedUser('free-other@test.dev');
    const { session } = await startFreestyle(owner.user.id);
    const row = await (
      await addSessionExercise(
        jsonReq('POST', { exerciseId: owner.bench.id, ...targets }),
        idParams(session.id),
      )
    ).json();

    actAs(stranger.user.id);
    const add = await addSessionExercise(
      jsonReq('POST', { exerciseId: stranger.bench.id, ...targets }),
      idParams(session.id),
    );
    expect(add.status).toBe(404);
    const put = await putSessionExercise(
      jsonReq('PUT', { exerciseId: stranger.curl.id, ...targets }),
      rowParams(session.id, row.id),
    );
    expect(put.status).toBe(404);
    const del = await deleteSessionExercise(new Request('http://test.local'), rowParams(session.id, row.id));
    expect(del.status).toBe(404);

    // The stranger cannot move the owner's row into a session of their own.
    const mine = await startFreestyle(stranger.user.id);
    const cross = await putSessionExercise(
      jsonReq('PUT', { exerciseId: stranger.curl.id, ...targets }),
      rowParams(mine.session.id, row.id),
    );
    expect(cross.status).toBe(404);
    const crossDel = await deleteSessionExercise(
      new Request('http://test.local'),
      rowParams(mine.session.id, row.id),
    );
    expect(crossDel.status).toBe(404);

    const rows = await db.sessionExercise.findMany({ where: { sessionId: session.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: row.id, exerciseId: owner.bench.id });
  });

  it('refuses a finished session and a session that runs a workout', async () => {
    const { user, bench, curl } = await seedUser('free-closed@test.dev');
    const { session } = await startFreestyle(user.id);
    const row = await (
      await addSessionExercise(jsonReq('POST', { exerciseId: bench.id, ...targets }), idParams(session.id))
    ).json();
    await putSession(jsonReq('PUT', { finish: true }), idParams(session.id));

    const add = await addSessionExercise(
      jsonReq('POST', { exerciseId: curl.id, ...targets }),
      idParams(session.id),
    );
    expect(add.status).toBe(400);
    const del = await deleteSessionExercise(new Request('http://test.local'), rowParams(session.id, row.id));
    expect(del.status).toBe(400);
    expect(await db.sessionExercise.count({ where: { sessionId: session.id } })).toBe(1);

    const program = await db.program.create({
      data: { userId: user.id, name: 'P', phase: 'Base' },
    });
    const workout = await db.workout.create({
      data: { programId: program.id, name: 'Push', order: 1 },
    });
    const planned = await db.session.create({
      data: { userId: user.id, workoutId: workout.id, programId: program.id },
    });
    const onWorkout = await addSessionExercise(
      jsonReq('POST', { exerciseId: curl.id, ...targets }),
      idParams(planned.id),
    );
    expect(onWorkout.status).toBe(409);
    expect(await db.sessionExercise.count({ where: { sessionId: planned.id } })).toBe(0);
  });

  it('lets an exercise be deleted when only a freestyle list row still names it', async () => {
    const { user, bench, curl } = await seedUser('free-exdel@test.dev');
    const { session } = await startFreestyle(user.id);
    await addSessionExercise(jsonReq('POST', { exerciseId: bench.id, ...targets }), idParams(session.id));
    await addSessionExercise(jsonReq('POST', { exerciseId: curl.id, ...targets }), idParams(session.id));
    await addSet(
      jsonReq('POST', { exerciseId: curl.id, setNumber: 1, weight: 20, reps: 12, rir: 1 }),
      idParams(session.id),
    );

    // Bench has no set: the list row goes with the exercise.
    const ok = await deleteExercise(new Request('http://test.local'), idParams(bench.id));
    expect(ok.status).toBe(200);
    expect(await db.exercise.count({ where: { id: bench.id } })).toBe(0);

    // Curl has history, so the existing refusal still applies.
    const refused = await deleteExercise(new Request('http://test.local'), idParams(curl.id));
    expect(refused.status).toBe(409);
    const left = await db.sessionExercise.findMany({ where: { sessionId: session.id } });
    expect(left.map((row) => row.exerciseId)).toEqual([curl.id]);
  });
});

describe('readers of a freestyle session (issue #388)', () => {
  async function loggedFreestyle(email: string) {
    const seeded = await seedUser(email);
    const { session } = await startFreestyle(seeded.user.id);
    await addSessionExercise(
      jsonReq('POST', { exerciseId: seeded.bench.id, ...targets }),
      idParams(session.id),
    );
    await addSessionExercise(
      jsonReq('POST', { exerciseId: seeded.curl.id, ...targets, targetSets: 3 }),
      idParams(session.id),
    );
    await addSet(
      jsonReq('POST', { exerciseId: seeded.bench.id, setNumber: 1, weight: 80, reps: 8, rir: 2 }),
      idParams(session.id),
    );
    return { ...seeded, session };
  }

  it('gives the coach snapshot the list as the plan, with no workout name', async () => {
    const { user, session } = await loggedFreestyle('free-coach@test.dev');
    const context = await buildCurrentSessionContext(user.id, session.id);
    expect(context?.workoutName).toBeNull();
    expect(context?.exercises).toEqual([
      expect.objectContaining({
        exerciseName: 'Bench',
        target: expect.objectContaining({ targetSets: 4, targetRIR: 2 }),
        setsLogged: [expect.objectContaining({ weight: 80, reps: 8 })],
      }),
      // On the list, nothing logged yet: still shown, with its targets.
      expect.objectContaining({
        exerciseName: 'Curl',
        target: expect.objectContaining({ targetSets: 3 }),
        setsLogged: [],
      }),
    ]);
  });

  it('counts in last performance and in the history CSV once finished', async () => {
    const { user, bench, session } = await loggedFreestyle('free-history@test.dev');
    await putSession(jsonReq('PUT', { finish: true }), idParams(session.id));

    const last = await getLastPerformances(user.id, [bench.id], 'another-session');
    expect(last.get(bench.id)).toMatchObject({ maxWeight: 80, repsAtMaxWeight: 8 });

    actAs(user.id);
    const csv = await (await getHistoryCsv(new Request('http://test.local/api/history/csv'))).text();
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Bench');
    expect(lines[1]).toContain('80');
  });

  it('round-trips through a backup, list included, into another account', async () => {
    const { user, session } = await loggedFreestyle('free-backup@test.dev');
    actAs(user.id);
    const dump = await (await getBackup()).json();
    expect(dump.version).toBe(10);
    expect(dump.sessions).toHaveLength(1);
    expect(dump.sessions[0]).toMatchObject({ programName: null, workoutName: null });
    expect(dump.sessions[0].exercises).toEqual([
      { exerciseName: 'Bench', order: 1, ...targets },
      { exerciseName: 'Curl', order: 2, ...targets, targetSets: 3 },
    ]);

    const target = await db.user.create({ data: { email: 'free-restore@test.dev', passwordHash: 'x' } });
    actAs(target.id);
    const res = await postBackup(jsonReq('POST', { payload: dump, confirmReplace: true }));
    expect(res.status).toBe(200);

    const restored = await db.session.findFirstOrThrow({
      where: { userId: target.id },
      include: {
        exercises: { orderBy: { order: 'asc' }, include: { exercise: true } },
        sets: { include: { exercise: true } },
      },
    });
    expect(restored).toMatchObject({ workoutId: null, programId: null, finishedAt: null });
    expect(restored.exercises.map((row) => [row.exercise.name, row.targetSets])).toEqual([
      ['Bench', 4],
      ['Curl', 3],
    ]);
    // Re-linked to the restoring account's own exercises.
    expect(restored.exercises.every((row) => row.exercise.userId === target.id)).toBe(true);
    expect(restored.sets.map((set) => [set.exercise.name, set.weight, set.reps])).toEqual([
      ['Bench', 80, 8],
    ]);
    // The source account is untouched.
    expect(await db.sessionExercise.count({ where: { sessionId: session.id } })).toBe(2);
  });

  it('restores a backup written before the list existed', async () => {
    const { user } = await loggedFreestyle('free-v9@test.dev');
    actAs(user.id);
    const dump = await (await getBackup()).json();
    const v9 = {
      ...dump,
      version: 9,
      sessions: dump.sessions.map(({ exercises: _exercises, ...rest }: { exercises: unknown }) => rest),
    };

    const res = await postBackup(jsonReq('POST', { payload: v9, confirmReplace: true }));
    expect(res.status).toBe(200);
    const restored = await db.session.findFirstOrThrow({
      where: { userId: user.id },
      include: { exercises: true, sets: true },
    });
    expect(restored.exercises).toEqual([]);
    expect(restored.sets).toHaveLength(1);
  });

  it('rejects an out-of-bounds list row without touching existing data', async () => {
    const { user, session } = await loggedFreestyle('free-badrow@test.dev');
    actAs(user.id);
    const dump = await (await getBackup()).json();
    dump.sessions[0].exercises[0].targetSets = 99;

    const res = await postBackup(jsonReq('POST', { payload: dump, confirmReplace: true }));
    expect(res.status).toBe(400);
    expect(await db.sessionExercise.count({ where: { sessionId: session.id } })).toBe(2);
    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(1);
  });
});
