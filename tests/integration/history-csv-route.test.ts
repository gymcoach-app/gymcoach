import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { HISTORY_CSV_HEADERS } from '@/lib/csv';

// CSV history export with cardio columns (issue #144): the export must
// round-trip duration/distance, with the pre-existing column order untouched.

// Auth is read through getCurrentUserId (via requireApiUserId in @/lib/api).
vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { GET as getCsv } from '@/app/api/history/csv/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

async function seedMixedSession() {
  const user = await db.user.create({
    data: { email: 'csv-export@test.dev', passwordHash: 'x' },
  });
  const running = await db.exercise.create({
    data: { userId: user.id, name: 'Running', muscleGroup: 'OTHER', category: 'CARDIO' },
  });
  const bench = await db.exercise.create({
    data: { userId: user.id, name: 'Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  const session = await db.session.create({
    data: {
      userId: user.id,
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
  return { user, session };
}

async function exportRows(): Promise<{ header: string[]; rows: string[][] }> {
  const res = await getCsv(new Request('http://test.local/api/history/csv'));
  expect(res.status).toBe(200);
  const body = (await res.text()).replace(/^﻿/, '');
  // Numeric-only cells in these fixtures: a plain split is safe.
  const [header, ...rows] = body.split('\n').map((line) => line.split(','));
  if (!header) throw new Error('empty CSV export');
  return { header, rows };
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('GET /api/history/csv - cardio columns (issue #144)', () => {
  it('appends cardio columns (duration/distance/HR), populated only on cardio rows', async () => {
    const { user } = await seedMixedSession();
    actAs(user.id);

    const { header, rows } = await exportRows();
    expect(header).toEqual([...HISTORY_CSV_HEADERS]);

    const durationIdx = header.indexOf('duration_sec');
    const distanceIdx = header.indexOf('distance_m');
    const avgHrIdx = header.indexOf('avg_hr');
    const maxHrIdx = header.indexOf('max_hr');
    // The four cardio columns keep their positions, in this order, followed
    // only by the block column appended after them (issue #475).
    expect(durationIdx).toBe(header.length - 5);
    expect(distanceIdx).toBe(header.length - 4);
    expect(avgHrIdx).toBe(header.length - 3);
    expect(maxHrIdx).toBe(header.length - 2);
    expect(header.indexOf('block')).toBe(header.length - 1);

    const exerciseIdx = header.indexOf('exercise');
    const strengthRow = rows.find((r) => r[exerciseIdx] === 'Bench');
    const cardioRow = rows.find((r) => r[exerciseIdx] === 'Running');
    expect(strengthRow).toBeDefined();
    expect(cardioRow).toBeDefined();

    // Cardio row: raw storage units, stored row shape (weight 0 / reps 1).
    expect(cardioRow![durationIdx]).toBe('1800');
    expect(cardioRow![distanceIdx]).toBe('5000');
    expect(cardioRow![avgHrIdx]).toBe('152');
    expect(cardioRow![maxHrIdx]).toBe('181');
    expect(cardioRow![header.indexOf('external_load_kg')]).toBe('0');
    expect(cardioRow![header.indexOf('reps')]).toBe('1');

    // Strength row: cardio columns empty, lifting cells unchanged.
    expect(strengthRow![durationIdx]).toBe('');
    expect(strengthRow![distanceIdx]).toBe('');
    expect(strengthRow![avgHrIdx]).toBe('');
    expect(strengthRow![maxHrIdx]).toBe('');
    expect(strengthRow![header.indexOf('external_load_kg')]).toBe('100');
    expect(strengthRow![header.indexOf('reps')]).toBe('5');
    expect(strengthRow![header.indexOf('volume_kg')]).toBe('500');
  });
});

describe('GET /api/history/csv - block column (issue #475)', () => {
  it('writes the block of a repeated lift and leaves it empty otherwise', async () => {
    const { user, session } = await seedMixedSession();
    const bench = await db.exercise.findFirstOrThrow({ where: { userId: user.id, name: 'Bench' } });
    // The 5x10 back-off block of the same bench, numbered from 1 again.
    await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: bench.id,
        setNumber: 1,
        weight: 60,
        reps: 10,
        block: 1,
      },
    });
    actAs(user.id);

    const { header, rows } = await exportRows();
    const blockIdx = header.indexOf('block');
    const exerciseIdx = header.indexOf('exercise');
    const loadIdx = header.indexOf('external_load_kg');
    const cells = rows
      .filter((r) => r.length === header.length)
      .map((r) => [r[exerciseIdx], r[loadIdx], r[blockIdx]]);
    expect(cells).toEqual(
      expect.arrayContaining([
        ['Bench', '100', ''],
        ['Bench', '60', '1'],
        ['Running', '0', ''],
      ]),
    );
    expect(cells).toHaveLength(3);
  });
});
