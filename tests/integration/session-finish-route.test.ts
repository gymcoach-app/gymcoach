import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

// A late Finish ends the session at its last set (issue #571): PUT
// /api/sessions/[id] with `finish: true` against real rows whose timestamps
// are set explicitly, relative to the time of the request.

// Auth is read through getCurrentUserId (via requireApiUserId in @/lib/api).
vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { PUT as putSession } from '@/app/api/sessions/[id]/route';

const MINUTE = 60_000;

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function jsonReq(body: unknown): Request {
  return new Request('http://test.local/api', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function minutesAgo(min: number): Date {
  return new Date(Date.now() - min * MINUTE);
}

// A user with one open session started `startedMinAgo` minutes ago, holding
// one set per entry of `setsMinAgo` (a strength set, or a cardio set when
// `cardio` is true), each completed that many minutes ago.
async function seed(startedMinAgo: number, setsMinAgo: number[], cardio = false) {
  const user = await db.user.create({ data: { email: 'finish@test.dev', passwordHash: 'x' } });
  const exercise = await db.exercise.create({
    data: cardio
      ? { userId: user.id, name: 'Running', muscleGroup: 'OTHER', category: 'CARDIO' }
      : { userId: user.id, name: 'Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  const session = await db.session.create({
    data: { userId: user.id, startedAt: minutesAgo(startedMinAgo) },
  });
  const sets = [];
  for (const [i, min] of setsMinAgo.entries()) {
    sets.push(
      await db.set.create({
        data: {
          sessionId: session.id,
          exerciseId: exercise.id,
          setNumber: i + 1,
          weight: cardio ? 0 : 60,
          reps: cardio ? 1 : 10,
          durationSec: cardio ? 1200 : null,
          completedAt: minutesAgo(min),
        },
      }),
    );
  }
  return { user, session, sets };
}

// Finishes the session and returns the stored finishedAt with the window of
// the request, to tell "now" from a set time.
async function finish(sessionId: string) {
  const before = Date.now();
  const res = await putSession(jsonReq({ finish: true }), idParams(sessionId));
  const after = Date.now();
  expect(res.status).toBe(200);
  const body = await res.json();
  const row = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
  expect(row.finishedAt).not.toBeNull();
  expect(new Date(body.finishedAt).getTime()).toBe(row.finishedAt!.getTime());
  return { finishedAt: row.finishedAt!, before, after };
}

function expectNow(r: { finishedAt: Date; before: number; after: number }) {
  expect(r.finishedAt.getTime()).toBeGreaterThanOrEqual(r.before);
  expect(r.finishedAt.getTime()).toBeLessThanOrEqual(r.after);
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('PUT /api/sessions/[id] finish (issue #571)', () => {
  it('ends a late finish at the most recent set, not at the request', async () => {
    // Started 14 h ago, last set 13 h ago, Finish tapped the next morning.
    const { user, session, sets } = await seed(14 * 60, [13 * 60 + 40, 13 * 60, 13 * 60 + 20]);
    actAs(user.id);

    const r = await finish(session.id);

    expect(r.finishedAt.getTime()).toBe(sets[1]!.completedAt.getTime());
    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    const durationMin = Math.round((r.finishedAt.getTime() - row.startedAt.getTime()) / MINUTE);
    expect(durationMin).toBe(60);
  });

  it('ends a late finish at the timestamp of a last cardio set, without adding its duration', async () => {
    const { user, session, sets } = await seed(120, [45], true);
    actAs(user.id);

    const r = await finish(session.id);

    expect(r.finishedAt.getTime()).toBe(sets[0]!.completedAt.getTime());
  });

  it('ends a prompt finish now', async () => {
    const { user, session } = await seed(60, [40, 5]);
    actAs(user.id);

    expectNow(await finish(session.id));
  });

  it('ends a session without sets now, however old it is', async () => {
    const { user, session } = await seed(14 * 60, []);
    actAs(user.id);

    expectNow(await finish(session.id));
  });

  it('never ends a session before it started', async () => {
    // A set stamped before startedAt (possible in restored data).
    const { user, session } = await seed(120, [180]);
    actAs(user.id);

    const r = await finish(session.id);

    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(r.finishedAt.getTime()).toBe(row.startedAt.getTime());
  });

  it('gives the same end when a late finish is sent twice', async () => {
    const { user, session, sets } = await seed(300, [200]);
    actAs(user.id);

    const first = await finish(session.id);
    const second = await finish(session.id);

    expect(first.finishedAt.getTime()).toBe(sets[0]!.completedAt.getTime());
    expect(second.finishedAt.getTime()).toBe(first.finishedAt.getTime());
  });

  it('leaves finishedAt alone on a notes-only update', async () => {
    const { user, session } = await seed(300, [200]);
    actAs(user.id);

    const res = await putSession(jsonReq({ notes: 'felt good' }), idParams(session.id));

    expect(res.status).toBe(200);
    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.finishedAt).toBeNull();
    expect(row.notes).toBe('felt good');
  });

  it("answers 404 to a stranger and leaves the owner's session open", async () => {
    const { session } = await seed(300, [200]);
    const stranger = await db.user.create({
      data: { email: 'stranger@test.dev', passwordHash: 'x' },
    });
    actAs(stranger.id);

    const res = await putSession(jsonReq({ finish: true }), idParams(session.id));

    expect(res.status).toBe(404);
    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.finishedAt).toBeNull();
  });
});
