import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { buildCoachPayload } from '@/lib/coach';

// "Attach a watch file" (issue #562): the heart rate of a watch recording is
// stored on an existing session. No session, set or exercise is created, the
// session's sets, dates and notes are never touched, and a stranger's session
// id is a 404.

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import {
  POST as postWatchFile,
  DELETE as deleteWatchFile,
} from '@/app/api/sessions/[id]/watch-file/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function attach(sessionId: string, body: unknown) {
  return postWatchFile(
    new Request(`http://test.local/api/sessions/${sessionId}/watch-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params(sessionId),
  );
}

function remove(sessionId: string) {
  return deleteWatchFile(
    new Request(`http://test.local/api/sessions/${sessionId}/watch-file`, { method: 'DELETE' }),
    params(sessionId),
  );
}

// A watch recording of a strength workout: 40 minutes from 07:30:00Z, lap
// summary 118 avg / 165 peak, three samples with heart rate.
const LEGS_TCX =
  `<?xml version="1.0"?><TrainingCenterDatabase><Activities>` +
  `<Activity Sport="Other"><Id>2026-06-10T07:30:00.000Z</Id>` +
  `<Lap StartTime="2026-06-10T07:30:00.000Z"><TotalTimeSeconds>2400</TotalTimeSeconds>` +
  `<AverageHeartRateBpm><Value>118</Value></AverageHeartRateBpm>` +
  `<MaximumHeartRateBpm><Value>165</Value></MaximumHeartRateBpm><Track>` +
  `<Trackpoint><Time>2026-06-10T07:30:00.000Z</Time><HeartRateBpm><Value>95</Value></HeartRateBpm></Trackpoint>` +
  `<Trackpoint><Time>2026-06-10T07:40:00.000Z</Time><HeartRateBpm><Value>165</Value></HeartRateBpm></Trackpoint>` +
  `<Trackpoint><Time>2026-06-10T07:50:00.000Z</Time><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>` +
  `</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
const LEGS_TRACK = [
  { t: 0, hr: 95 },
  { t: 600, hr: 165 },
  { t: 1200, hr: 120 },
];

// A GPX recording with heart rate but no peak value of its own.
const gpxPoint = (time: string, hr?: number) =>
  `<trkpt lat="48.8566" lon="2.3522"><time>${time}</time>` +
  (hr != null ? `<extensions><gpxtpx:hr>${hr}</gpxtpx:hr></extensions>` : '') +
  `</trkpt>`;
const gpx = (points: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test">` +
  `<trk><trkseg>${points}</trkseg></trk></gpx>`;
const HR_GPX = gpx(
  gpxPoint('2026-06-10T07:31:00.000Z', 100) +
    gpxPoint('2026-06-10T07:32:00.000Z', 140) +
    gpxPoint('2026-06-10T07:33:00.000Z', 150),
);
const NO_HR_GPX = gpx(gpxPoint('2026-06-10T07:31:00.000Z') + gpxPoint('2026-06-10T07:32:00.000Z'));

// Real FIT file from the Garmin SDK: running, 25 min, HR 150/175, start
// 2026-03-15T09:00:00Z (same fixture as lib/import/fit.test.ts).
const RUN_FIT =
  'DgLYUlkAAAAuRklUmYtAAAAAAAUAAQIBAoQCAoQEBIYDBIwABP8AAAAQKRlE0gQAAEEAABIACP0EhgIEhgUBAgcEhggEhgkEhhABAhEBAgHsLhlEECkZRAFg4xYAYOMWACChBwCWr/Jq';

const SESSION_START = new Date('2026-06-10T07:28:00.000Z');
const SESSION_END = new Date('2026-06-10T08:15:00.000Z');

// A user with one finished leg session of two squat sets.
async function seedLifter(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'x' } });
  const squat = await db.exercise.create({
    data: { userId: user.id, name: 'Squat', muscleGroup: 'QUADS', category: 'COMPOUND' },
  });
  const session = await db.session.create({
    data: {
      userId: user.id,
      startedAt: SESSION_START,
      finishedAt: SESSION_END,
      notes: 'leg day',
    },
  });
  await db.set.createMany({
    data: [
      { sessionId: session.id, exerciseId: squat.id, setNumber: 1, weight: 100, reps: 5, rir: 2 },
      { sessionId: session.id, exerciseId: squat.id, setNumber: 2, weight: 100, reps: 5, rir: 1 },
    ],
  });
  return { user, session, squat };
}

// Everything the feature must leave alone, in one comparable snapshot.
async function untouched(userId: string, sessionId: string) {
  const session = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
  return {
    sessions: await db.session.count({ where: { userId } }),
    exercises: await db.exercise.count({ where: { userId } }),
    sets: await db.set.findMany({
      where: { session: { userId } },
      orderBy: { setNumber: 'asc' },
    }),
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    notes: session.notes,
  };
}

async function heartRateOf(sessionId: string) {
  return db.session.findUniqueOrThrow({
    where: { id: sessionId },
    select: { avgHr: true, maxHr: true, hrTrack: true },
  });
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('POST /api/sessions/[id]/watch-file (issue #562)', () => {
  it('previews what the file holds and writes nothing', async () => {
    const { user, session } = await seedLifter('watch-preview@test.dev');
    actAs(user.id);
    const before = await untouched(user.id, session.id);

    const res = await attach(session.id, { format: 'tcx', file: LEGS_TCX, mode: 'preview' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: 'preview',
      avgHr: 118,
      maxHr: 165,
      startedAt: '2026-06-10T07:30:00.000Z',
      durationSec: 2400,
      // The watch was started two minutes after the session.
      offsetMinutes: 2,
      farFromSession: false,
      replaces: false,
    });

    expect(await heartRateOf(session.id)).toEqual({ avgHr: null, maxHr: null, hrTrack: null });
    expect(await untouched(user.id, session.id)).toEqual(before);
  });

  it('stores the heart rate on confirm and creates no session, set or exercise', async () => {
    const { user, session } = await seedLifter('watch-confirm@test.dev');
    actAs(user.id);
    const before = await untouched(user.id, session.id);

    const res = await attach(session.id, { format: 'tcx', file: LEGS_TCX, mode: 'confirm' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      mode: 'confirm',
      avgHr: 118,
      maxHr: 165,
      replaces: false,
    });

    expect(await heartRateOf(session.id)).toEqual({
      avgHr: 118,
      maxHr: 165,
      hrTrack: LEGS_TRACK,
    });
    // Sets, dates, notes and the row counts are exactly as before.
    expect(await untouched(user.id, session.id)).toEqual(before);
  });

  it('replaces a previous attachment and says so in the preview', async () => {
    const { user, session } = await seedLifter('watch-replace@test.dev');
    actAs(user.id);
    await attach(session.id, { format: 'tcx', file: LEGS_TCX, mode: 'confirm' });

    const preview = await attach(session.id, { format: 'gpx', file: HR_GPX, mode: 'preview' });
    expect(await preview.json()).toMatchObject({ replaces: true, avgHr: 130, maxHr: 150 });
    // The preview left the first attachment in place.
    expect((await heartRateOf(session.id)).avgHr).toBe(118);

    const res = await attach(session.id, { format: 'gpx', file: HR_GPX, mode: 'confirm' });
    expect(res.status).toBe(200);
    // GPX states no peak: it comes from the track. Nothing of the TCX remains.
    expect(await heartRateOf(session.id)).toEqual({
      avgHr: 130,
      maxHr: 150,
      hrTrack: [
        { t: 0, hr: 100 },
        { t: 60, hr: 140 },
        { t: 120, hr: 150 },
      ],
    });
  });

  it('clears the previous curve when the new file has only summary values', async () => {
    const { user, session } = await seedLifter('watch-summary@test.dev');
    actAs(user.id);
    await attach(session.id, { format: 'tcx', file: LEGS_TCX, mode: 'confirm' });

    const res = await attach(session.id, { format: 'fit', file: RUN_FIT, mode: 'confirm' });
    expect(res.status).toBe(200);
    expect(await heartRateOf(session.id)).toEqual({ avgHr: 150, maxHr: 175, hrTrack: null });
  });

  it('warns without blocking when the recording is far from the session', async () => {
    const { user, session } = await seedLifter('watch-far@test.dev');
    actAs(user.id);

    // The FIT fixture was recorded in March, the session is in June.
    const preview = await attach(session.id, { format: 'fit', file: RUN_FIT, mode: 'preview' });
    const body = await preview.json();
    expect(body.farFromSession).toBe(true);
    expect(body.offsetMinutes).toBeLessThan(-6 * 60);

    const res = await attach(session.id, { format: 'fit', file: RUN_FIT, mode: 'confirm' });
    expect(res.status).toBe(200);
    expect((await heartRateOf(session.id)).avgHr).toBe(150);
  });

  it('refuses a file without heart rate with a clear message', async () => {
    const { user, session } = await seedLifter('watch-nohr@test.dev');
    actAs(user.id);

    for (const mode of ['preview', 'confirm']) {
      const res = await attach(session.id, { format: 'gpx', file: NO_HR_GPX, mode });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'This file has no heart rate data.' });
    }
    expect(await heartRateOf(session.id)).toEqual({ avgHr: null, maxHr: null, hrTrack: null });
  });

  it('refuses an unreadable file', async () => {
    const { user, session } = await seedLifter('watch-junk@test.dev');
    actAs(user.id);

    const res = await attach(session.id, { format: 'tcx', file: 'not xml', mode: 'confirm' });
    expect(res.status).toBe(400);
    expect(await heartRateOf(session.id)).toEqual({ avgHr: null, maxHr: null, hrTrack: null });
  });

  it('rejects an invalid body', async () => {
    const { user, session } = await seedLifter('watch-invalid@test.dev');
    actAs(user.id);

    for (const body of [
      { format: 'csv', file: LEGS_TCX, mode: 'preview' },
      { format: 'tcx', file: LEGS_TCX, mode: 'apply' },
      { format: 'tcx', file: '', mode: 'preview' },
      { format: 'tcx', mode: 'preview' },
      { file: LEGS_TCX, mode: 'preview' },
    ]) {
      const res = await attach(session.id, body);
      expect(res.status).toBe(400);
    }
    const notJson = await postWatchFile(
      new Request(`http://test.local/api/sessions/${session.id}/watch-file`, {
        method: 'POST',
        body: '{not json',
      }),
      params(session.id),
    );
    expect(notJson.status).toBe(400);
    expect(await heartRateOf(session.id)).toEqual({ avgHr: null, maxHr: null, hrTrack: null });
  });

  it("answers 404 for a stranger's session and for an unknown id, writing nothing", async () => {
    const { session } = await seedLifter('watch-owner@test.dev');
    const stranger = await db.user.create({
      data: { email: 'watch-stranger@test.dev', passwordHash: 'x' },
    });
    actAs(stranger.id);

    for (const mode of ['preview', 'confirm']) {
      const res = await attach(session.id, { format: 'tcx', file: LEGS_TCX, mode });
      expect(res.status).toBe(404);
    }
    const unknown = await attach('does-not-exist', {
      format: 'tcx',
      file: LEGS_TCX,
      mode: 'confirm',
    });
    expect(unknown.status).toBe(404);
    expect(await heartRateOf(session.id)).toEqual({ avgHr: null, maxHr: null, hrTrack: null });
  });

  it('answers 401 without a signed-in user', async () => {
    const { session } = await seedLifter('watch-anon@test.dev');
    mockUserId.mockResolvedValue(null);

    const res = await attach(session.id, { format: 'tcx', file: LEGS_TCX, mode: 'confirm' });
    expect(res.status).toBe(401);
    expect((await remove(session.id)).status).toBe(401);
  });

  it('draws on the shared import rate bucket', async () => {
    const { user, session } = await seedLifter('watch-rate@test.dev');
    actAs(user.id);

    for (let i = 0; i < 10; i++) {
      const res = await attach(session.id, { format: 'tcx', file: LEGS_TCX, mode: 'preview' });
      expect(res.status).toBe(200);
    }
    const limited = await attach(session.id, { format: 'tcx', file: LEGS_TCX, mode: 'preview' });
    expect(limited.status).toBe(429);
  });
});

describe('DELETE /api/sessions/[id]/watch-file (issue #562)', () => {
  it('clears the three columns and leaves the session alone', async () => {
    const { user, session } = await seedLifter('watch-remove@test.dev');
    actAs(user.id);
    const before = await untouched(user.id, session.id);
    await attach(session.id, { format: 'tcx', file: LEGS_TCX, mode: 'confirm' });
    expect((await heartRateOf(session.id)).avgHr).toBe(118);

    const res = await remove(session.id);
    expect(res.status).toBe(200);
    expect(await heartRateOf(session.id)).toEqual({ avgHr: null, maxHr: null, hrTrack: null });
    expect(await untouched(user.id, session.id)).toEqual(before);
  });

  it("answers 404 for a stranger's session and keeps the owner's heart rate", async () => {
    const { user, session } = await seedLifter('watch-remove-owner@test.dev');
    actAs(user.id);
    await attach(session.id, { format: 'tcx', file: LEGS_TCX, mode: 'confirm' });

    const stranger = await db.user.create({
      data: { email: 'watch-remove-stranger@test.dev', passwordHash: 'x' },
    });
    actAs(stranger.id);
    expect((await remove(session.id)).status).toBe(404);
    expect((await remove('does-not-exist')).status).toBe(404);
    expect(await heartRateOf(session.id)).toEqual({
      avgHr: 118,
      maxHr: 165,
      hrTrack: LEGS_TRACK,
    });
  });
});

describe('buildCoachPayload session heart rate (issue #562)', () => {
  async function thisWeekSession(email: string, heartRate: { avgHr?: number; maxHr?: number }) {
    const user = await db.user.create({ data: { email, passwordHash: 'x' } });
    const squat = await db.exercise.create({
      data: { userId: user.id, name: 'Squat', muscleGroup: 'QUADS', category: 'COMPOUND' },
    });
    // No startedAt: the session starts now, inside the current ISO week.
    const session = await db.session.create({ data: { userId: user.id, ...heartRate } });
    await db.set.create({
      data: { sessionId: session.id, exerciseId: squat.id, setNumber: 1, weight: 100, reps: 5 },
    });
    return { user, session };
  }

  it('carries avgHr and maxHr on the session entry of the week', async () => {
    const { user, session } = await thisWeekSession('coach-hr@test.dev', {
      avgHr: 118,
      maxHr: 165,
    });

    const payload = await buildCoachPayload(user.id);
    const entry = payload.weekCurrent.sessions.find((s) => s.sessionId === session.id);
    expect(entry).toMatchObject({ avgHr: 118, maxHr: 165, workingSetCount: 1 });
    // Session-level only: no heart rate leaks into the per-set entries.
    expect(Object.keys(entry!.exercises[0]!.sets[0]!)).not.toContain('avgHr');
  });

  it('omits both keys for a session without heart rate (payload unchanged)', async () => {
    const { user, session } = await thisWeekSession('coach-nohr@test.dev', {});

    const payload = await buildCoachPayload(user.id);
    const entry = payload.weekCurrent.sessions.find((s) => s.sessionId === session.id)!;
    expect(Object.keys(entry)).toEqual([
      'sessionId',
      'workoutName',
      'startedAt',
      'finishedAt',
      'durationMin',
      'notes',
      'totalVolume',
      'workingSetCount',
      'exercises',
    ]);
  });

  it('carries only the value that is present', async () => {
    const { user, session } = await thisWeekSession('coach-avg-only@test.dev', { avgHr: 121 });

    const payload = await buildCoachPayload(user.id);
    const entry = payload.weekCurrent.sessions.find((s) => s.sessionId === session.id)!;
    expect(entry.avgHr).toBe(121);
    expect('maxHr' in entry).toBe(false);
  });
});
