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

// ============================================================
// Heart rate per set (issue #576)
// ============================================================
// On confirm the heart rate of the file is split over the session's sets by
// their log time and stored in Set.watchAvgHr / watchMaxHr. The heart rate a
// user logged on a cardio set (Set.avgHr / maxHr) is never touched, and
// DELETE clears only what the file wrote.

const tcxPoint = (time: string, hr: number) =>
  `<Trackpoint><Time>${time}</Time><HeartRateBpm><Value>${hr}</Value></HeartRateBpm></Trackpoint>`;
const tcxFile = (lapInner: string) =>
  `<?xml version="1.0"?><TrainingCenterDatabase><Activities>` +
  `<Activity Sport="Other"><Id>2026-06-10T07:30:00.000Z</Id>` +
  `<Lap StartTime="2026-06-10T07:30:00.000Z"><TotalTimeSeconds>2400</TotalTimeSeconds>` +
  `${lapInner}</Lap></Activity></Activities></TrainingCenterDatabase>`;

// Six samples over the session, no summary values.
const SETS_TCX = tcxFile(
  `<Track>` +
    tcxPoint('2026-06-10T07:30:00.000Z', 95) +
    tcxPoint('2026-06-10T07:33:00.000Z', 110) +
    tcxPoint('2026-06-10T07:35:00.000Z', 130) +
    tcxPoint('2026-06-10T07:40:00.000Z', 165) +
    tcxPoint('2026-06-10T07:44:00.000Z', 150) +
    tcxPoint('2026-06-10T07:50:00.000Z', 120) +
    `</Track>`,
);

const clock = (hhmm: string) => new Date(`2026-06-10T${hhmm}:00.000Z`);

// A session (07:28 to 08:15) with two squat sets, one rowing interval the
// user logged WITH a heart rate, a third squat set and a last one logged
// after the recording ended.
async function seedTimedSession(email: string) {
  const user = await db.user.create({ data: { email, passwordHash: 'x' } });
  const squat = await db.exercise.create({
    data: { userId: user.id, name: 'Squat', muscleGroup: 'QUADS', category: 'COMPOUND' },
  });
  const rower = await db.exercise.create({
    data: { userId: user.id, name: 'Rower', muscleGroup: 'OTHER', category: 'CARDIO' },
  });
  const session = await db.session.create({
    data: { userId: user.id, startedAt: SESSION_START, finishedAt: SESSION_END },
  });
  const lift = { sessionId: session.id, exerciseId: squat.id, weight: 100, reps: 5 };
  await db.set.createMany({
    data: [
      { ...lift, setNumber: 1, completedAt: clock('07:35') },
      { ...lift, setNumber: 2, completedAt: clock('07:42') },
      {
        sessionId: session.id,
        exerciseId: rower.id,
        setNumber: 1,
        weight: 0,
        reps: 0,
        durationSec: 300,
        distanceM: 1200,
        avgHr: 140,
        maxHr: 155,
        completedAt: clock('07:48'),
      },
      { ...lift, setNumber: 3, completedAt: clock('08:10') },
      { ...lift, setNumber: 4, completedAt: clock('08:12') },
    ],
  });
  return { user, session, squat, rower };
}

// The heart rate columns of every set of a session, in log order.
async function setHeartRates(sessionId: string) {
  const sets = await db.set.findMany({
    where: { sessionId },
    orderBy: { completedAt: 'asc' },
    select: { avgHr: true, maxHr: true, watchAvgHr: true, watchMaxHr: true },
  });
  return sets.map((s) => [s.avgHr, s.maxHr, s.watchAvgHr, s.watchMaxHr]);
}

// Every set column the feature must leave alone.
async function setsWithoutWatchColumns(sessionId: string) {
  const sets = await db.set.findMany({ where: { sessionId }, orderBy: { completedAt: 'asc' } });
  return sets.map((row) => {
    const copy: Record<string, unknown> = { ...row };
    delete copy.watchAvgHr;
    delete copy.watchMaxHr;
    return copy;
  });
}

const SPLIT = [
  // [07:28, 07:35]: 95, 110, 130 -> 111.67 -> 112.
  [null, null, 112, 130],
  // (07:35, 07:42]: 165.
  [null, null, 165, 165],
  // (07:42, 07:48]: 150. The logged 140 / 155 stay.
  [140, 155, 150, 150],
  // (07:48, 08:10]: 120.
  [null, null, 120, 120],
  // (08:10, 08:12]: nothing recorded.
  [null, null, null, null],
];

// The same sets without a file: only what the user logged.
const WITHOUT_FILE = SPLIT.map(([avg, max]) => [avg, max, null, null]);

describe('heart rate per set on confirm (issue #576)', () => {
  it('writes nothing on the sets in preview', async () => {
    const { user, session } = await seedTimedSession('set-hr-preview@test.dev');
    actAs(user.id);
    const before = await db.set.findMany({ where: { sessionId: session.id } });

    const res = await attach(session.id, { format: 'tcx', file: SETS_TCX, mode: 'preview' });
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty('setsWithHeartRate');
    expect(await db.set.findMany({ where: { sessionId: session.id } })).toEqual(before);
  });

  it('gives each set its window and leaves the logged cardio heart rate', async () => {
    const { user, session } = await seedTimedSession('set-hr-confirm@test.dev');
    actAs(user.id);
    const before = await setsWithoutWatchColumns(session.id);

    const res = await attach(session.id, { format: 'tcx', file: SETS_TCX, mode: 'confirm' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: 'confirm', maxHr: 165, setsWithHeartRate: 4 });

    expect(await setHeartRates(session.id)).toEqual(SPLIT);
    // Nothing else on any set moved: weight, reps, cardio values, log time.
    expect(await setsWithoutWatchColumns(session.id)).toEqual(before);
    expect(await db.set.count({ where: { session: { userId: user.id } } })).toBe(5);
  });

  it('gives nothing to sets entered after the session was finished', async () => {
    // seedLifter logs its two sets now, months after the session of June 10.
    const { user, session } = await seedLifter('set-hr-entered-later@test.dev');
    actAs(user.id);

    const res = await attach(session.id, { format: 'tcx', file: SETS_TCX, mode: 'confirm' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ maxHr: 165, setsWithHeartRate: 0 });
    expect(await setHeartRates(session.id)).toEqual([
      [null, null, null, null],
      [null, null, null, null],
    ]);
  });

  it('clears what a previous file wrote when the new one does not cover a set', async () => {
    const { user, session } = await seedTimedSession('set-hr-replace@test.dev');
    actAs(user.id);
    await attach(session.id, { format: 'tcx', file: SETS_TCX, mode: 'confirm' });

    // Three samples, 07:31 to 07:33: only the first set's window holds any.
    const res = await attach(session.id, { format: 'gpx', file: HR_GPX, mode: 'confirm' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ replaces: true, setsWithHeartRate: 1 });
    expect(await setHeartRates(session.id)).toEqual([
      [null, null, 130, 150],
      [null, null, null, null],
      [140, 155, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ]);
  });

  it('clears the per-set values when the new file has no samples', async () => {
    const { user, session } = await seedTimedSession('set-hr-summary-only@test.dev');
    actAs(user.id);
    await attach(session.id, { format: 'tcx', file: SETS_TCX, mode: 'confirm' });

    const res = await attach(session.id, { format: 'fit', file: RUN_FIT, mode: 'confirm' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ setsWithHeartRate: 0 });
    expect(await setHeartRates(session.id)).toEqual(WITHOUT_FILE);
  });

  it('takes the session peak from every sample, not from the stored curve', async () => {
    const { user, session } = await seedTimedSession('set-hr-peak@test.dev');
    actAs(user.id);
    // 1500 one-second samples at 110 bpm with one spike to 188 at 07:41:40,
    // a second the stored curve (one point out of three) does not keep.
    const start = Date.parse('2026-06-10T07:30:00.000Z');
    let points = '';
    for (let i = 0; i < 1500; i++) {
      points += tcxPoint(new Date(start + i * 1000).toISOString(), i === 700 ? 188 : 110);
    }

    const res = await attach(session.id, {
      format: 'tcx',
      file: tcxFile(`<Track>${points}</Track>`),
      mode: 'confirm',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ maxHr: 188 });

    const stored = await heartRateOf(session.id);
    expect(stored.maxHr).toBe(188);
    const track = stored.hrTrack as Array<{ t: number; hr: number }>;
    expect(Math.max(...track.map((p) => p.hr))).toBe(110);
    // The set whose window holds the spike (07:35 to 07:42) has it as well.
    const rates = await setHeartRates(session.id);
    expect(rates[0]).toEqual([null, null, 110, 110]);
    expect(rates[1]![3]).toBe(188);
  });

  it("writes nothing on a stranger's sets", async () => {
    const { session } = await seedTimedSession('set-hr-owner@test.dev');
    const stranger = await db.user.create({
      data: { email: 'set-hr-stranger@test.dev', passwordHash: 'x' },
    });
    actAs(stranger.id);
    const before = await db.set.findMany({ where: { sessionId: session.id } });

    const res = await attach(session.id, { format: 'tcx', file: SETS_TCX, mode: 'confirm' });
    expect(res.status).toBe(404);
    expect(await db.set.findMany({ where: { sessionId: session.id } })).toEqual(before);
  });

  it("leaves the user's other sessions alone", async () => {
    const { user, session, squat } = await seedTimedSession('set-hr-other-session@test.dev');
    // Another session of the same user at the same time of day, already
    // carrying per-set values from its own file.
    const other = await db.session.create({
      data: { userId: user.id, startedAt: SESSION_START, finishedAt: SESSION_END },
    });
    await db.set.create({
      data: {
        sessionId: other.id,
        exerciseId: squat.id,
        setNumber: 1,
        weight: 60,
        reps: 8,
        completedAt: clock('07:36'),
        watchAvgHr: 101,
        watchMaxHr: 122,
      },
    });
    actAs(user.id);

    await attach(session.id, { format: 'tcx', file: SETS_TCX, mode: 'confirm' });
    expect(await setHeartRates(other.id)).toEqual([[null, null, 101, 122]]);
    await remove(session.id);
    expect(await setHeartRates(other.id)).toEqual([[null, null, 101, 122]]);
  });
});

describe('DELETE clears only what the file wrote (issue #576)', () => {
  it('clears the per-set values and keeps the heart rate logged on a cardio set', async () => {
    const { user, session } = await seedTimedSession('set-hr-remove@test.dev');
    actAs(user.id);
    const before = await db.set.findMany({
      where: { sessionId: session.id },
      orderBy: { completedAt: 'asc' },
    });
    await attach(session.id, { format: 'tcx', file: SETS_TCX, mode: 'confirm' });
    expect(await setHeartRates(session.id)).toEqual(SPLIT);

    const res = await remove(session.id);
    expect(res.status).toBe(200);
    expect(await setHeartRates(session.id)).toEqual(WITHOUT_FILE);
    // Every set is back to exactly what it was before the file was attached.
    expect(
      await db.set.findMany({ where: { sessionId: session.id }, orderBy: { completedAt: 'asc' } }),
    ).toEqual(before);
  });

  it("keeps the owner's per-set values when a stranger asks", async () => {
    const { user, session } = await seedTimedSession('set-hr-remove-owner@test.dev');
    actAs(user.id);
    await attach(session.id, { format: 'tcx', file: SETS_TCX, mode: 'confirm' });

    const stranger = await db.user.create({
      data: { email: 'set-hr-remove-stranger@test.dev', passwordHash: 'x' },
    });
    actAs(stranger.id);
    expect((await remove(session.id)).status).toBe(404);
    expect(await setHeartRates(session.id)).toEqual(SPLIT);
  });
});

describe('buildCoachPayload heart rate per set (issue #576)', () => {
  const SET_KEYS = ['setNumber', 'weight', 'reps', 'rir', 'isWarmup', 'isDropSet', 'notes'];

  // A session of the current week: two squat sets and one rowing interval
  // with a logged heart rate.
  async function thisWeek(email: string) {
    const user = await db.user.create({ data: { email, passwordHash: 'x' } });
    const squat = await db.exercise.create({
      data: { userId: user.id, name: 'Squat', muscleGroup: 'QUADS', category: 'COMPOUND' },
    });
    const rower = await db.exercise.create({
      data: { userId: user.id, name: 'Rower', muscleGroup: 'OTHER', category: 'CARDIO' },
    });
    const session = await db.session.create({ data: { userId: user.id } });
    const lift = { sessionId: session.id, exerciseId: squat.id, weight: 100, reps: 5 };
    const first = await db.set.create({ data: { ...lift, setNumber: 1 } });
    const second = await db.set.create({ data: { ...lift, setNumber: 2 } });
    const row = await db.set.create({
      data: {
        sessionId: session.id,
        exerciseId: rower.id,
        setNumber: 1,
        weight: 0,
        reps: 0,
        durationSec: 600,
        distanceM: 2000,
        avgHr: 140,
        maxHr: 155,
      },
    });
    return { user, session, first, second, row };
  }

  it('carries avgHr and maxHr on a set that has them, and only on that set', async () => {
    const { user, session, first } = await thisWeek('coach-set-hr@test.dev');
    await db.set.update({ where: { id: first.id }, data: { watchAvgHr: 131, watchMaxHr: 150 } });

    const payload = await buildCoachPayload(user.id);
    const entry = payload.weekCurrent.sessions.find((s) => s.sessionId === session.id)!;
    const sets = entry.exercises[0]!.sets;
    expect(sets[0]).toMatchObject({ setNumber: 1, avgHr: 131, maxHr: 150 });
    expect(Object.keys(sets[0]!)).toEqual([...SET_KEYS, 'avgHr', 'maxHr']);
    expect(Object.keys(sets[1]!)).toEqual(SET_KEYS);
  });

  it('keeps the payload identical for a session without per-set heart rate', async () => {
    const { user, session } = await thisWeek('coach-set-nohr@test.dev');

    const payload = await buildCoachPayload(user.id);
    const entry = payload.weekCurrent.sessions.find((s) => s.sessionId === session.id)!;
    // The logged heart rate of the rowing interval is not a per-set value of
    // the strength summary: cardio sets are not listed there at all.
    expect(entry.exercises.map((e) => e.exerciseName)).toEqual(['Squat']);
    for (const set of entry.exercises[0]!.sets) expect(Object.keys(set)).toEqual(SET_KEYS);
  });

  it('does not change the conditioning numbers', async () => {
    const { user, first, second, row } = await thisWeek('coach-set-conditioning@test.dev');
    const before = await buildCoachPayload(user.id);
    expect(before.conditioning).toBeTruthy();

    // What a confirm would write, on the strength sets and on the cardio set.
    for (const id of [first.id, second.id, row.id]) {
      await db.set.update({ where: { id }, data: { watchAvgHr: 171, watchMaxHr: 190 } });
    }
    const after = await buildCoachPayload(user.id);
    expect(after.conditioning).toEqual(before.conditioning);
    expect(JSON.stringify(after.conditioning)).not.toContain('171');
    expect(JSON.stringify(after.conditioning)).not.toContain('190');
  });
});
