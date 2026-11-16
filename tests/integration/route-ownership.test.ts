import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

// Auth is read through getCurrentUserId (via requireApiUserId in @/lib/api).
// Mock it so we can act as either user without real cookies/JWTs.
vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { PATCH as patchSet, DELETE as deleteSet } from '@/app/api/sets/[id]/route';
import {
  GET as getSession,
  PUT as putSession,
  DELETE as deleteSession,
} from '@/app/api/sessions/[id]/route';
import {
  GET as getExercise,
  PUT as putExercise,
  PATCH as patchExercise,
  DELETE as deleteExercise,
} from '@/app/api/exercises/[id]/route';
import {
  GET as getProgram,
  PUT as putProgram,
  DELETE as deleteProgram,
} from '@/app/api/programs/[id]/route';
import { PUT as putWorkout, DELETE as deleteWorkout } from '@/app/api/workouts/[id]/route';
import {
  PUT as putProgramExercise,
  DELETE as deleteProgramExercise,
} from '@/app/api/program-exercises/[id]/route';
import { GET as getChat, DELETE as deleteChat } from '@/app/api/coach/chat/[id]/route';
import { POST as activateProgram } from '@/app/api/programs/[id]/activate/route';
import { POST as addWorkout } from '@/app/api/programs/[id]/workouts/route';
import { POST as addProgramExercise } from '@/app/api/workouts/[id]/program-exercises/route';
import { PUT as putWorkoutOrder } from '@/app/api/workouts/[id]/order/route';
import { POST as addSet } from '@/app/api/sessions/[id]/sets/route';
import { POST as activateGym } from '@/app/api/gyms/[id]/activate/route';
import { POST as startSession } from '@/app/api/sessions/route';
import { POST as parseSet } from '@/app/api/sets/parse/route';
import { POST as postChat } from '@/app/api/coach/chat/route';
import { POST as createGym } from '@/app/api/gyms/route';
import { DELETE as deleteMcpToken } from '@/app/api/mcp-tokens/[id]/route';
import { PUT as putGym, DELETE as deleteGym } from '@/app/api/gyms/[id]/route';
import { POST as postCoachApply } from '@/app/api/coach/[id]/apply/route';
import { GET as getHistoryCsv } from '@/app/api/history/csv/route';

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

// Seed two users; user A owns one of everything an [id] route can address.
async function seed() {
  const [a, b] = await Promise.all([
    db.user.create({ data: { email: 'owner@test.dev', passwordHash: 'x' } }),
    db.user.create({ data: { email: 'stranger@test.dev', passwordHash: 'x' } }),
  ]);
  const exercise = await db.exercise.create({
    data: { userId: a.id, name: 'Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  const exerciseB = await db.exercise.create({
    data: { userId: b.id, name: 'Row', muscleGroup: 'BACK_WIDTH', category: 'COMPOUND' },
  });
  const session = await db.session.create({ data: { userId: a.id, notes: 'original' } });
  const set = await db.set.create({
    data: { sessionId: session.id, exerciseId: exercise.id, setNumber: 1, weight: 60, reps: 10 },
  });
  const program = await db.program.create({
    data: { userId: a.id, name: 'Block 1', phase: 'hypertrophy' },
  });
  const workout = await db.workout.create({
    data: { programId: program.id, name: 'Push A', order: 0 },
  });
  const programExercise = await db.programExercise.create({
    data: {
      workoutId: workout.id,
      exerciseId: exercise.id,
      order: 0,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      restSec: 120,
    },
  });
  const conversation = await db.conversation.create({ data: { userId: a.id } });
  await db.message.create({
    data: { conversationId: conversation.id, role: 'USER', content: 'private words' },
  });
  const mcpToken = await db.mcpAccessToken.create({
    data: {
      userId: a.id,
      name: 'cli',
      tokenHash: 'ownership-test-hash',
      tokenPrefix: 'gmc_test.....',
    },
  });
  const gym = await db.gym.create({ data: { userId: a.id, name: 'Home gym' } });
  const coachSession = await db.coachSession.create({
    data: {
      userId: a.id,
      weekStart: new Date('2026-08-17'),
      weekEnd: new Date('2026-08-23'),
      prompt: 'p',
      response: 'r',
    },
  });
  return {
    a,
    b,
    exercise,
    exerciseB,
    session,
    set,
    program,
    workout,
    programExercise,
    conversation,
    mcpToken,
    gym,
    coachSession,
  };
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('route ownership: PATCH /api/sets/[id]', () => {
  it('lets the owner correct strength values', async () => {
    const { a, set } = await seed();
    actAs(a.id);
    const res = await patchSet(jsonReq('PATCH', { weight: 62.5, reps: 9, rir: 1 }), idParams(set.id));
    expect(res.status).toBe(200);
    const row = await db.set.findUnique({ where: { id: set.id } });
    expect(row).toMatchObject({ weight: 62.5, reps: 9, rir: 1 });
  });

  it('returns 404 and keeps values when a stranger tries to patch it', async () => {
    const { b, set } = await seed();
    actAs(b.id);
    const res = await patchSet(jsonReq('PATCH', { weight: 200, reps: 1, rir: 0 }), idParams(set.id));
    expect(res.status).toBe(404);
    const row = await db.set.findUnique({ where: { id: set.id } });
    expect(row).toMatchObject({ weight: 60, reps: 10 });
  });
});

describe('route ownership: DELETE /api/sets/[id]', () => {
  it('lets the owner delete their set', async () => {
    const { a, set } = await seed();
    actAs(a.id);
    const res = await deleteSet(new Request('http://t/api', { method: 'DELETE' }), idParams(set.id));
    expect(res.status).toBe(200);
    expect(await db.set.findUnique({ where: { id: set.id } })).toBeNull();
  });

  it("returns 404 and keeps the set when a stranger tries to delete it", async () => {
    const { b, set } = await seed();
    actAs(b.id);
    const res = await deleteSet(new Request('http://t/api', { method: 'DELETE' }), idParams(set.id));
    expect(res.status).toBe(404);
    // The set must still exist - no cross-user deletion.
    expect(await db.set.findUnique({ where: { id: set.id } })).not.toBeNull();
  });
});

describe('route ownership: /api/sessions/[id]', () => {
  it('lets the owner read and update their session', async () => {
    const { a, session } = await seed();
    actAs(a.id);
    const get = await getSession(new Request('http://t/api'), idParams(session.id));
    expect(get.status).toBe(200);
    const put = await putSession(jsonReq('PUT', { notes: 'mine' }), idParams(session.id));
    expect(put.status).toBe(200);
    expect((await db.session.findUnique({ where: { id: session.id } }))?.notes).toBe('mine');
  });

  it('returns 404 to a stranger on GET, PUT and DELETE and leaves the session intact', async () => {
    const { b, session } = await seed();
    actAs(b.id);
    expect((await getSession(new Request('http://t/api'), idParams(session.id))).status).toBe(404);
    expect(
      (await putSession(jsonReq('PUT', { notes: 'hacked' }), idParams(session.id))).status,
    ).toBe(404);
    expect(
      (await deleteSession(new Request('http://t/api', { method: 'DELETE' }), idParams(session.id)))
        .status,
    ).toBe(404);
    const row = await db.session.findUnique({ where: { id: session.id } });
    expect(row?.notes).toBe('original');
  });
});

describe('route ownership: /api/exercises/[id]', () => {
  it('lets the owner read their exercise', async () => {
    const { a, exercise } = await seed();
    actAs(a.id);
    const res = await getExercise(new Request('http://t/api'), idParams(exercise.id));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(exercise.id);
  });

  it('returns 404 to a stranger on GET, PUT, PATCH and DELETE and leaves the exercise intact', async () => {
    const { b, exercise } = await seed();
    actAs(b.id);
    expect((await getExercise(new Request('http://t/api'), idParams(exercise.id))).status).toBe(404);
    const put = await putExercise(
      jsonReq('PUT', { name: 'Hacked', muscleGroup: 'CHEST', category: 'COMPOUND' }),
      idParams(exercise.id),
    );
    expect(put.status).toBe(404);
    // Starring (issue #404) is scoped the same way.
    expect(
      (await patchExercise(jsonReq('PATCH', { isFavorite: true }), idParams(exercise.id))).status,
    ).toBe(404);
    expect(
      (await deleteExercise(new Request('http://t/api', { method: 'DELETE' }), idParams(exercise.id)))
        .status,
    ).toBe(404);
    const after = await db.exercise.findUnique({ where: { id: exercise.id } });
    expect(after?.name).toBe('Bench');
    expect(after?.isFavorite).toBe(false);
  });
});

describe('route ownership: /api/programs/[id]', () => {
  it('lets the owner read and update their program', async () => {
    const { a, program } = await seed();
    actAs(a.id);
    expect((await getProgram(new Request('http://t/api'), idParams(program.id))).status).toBe(200);
    const put = await putProgram(
      jsonReq('PUT', { name: 'Block 2', phase: 'strength' }),
      idParams(program.id),
    );
    expect(put.status).toBe(200);
    expect((await db.program.findUnique({ where: { id: program.id } }))?.name).toBe('Block 2');
  });

  it('returns 404 to a stranger on GET, PUT and DELETE and leaves the program intact', async () => {
    const { b, program } = await seed();
    actAs(b.id);
    expect((await getProgram(new Request('http://t/api'), idParams(program.id))).status).toBe(404);
    expect(
      (await putProgram(jsonReq('PUT', { name: 'Stolen', phase: 'x' }), idParams(program.id)))
        .status,
    ).toBe(404);
    expect(
      (await deleteProgram(new Request('http://t/api', { method: 'DELETE' }), idParams(program.id)))
        .status,
    ).toBe(404);
    const row = await db.program.findUnique({ where: { id: program.id } });
    expect(row?.name).toBe('Block 1');
  });
});

describe('route ownership: /api/workouts/[id]', () => {
  it('lets the owner update their workout', async () => {
    const { a, workout } = await seed();
    actAs(a.id);
    const res = await putWorkout(
      jsonReq('PUT', { name: 'Push B', dayOfWeek: 1 }),
      idParams(workout.id),
    );
    expect(res.status).toBe(200);
    expect((await db.workout.findUnique({ where: { id: workout.id } }))?.name).toBe('Push B');
  });

  it('returns 404 to a stranger on PUT and DELETE and leaves the workout intact', async () => {
    const { b, workout } = await seed();
    actAs(b.id);
    expect(
      (await putWorkout(jsonReq('PUT', { name: 'Stolen', dayOfWeek: 1 }), idParams(workout.id)))
        .status,
    ).toBe(404);
    expect(
      (await deleteWorkout(new Request('http://t/api', { method: 'DELETE' }), idParams(workout.id)))
        .status,
    ).toBe(404);
    expect((await db.workout.findUnique({ where: { id: workout.id } }))?.name).toBe('Push A');
  });
});

// Reordering (issue #557). The permutation rules live in
// workout-order-route.test.ts; this is the cross-user case.
describe('route ownership: /api/workouts/[id]/order', () => {
  it('returns 404 to a stranger, even with the right ids, and leaves the order intact', async () => {
    const { b, workout, programExercise } = await seed();
    actAs(b.id);
    const res = await putWorkoutOrder(
      jsonReq('PUT', { programExerciseIds: [programExercise.id] }),
      idParams(workout.id),
    );
    expect(res.status).toBe(404);
    expect((await db.programExercise.findUnique({ where: { id: programExercise.id } }))?.order).toBe(
      0,
    );
  });
});

describe('route ownership: /api/program-exercises/[id]', () => {
  it('returns 404 to a stranger (using their own exercise id) and leaves the row intact', async () => {
    const { b, exercise, exerciseB, programExercise } = await seed();
    actAs(b.id);
    // The stranger passes their own valid exercise so the exercise check
    // cannot mask the program-exercise ownership check.
    const body = {
      exerciseId: exerciseB.id,
      targetSets: 5,
      targetRepsMin: 5,
      targetRepsMax: 8,
      targetRIR: 1,
      restSec: 90,
    };
    expect((await putProgramExercise(jsonReq('PUT', body), idParams(programExercise.id))).status).toBe(
      404,
    );
    expect(
      (
        await deleteProgramExercise(
          new Request('http://t/api', { method: 'DELETE' }),
          idParams(programExercise.id),
        )
      ).status,
    ).toBe(404);
    const row = await db.programExercise.findUnique({ where: { id: programExercise.id } });
    expect(row?.exerciseId).toBe(exercise.id);
    expect(row?.targetSets).toBe(3);
  });
});

describe('route ownership: /api/coach/chat/[id]', () => {
  it('lets the owner read their conversation', async () => {
    const { a, conversation } = await seed();
    actAs(a.id);
    const res = await getChat(new Request('http://t/api'), idParams(conversation.id));
    expect(res.status).toBe(200);
    expect((await res.json()).messages).toHaveLength(1);
  });

  it('returns 404 to a stranger on GET and DELETE and keeps the conversation', async () => {
    const { b, conversation } = await seed();
    actAs(b.id);
    expect((await getChat(new Request('http://t/api'), idParams(conversation.id))).status).toBe(404);
    expect(
      (await deleteChat(new Request('http://t/api', { method: 'DELETE' }), idParams(conversation.id)))
        .status,
    ).toBe(404);
    expect(await db.conversation.findUnique({ where: { id: conversation.id } })).not.toBeNull();
  });
});

describe('route ownership: DELETE /api/mcp-tokens/[id]', () => {
  it('lets the owner revoke their token', async () => {
    const { a, mcpToken } = await seed();
    actAs(a.id);
    const res = await deleteMcpToken(
      new Request('http://t/api', { method: 'DELETE' }),
      idParams(mcpToken.id),
    );
    expect(res.status).toBe(200);
    expect(
      (await db.mcpAccessToken.findUnique({ where: { id: mcpToken.id } }))?.revokedAt,
    ).not.toBeNull();
  });

  it("returns 404 and leaves the token active when a stranger tries to revoke it", async () => {
    const { b, mcpToken } = await seed();
    actAs(b.id);
    const res = await deleteMcpToken(
      new Request('http://t/api', { method: 'DELETE' }),
      idParams(mcpToken.id),
    );
    expect(res.status).toBe(404);
    expect((await db.mcpAccessToken.findUnique({ where: { id: mcpToken.id } }))?.revokedAt).toBeNull();
  });
});

describe('route ownership: /api/gyms/[id]', () => {
  it('lets the owner rename their gym', async () => {
    const { a, gym } = await seed();
    actAs(a.id);
    const res = await putGym(jsonReq('PUT', { name: 'Garage' }), idParams(gym.id));
    expect(res.status).toBe(200);
    expect((await db.gym.findUnique({ where: { id: gym.id } }))?.name).toBe('Garage');
  });

  it('returns 404 to a stranger on PUT and DELETE and leaves the gym intact', async () => {
    const { b, gym } = await seed();
    actAs(b.id);
    expect((await putGym(jsonReq('PUT', { name: 'Stolen' }), idParams(gym.id))).status).toBe(404);
    expect(
      (await deleteGym(new Request('http://t/api', { method: 'DELETE' }), idParams(gym.id))).status,
    ).toBe(404);
    expect((await db.gym.findUnique({ where: { id: gym.id } }))?.name).toBe('Home gym');
  });
});

describe('route ownership: POST /api/coach/[id]/apply', () => {
  it("returns 404 and does not mark the debrief applied for a stranger", async () => {
    const { b, coachSession } = await seed();
    actAs(b.id);
    const res = await postCoachApply(
      jsonReq('POST', { adjustments: [{ exerciseName: 'Bench', summary: 'go up' }] }),
      idParams(coachSession.id),
    );
    expect(res.status).toBe(404);
    expect(
      (await db.coachSession.findUnique({ where: { id: coachSession.id } }))?.appliedAt,
    ).toBeNull();
  });
});

describe('route ownership: nested creation and activation routes', () => {
  it("returns 404 when a stranger activates someone else's program and leaves it inactive", async () => {
    const { b, program } = await seed();
    actAs(b.id);
    const res = await activateProgram(jsonReq('POST', {}), idParams(program.id));
    expect(res.status).toBe(404);
    expect((await db.program.findUnique({ where: { id: program.id } }))?.isActive).toBe(false);
  });

  it("returns 404 when a stranger adds a workout to someone else's program", async () => {
    const { b, program } = await seed();
    actAs(b.id);
    const res = await addWorkout(jsonReq('POST', { name: 'Injected' }), idParams(program.id));
    expect(res.status).toBe(404);
    expect(await db.workout.count({ where: { programId: program.id } })).toBe(1);
  });

  it("returns 404 when a stranger adds an exercise to someone else's workout", async () => {
    const { b, exerciseB, workout } = await seed();
    actAs(b.id);
    const res = await addProgramExercise(
      jsonReq('POST', {
        exerciseId: exerciseB.id,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRIR: 2,
        restSec: 120,
      }),
      idParams(workout.id),
    );
    expect(res.status).toBe(404);
    expect(await db.programExercise.count({ where: { workoutId: workout.id } })).toBe(1);
  });

  it("returns 404 when a stranger logs a set into someone else's session", async () => {
    const { b, exerciseB, session } = await seed();
    actAs(b.id);
    const res = await addSet(
      jsonReq('POST', { exerciseId: exerciseB.id, setNumber: 2, weight: 100, reps: 5 }),
      idParams(session.id),
    );
    expect(res.status).toBe(404);
    expect(await db.set.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it("saves a set but never attaches someone else's equipment to it", async () => {
    const { b, exerciseB, gym } = await seed();
    // Worst case on purpose: the stranger's session sits on the owner's gym
    // and the owner's equipment is linked to the stranger's exercise (states
    // the app never creates), so only the `gym: { userId }` scope in
    // lib/set-equipment.ts stands between the caller and the foreign row.
    // Equipment is optional decoration, so the set is saved (201) with the
    // reference degraded to null rather than rejected (issue #313, #326).
    const foreignEquipment = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: 'Owner leg press',
        equipmentType: 'MACHINE',
        weightOptions: [50, 100],
        exerciseLinks: { create: { exerciseId: exerciseB.id } },
      },
    });
    const sessionB = await db.session.create({ data: { userId: b.id, gymId: gym.id } });
    actAs(b.id);
    const res = await addSet(
      jsonReq('POST', {
        exerciseId: exerciseB.id,
        gymEquipmentId: foreignEquipment.id,
        setNumber: 1,
        weight: 100,
        reps: 5,
      }),
      idParams(sessionB.id),
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.gymEquipmentId).toBeNull();
    expect(created.equipmentNameSnapshot).toBeNull();
    expect(created.equipmentLoadSnapshot).toBeNull();
    expect(await db.set.count({ where: { gymEquipmentId: foreignEquipment.id } })).toBe(0);
  });

  it("returns 404 when a stranger activates someone else's gym and keeps their setting", async () => {
    const { b, gym } = await seed();
    actAs(b.id);
    const res = await activateGym(new Request('http://t/api', { method: 'POST' }), idParams(gym.id));
    expect(res.status).toBe(404);
    expect((await db.user.findUnique({ where: { id: b.id } }))?.activeGymId).toBeNull();
  });
});

// Routes that take someone's resource id in the request BODY rather than the
// path (issue #323). A path-based glob cannot see these, so they are pinned
// here and enumerated in route-ownership-coverage.test.ts.
describe('route ownership: body-addressed resource ids', () => {
  it("returns 404 when a stranger starts a session on someone else's workout", async () => {
    const { b, workout } = await seed();
    actAs(b.id);
    const res = await startSession(jsonReq('POST', { workoutId: workout.id }));
    expect(res.status).toBe(404);
    expect(await db.session.count({ where: { userId: b.id } })).toBe(0);
  });

  it("returns 404 when a stranger parses a set against someone else's exercise", async () => {
    const { b, exercise } = await seed();
    actAs(b.id);
    // The ownership check runs before any provider call, so this never
    // reaches the LLM layer.
    const res = await parseSet(jsonReq('POST', { exerciseId: exercise.id, text: '100x8' }));
    expect(res.status).toBe(404);
  });

  it("rejects a gym configured against someone else's exercise, and creates nothing", async () => {
    const { b, exercise } = await seed();
    actAs(b.id);
    const res = await createGym(
      jsonReq('POST', {
        name: 'Borrowed config',
        exerciseConfigs: [{ exerciseId: exercise.id, isAvailable: true, weightOptions: [20] }],
      }),
    );
    expect(res.status).toBe(400);
    expect(await db.gym.count({ where: { userId: b.id } })).toBe(0);
  });

  it("returns 404 when a stranger posts into someone else's conversation", async () => {
    const { b, conversation } = await seed();
    actAs(b.id);
    const res = await postChat(
      jsonReq('POST', { conversationId: conversation.id, message: 'let me in' }),
    );
    expect(res.status).toBe(404);
    // The foreign conversation gained no message.
    expect(await db.message.count({ where: { conversationId: conversation.id } })).toBe(1);
  });
});

describe('route ownership: GET /api/history/csv', () => {
  it("exports only the caller's own sets", async () => {
    const { a, b, session } = await seed();
    await db.session.update({
      where: { id: session.id, userId: a.id },
      data: { finishedAt: new Date() },
    });
    actAs(b.id);
    const res = await getHistoryCsv(new Request('http://t/api/history/csv'));
    expect(res.status).toBe(200);
    const body = await res.text();
    // User A's exercise must not leak into user B's export.
    expect(body).not.toContain('Bench');
  });
});
