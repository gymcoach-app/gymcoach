import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import {
  buildStrongImportPlan,
  executeStrongImport,
} from '@/lib/import/strong-import';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as postImport } from '@/app/api/import/strong/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function importReq(body: unknown): Request {
  return new Request('http://test.local/api/import/strong', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const CSV = [
  'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds',
  '2026-05-02 09:00:00,Push Day,Bench Press,1,80,8,0,0',
  '2026-05-02 09:00:00,Push Day,Bench Press,2,80,7,0,0',
  '2026-05-03 18:00:00,Pull Day,Imported Row,1,70,10,0,0',
  '2026-05-03 18:05:00,Pull Day,Running,1,0,0,5000,1800',
].join('\n');

async function seedUser(email = 'importer@test.dev') {
  return db.user.create({ data: { email, passwordHash: 'x' } });
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('POST /api/import/strong (preview)', () => {
  it('returns counts and per-line info without writing anything', async () => {
    const user = await seedUser();
    actAs(user.id);

    const res = await postImport(importReq({ csv: CSV, mode: 'preview' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      mode: 'preview',
      sessions: 2,
      sets: 4,
      newExercises: ['Bench Press', 'Imported Row', 'Running'],
      duplicatesSkipped: 0,
      // The Running row is imported as a cardio set since #134.
      cardioSets: 1,
      cardioSkipped: 0,
      errorCount: 0,
    });

    expect(await db.session.count()).toBe(0);
    expect(await db.set.count()).toBe(0);
    expect(await db.exercise.count()).toBe(0);
  });

  it('warns about dates that already have sessions', async () => {
    const user = await seedUser();
    await db.session.create({
      data: { userId: user.id, startedAt: new Date('2026-05-02T07:00:00.000Z') },
    });
    actAs(user.id);

    const body = await (
      await postImport(importReq({ csv: CSV, mode: 'preview' }))
    ).json();
    expect(body.existingSessionDates).toEqual(['2026-05-02']);
  });

  it('rejects an unrecognized header with a clear message', async () => {
    const user = await seedUser();
    actAs(user.id);
    const res = await postImport(
      importReq({ csv: 'foo,bar\n1,2', mode: 'preview' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unrecognized format/i);
  });

  it('requires auth', async () => {
    mockUserId.mockResolvedValue(null);
    const res = await postImport(importReq({ csv: CSV, mode: 'preview' }));
    expect(res.status).toBe(401);
  });
});

// Issue #571: letter markers in Set Order and rows that are not sets.
describe('POST /api/import/strong (set markers, issue #571)', () => {
  const MARKER_CSV = [
    'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes',
    '2026-05-02 09:00:00,Push Day,Bench Press,W,40,10,0,0,',
    '2026-05-02 09:00:00,Push Day,Bench Press,Rest Timer,,,,60,',
    '2026-05-02 09:00:00,Push Day,Bench Press,1,80,8,0,0,',
    '2026-05-02 09:00:00,Push Day,Bench Press,F,80,5,0,0,',
    '2026-05-02 09:00:00,Push Day,Bench Press,D,60,9,0,0,',
    '2026-05-02 09:00:00,Push Day,Bench Press,Note,,,,,"Good day"',
  ].join('\n');

  it('previews the sets and counts the skipped rest timer and note rows', async () => {
    const user = await seedUser();
    actAs(user.id);

    const res = await postImport(importReq({ csv: MARKER_CSV, mode: 'preview' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      mode: 'preview',
      sessions: 1,
      sets: 4,
      newExercises: ['Bench Press'],
      cardioSets: 0,
      cardioSkipped: 0,
      nonSetRowsSkipped: 2,
      errorCount: 0,
    });
    expect(await db.set.count()).toBe(0);
  });

  it('stores the sets in file order with the warm-up and drop-set flags', async () => {
    const user = await seedUser();
    actAs(user.id);

    const res = await postImport(importReq({ csv: MARKER_CSV, mode: 'confirm' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      createdSessions: 1,
      createdSets: 4,
      nonSetRowsSkipped: 2,
    });

    const sets = await db.set.findMany({
      where: { session: { userId: user.id } },
      orderBy: { setNumber: 'asc' },
    });
    expect(
      sets.map((s) => [s.setNumber, s.weight, s.reps, s.isWarmup, s.isDropSet, s.durationSec]),
    ).toEqual([
      [1, 40, 10, true, false, null],
      [2, 80, 8, false, false, null],
      [3, 80, 5, false, false, null],
      [4, 60, 9, false, true, null],
    ]);

    // Importing the same file again adds nothing: the positions are stable.
    const again = await postImport(importReq({ csv: MARKER_CSV, mode: 'preview' }));
    expect(await again.json()).toMatchObject({ sets: 0, duplicatesSkipped: 4 });
  });
});

describe('POST /api/import/strong (confirm)', () => {
  it('creates exercises, sessions and sets transactionally', async () => {
    const user = await seedUser();
    actAs(user.id);

    const res = await postImport(importReq({ csv: CSV, mode: 'confirm' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      mode: 'confirm',
      createdSessions: 2,
      createdSets: 4,
      createdExercises: 3,
      cardioSets: 1,
      cardioSkipped: 0,
    });

    const sessions = await db.session.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: 'asc' },
      include: { sets: true },
    });
    expect(sessions).toHaveLength(2);
    // Honest defaults: noon UTC, finished, workout name kept in the notes.
    expect(sessions[0]?.startedAt.toISOString()).toBe('2026-05-02T12:00:00.000Z');
    expect(sessions[0]?.finishedAt?.toISOString()).toBe('2026-05-02T12:00:00.000Z');
    expect(sessions[0]?.notes).toBe('Imported from Strong - Push Day');
    expect(sessions[0]?.sets).toHaveLength(2);

    const created = await db.exercise.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
    });
    expect(created.map((e) => e.muscleGroup)).toEqual(['OTHER', 'OTHER', 'OTHER']);
    // Cardio-only imported exercises are created as CARDIO (issue #134).
    expect(created.map((e) => e.category)).toEqual(['ISOLATION', 'ISOLATION', 'CARDIO']);

    // The cardio set carries the #133 model: duration/distance, weight 0, reps 1.
    const cardioSet = await db.set.findFirst({
      where: { exercise: { name: 'Running' } },
    });
    expect(cardioSet).toMatchObject({
      durationSec: 1800,
      distanceM: 5000,
      weight: 0,
      reps: 1,
    });
    // Strength sets keep NULL cardio columns (pinned).
    const benchSet = await db.set.findFirst({
      where: { exercise: { name: 'Bench Press' } },
    });
    expect(benchSet).toMatchObject({ durationSec: null, distanceM: null });
  });

  it('matches existing exercises case-insensitively instead of duplicating them', async () => {
    const user = await seedUser();
    const bench = await db.exercise.create({
      data: { userId: user.id, name: 'bench press', muscleGroup: 'CHEST', category: 'COMPOUND' },
    });
    actAs(user.id);

    const body = await (
      await postImport(importReq({ csv: CSV, mode: 'confirm' }))
    ).json();
    expect(body.createdExercises).toBe(2); // "Imported Row" and "Running"

    const benchSets = await db.set.count({ where: { exerciseId: bench.id } });
    expect(benchSets).toBe(2);
  });

  it("never matches or touches another user's exercises", async () => {
    const user = await seedUser();
    const other = await seedUser('other@test.dev');
    await db.exercise.create({
      data: { userId: other.id, name: 'Bench Press', muscleGroup: 'CHEST', category: 'COMPOUND' },
    });
    actAs(user.id);

    await postImport(importReq({ csv: CSV, mode: 'confirm' }));
    // The importer got their own new exercise; the stranger's data is intact.
    expect(
      await db.exercise.count({ where: { userId: user.id, name: 'Bench Press' } }),
    ).toBe(1);
    expect(await db.set.count({ where: { session: { userId: other.id } } })).toBe(0);
  });

  it('skips exact duplicates on re-import (idempotence)', async () => {
    const user = await seedUser();
    actAs(user.id);

    await postImport(importReq({ csv: CSV, mode: 'confirm' }));
    const res = await postImport(importReq({ csv: CSV, mode: 'confirm' }));
    // Everything is a duplicate now: nothing to import.
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/nothing to import/i);

    expect(await db.session.count({ where: { userId: user.id } })).toBe(2);
    expect(await db.set.count({ where: { session: { userId: user.id } } })).toBe(4);
  });

  it('rejects invalid input (Zod) and writes nothing', async () => {
    const user = await seedUser();
    actAs(user.id);
    const res = await postImport(importReq({ csv: CSV, mode: 'apply' }));
    expect(res.status).toBe(400);
    expect(await db.session.count()).toBe(0);
  });
});

describe('transaction rollback', () => {
  it('persists nothing when the transaction fails after the import writes', async () => {
    const user = await seedUser();
    const plan = buildStrongImportPlan(
      [
        {
          dateKey: '2026-05-02',
          workoutName: 'Push',
          exerciseName: 'Bench',
          setOrder: 1,
          weightKg: 80,
          reps: 8,
        },
      ],
      [],
      new Set(),
    );

    await expect(
      db.$transaction(async (tx) => {
        const result = await executeStrongImport(tx, user.id, plan);
        expect(result.createdSets).toBe(1);
        // Induced failure AFTER all writes: if any write escaped the
        // transaction client, the assertions below would catch it.
        throw new Error('induced failure');
      }),
    ).rejects.toThrow('induced failure');

    expect(await db.exercise.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.set.count()).toBe(0);
  });
});
