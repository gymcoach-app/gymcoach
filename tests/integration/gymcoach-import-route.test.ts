import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

// GymCoach native CSV import (issue #270): the symmetric inverse of the
// history CSV export. Mirrors hevy-import-route.test.ts, plus a true
// export -> import round-trip through the real export route.

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as postImport } from '@/app/api/import/gymcoach/route';
import { GET as getCsv } from '@/app/api/history/csv/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function importReq(body: unknown): Request {
  return new Request('http://test.local/api/import/gymcoach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Minimal-but-realistic file: the required columns plus the extras the
// importer honors. Two sessions (real times on the first), one warmup, rir,
// notes and one cardio row with heart rate.
const HEADER =
  'session_id,session_date,session_started_at,session_finished_at,workout,exercise,set_number,external_load_kg,reps,rir,is_warmup,is_drop_set,set_notes,duration_sec,distance_m,avg_hr,max_hr';

const CSV = [
  HEADER,
  's1,2026-05-02,2026-05-02T09:13:00.000Z,2026-05-02T10:05:00.000Z,Push Day,Bench Press,1,40,8,,true,false,,,,,',
  's1,2026-05-02,2026-05-02T09:13:00.000Z,2026-05-02T10:05:00.000Z,Push Day,Bench Press,2,80,8,2,false,false,felt strong,,,,',
  's1,2026-05-02,2026-05-02T09:13:00.000Z,2026-05-02T10:05:00.000Z,Push Day,Bench Press,3,60,10,0,false,true,,,,,',
  's2,2026-05-03,,,Pull Day,Imported Row,1,70,10,,false,false,,,,,',
  's3,2026-05-03,,,Pull Day,Running,1,0,1,,false,false,,1800,5000,150,172',
].join('\n');

async function seedUser(email = 'gymcoach-importer@test.dev') {
  return db.user.create({ data: { email, passwordHash: 'x' } });
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('POST /api/import/gymcoach (preview)', () => {
  it('returns counts and per-line info without writing anything', async () => {
    const user = await seedUser();
    actAs(user.id);

    const res = await postImport(importReq({ csv: CSV, mode: 'preview' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      mode: 'preview',
      // s2 and s3 share the day and workout name but stay separate sessions.
      sessions: 3,
      sets: 5,
      newExercises: ['Bench Press', 'Imported Row', 'Running'],
      duplicatesSkipped: 0,
      cardioSets: 1,
      cardioSkipped: 0,
      errorCount: 0,
    });

    expect(await db.session.count()).toBe(0);
    expect(await db.set.count()).toBe(0);
    expect(await db.exercise.count()).toBe(0);
  });

  it('rejects an unrecognized header with a clear message', async () => {
    const user = await seedUser();
    actAs(user.id);
    const res = await postImport(importReq({ csv: 'foo,bar\n1,2', mode: 'preview' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unrecognized format/i);
  });

  it('rejects a Strong-format file (formats are not interchangeable)', async () => {
    const user = await seedUser();
    actAs(user.id);
    const res = await postImport(
      importReq({
        csv: 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps\n2026-05-02,Push,Bench,1,80,8',
        mode: 'preview',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/gymcoach history csv/i);
  });

  it('requires auth', async () => {
    mockUserId.mockResolvedValue(null);
    const res = await postImport(importReq({ csv: CSV, mode: 'preview' }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/import/gymcoach (confirm)', () => {
  it('creates sessions with real times and persists rir, notes, flags and HR', async () => {
    const user = await seedUser();
    actAs(user.id);

    const res = await postImport(importReq({ csv: CSV, mode: 'confirm' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      mode: 'confirm',
      createdSessions: 3,
      createdSets: 5,
      createdExercises: 3,
      cardioSets: 1,
    });

    const sessions = await db.session.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: 'asc' },
      include: { sets: { orderBy: { setNumber: 'asc' } } },
    });
    expect(sessions).toHaveLength(3);
    // Real export times on the first session, noon-UTC fallback on the rest.
    expect(sessions[0]?.startedAt.toISOString()).toBe('2026-05-02T09:13:00.000Z');
    expect(sessions[0]?.finishedAt?.toISOString()).toBe('2026-05-02T10:05:00.000Z');
    expect(sessions[0]?.notes).toBe('Imported from GymCoach CSV - Push Day');
    expect(sessions[1]?.startedAt.toISOString()).toBe('2026-05-03T12:00:00.000Z');

    // Per-set extras persisted: warmup/dropset flags, rir (including 0), notes.
    expect(
      sessions[0]?.sets.map((s) => [s.isWarmup, s.isDropSet, s.rir, s.notes]),
    ).toEqual([
      [true, false, null, null],
      [false, false, 2, 'felt strong'],
      [false, true, 0, null],
    ]);

    // The cardio set carries duration, distance and both HR values.
    const cardioSet = await db.set.findFirst({
      where: { exercise: { name: 'Running' } },
    });
    expect(cardioSet).toMatchObject({
      durationSec: 1800,
      distanceM: 5000,
      avgHr: 150,
      maxHr: 172,
      weight: 0,
      reps: 1,
    });

    // Cardio-only imported exercises are created as CARDIO.
    const created = await db.exercise.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
    });
    expect(created.map((e) => e.category)).toEqual(['ISOLATION', 'ISOLATION', 'CARDIO']);
  });

  it('round-trips the real history CSV export back into equivalent sets', async () => {
    // Seed a mixed session for the exporter, with a formula-looking exercise
    // name so the neutralization guard is exercised end to end.
    const exporter = await seedUser('gymcoach-exporter@test.dev');
    const bench = await db.exercise.create({
      data: {
        userId: exporter.id,
        name: '=Bench, "Press"',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });
    const running = await db.exercise.create({
      data: { userId: exporter.id, name: 'Running', muscleGroup: 'OTHER', category: 'CARDIO' },
    });
    const session = await db.session.create({
      data: {
        userId: exporter.id,
        startedAt: new Date('2026-06-01T10:00:00Z'),
        finishedAt: new Date('2026-06-01T11:00:00Z'),
      },
    });
    await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: bench.id,
        setNumber: 1,
        weight: 100,
        reps: 5,
        rir: 1,
        notes: 'top set',
      },
    });
    await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: running.id,
        setNumber: 1,
        weight: 0,
        reps: 1,
        durationSec: 1800,
        distanceM: 5000,
        avgHr: 152,
        maxHr: 181,
      },
    });

    actAs(exporter.id);
    const csvRes = await getCsv(new Request('http://test.local/api/history/csv'));
    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();

    // Import the export into a fresh account: everything must come back.
    const importer = await seedUser('gymcoach-reimporter@test.dev');
    actAs(importer.id);
    const res = await postImport(importReq({ csv: csvText, mode: 'confirm' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      createdSessions: 1,
      createdSets: 2,
      createdExercises: 2,
      errorCount: 0,
    });

    const imported = await db.session.findFirstOrThrow({
      where: { userId: importer.id },
      include: { sets: { include: { exercise: true } } },
    });
    expect(imported.startedAt.toISOString()).toBe('2026-06-01T10:00:00.000Z');
    expect(imported.finishedAt?.toISOString()).toBe('2026-06-01T11:00:00.000Z');

    const benchSet = imported.sets.find((s) => s.exercise.name === '=Bench, "Press"');
    expect(benchSet).toMatchObject({ weight: 100, reps: 5, rir: 1, notes: 'top set' });
    const runSet = imported.sets.find((s) => s.exercise.name === 'Running');
    expect(runSet).toMatchObject({
      durationSec: 1800,
      distanceM: 5000,
      avgHr: 152,
      maxHr: 181,
    });
  });

  it('round-trips the block of a repeated lift through export and import (issue #475)', async () => {
    const exporter = await seedUser('gymcoach-block-exporter@test.dev');
    const squat = await db.exercise.create({
      data: { userId: exporter.id, name: 'Block Squat', muscleGroup: 'QUADS', category: 'COMPOUND' },
    });
    const session = await db.session.create({
      data: {
        userId: exporter.id,
        startedAt: new Date('2026-06-02T10:00:00Z'),
        finishedAt: new Date('2026-06-02T11:00:00Z'),
      },
    });
    // Same set number, weight and reps in both blocks: only the block keeps
    // them apart, so the importer must not drop the second one as a duplicate.
    await db.set.createMany({
      data: [0, 1].map((block) => ({
        sessionId: session.id,
        exerciseId: squat.id,
        setNumber: 1,
        weight: 60,
        reps: 10,
        block,
      })),
    });

    actAs(exporter.id);
    const csvText = await (await getCsv(new Request('http://test.local/api/history/csv'))).text();

    const importer = await seedUser('gymcoach-block-importer@test.dev');
    actAs(importer.id);
    const res = await postImport(importReq({ csv: csvText, mode: 'confirm' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ createdSets: 2, duplicatesSkipped: 0 });
    const blocks = await db.set.findMany({
      where: { session: { userId: importer.id } },
      orderBy: { block: 'asc' },
      select: { block: true },
    });
    expect(blocks.map((x) => x.block)).toEqual([0, 1]);

    // A second import of the same file skips both as duplicates.
    const again = await postImport(importReq({ csv: csvText, mode: 'preview' }));
    expect(await again.json()).toMatchObject({ sets: 0, duplicatesSkipped: 2 });
  });

  it('does not duplicate block 1 sets when re-importing an export without the block column', async () => {
    // An export written before issue #475 has no block column. Re-importing it
    // over the same account, which already holds the BBB back-off sets with
    // block 1, must skip them as duplicates, not add a second copy.
    const user = await seedUser('gymcoach-old-export@test.dev');
    const squat = await db.exercise.create({
      data: { userId: user.id, name: 'Block Squat', muscleGroup: 'QUADS', category: 'COMPOUND' },
    });
    const session = await db.session.create({
      data: {
        userId: user.id,
        startedAt: new Date('2026-06-03T10:00:00Z'),
        finishedAt: new Date('2026-06-03T11:00:00Z'),
      },
    });
    await db.set.createMany({
      data: [1, 2].map((setNumber) => ({
        sessionId: session.id,
        exerciseId: squat.id,
        setNumber,
        weight: 60,
        reps: 10,
        block: 1,
      })),
    });
    const oldCsv = [
      'session_id,session_date,workout,exercise,set_number,external_load_kg,reps',
      `${session.id},2026-06-03,BBB,Block Squat,1,60,10`,
      `${session.id},2026-06-03,BBB,Block Squat,2,60,10`,
    ].join('\n');

    actAs(user.id);
    const res = await postImport(importReq({ csv: oldCsv, mode: 'preview' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sets: 0, duplicatesSkipped: 2 });
  });

  it("never matches or touches another user's exercises", async () => {
    const user = await seedUser();
    const other = await seedUser('gymcoach-other@test.dev');
    await db.exercise.create({
      data: { userId: other.id, name: 'Bench Press', muscleGroup: 'CHEST', category: 'COMPOUND' },
    });
    actAs(user.id);

    await postImport(importReq({ csv: CSV, mode: 'confirm' }));
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
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/nothing to import/i);

    expect(await db.session.count({ where: { userId: user.id } })).toBe(3);
    expect(await db.set.count({ where: { session: { userId: user.id } } })).toBe(5);
  });

  it('rejects invalid input (Zod) and writes nothing', async () => {
    const user = await seedUser();
    actAs(user.id);
    const res = await postImport(importReq({ csv: CSV, mode: 'apply' }));
    expect(res.status).toBe(400);
    expect(await db.session.count()).toBe(0);
  });
});
