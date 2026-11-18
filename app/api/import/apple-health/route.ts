import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { appleHealthImportInputSchema, type AppleHealthImportInput } from '@/lib/schemas/import';
import {
  appleHealthExerciseName,
  appleHealthLocalDayKey,
  appleHealthLocalDayStart,
} from '@/lib/import/apple-health';
import {
  createCardioSession,
  findSessionStartsNear,
  hasStartNear,
  resolveCardioExercise,
} from '@/lib/import/cardio-session';
import { mutateBodyweightHistory } from '@/lib/bodyweight-record';
import type { Prisma } from '@/prisma/generated/client';

// Streamed body cap. A full batch (500 workouts and 1000 body weight entries
// of well under 200 bytes each) is around 150 KB.
const MAX_BODY_BYTES = 512 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;

type Workout = AppleHealthImportInput['workouts'][number];
type BodyMass = AppleHealthImportInput['bodyMass'][number];

// Split a batch into the workouts to import and the ones to leave out because
// a session of this user already starts within the duplicate window (the same
// 2 minutes as the FIT/TCX/GPX imports). The window also applies inside the
// batch: Apple Health often holds one effort twice, once from the watch and
// once from an app that synced it.
async function planWorkouts(userId: string, workouts: Workout[]) {
  const sorted = [...workouts].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const known = (
    await findSessionStartsNear(
      userId,
      sorted.map((w) => w.startedAt),
    )
  ).map((d) => d.getTime());
  const fresh: Workout[] = [];
  let duplicates = 0;
  for (const workout of sorted) {
    const at = workout.startedAt.getTime();
    if (hasStartNear(known, at)) {
      duplicates += 1;
    } else {
      known.push(at);
      fresh.push(workout);
    }
  }
  return { fresh, duplicates };
}

// Split a batch of body weight entries into the ones to add and the ones on a
// day that already has an entry. One entry per day inside the batch too.
//
// "Day" is the entry's own local day, read in the UTC offset its Apple
// timestamp was written in. An entry sent without an offset is read in UTC.
//
// - Inside the batch, two entries are on the same day when their local
//   calendar dates are equal, each read in its own offset
//   (appleHealthLocalDayKey). The offset of an export can change from one
//   entry to the next (daylight saving time, a trip east): 23:30 +0100 on
//   March 30th and 08:00 +0200 on the 31st are two days, although the first
//   instant falls inside the 24 hours of the second one's local day.
// - A stored entry has no offset of its own. When this batch holds an entry
//   at the very same instant, the stored one is that measurement, imported
//   earlier: it sits on that entry's local date, so importing the same export
//   twice finds every entry again and nothing else.
// - Any other stored entry (a manual weigh-in, typically) is placed on the
//   calendar of the entry it is compared with: it makes that entry a
//   duplicate when its instant falls in the 24 hours from the entry's local
//   midnight (appleHealthLocalDayStart). So a manual weigh-in of the same
//   local evening is found. The cost of not knowing its offset: a stored
//   entry within the hour or two of an offset change, whose own measurement
//   is not in this batch, can still take the neighbouring day.
async function planBodyMass(
  client: Prisma.TransactionClient | typeof db,
  userId: string,
  entries: BodyMass[],
) {
  if (entries.length === 0) return { fresh: [] as BodyMass[], duplicates: 0 };
  const sorted = [...entries].sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
  const first = sorted[0]!.measuredAt.getTime();
  const last = sorted[sorted.length - 1]!.measuredAt.getTime();
  // A local day starts at most 24 h before its entry and ends at most 24 h
  // after it, whatever the offset.
  const existing = await client.bodyweightEntry.findMany({
    where: {
      userId,
      measuredAt: { gt: new Date(first - DAY_MS), lt: new Date(last + DAY_MS) },
    },
    select: { measuredAt: true },
    orderBy: { measuredAt: 'asc' },
  });
  const offsetAt = new Map<number, number>();
  for (const entry of sorted) {
    const at = entry.measuredAt.getTime();
    if (!offsetAt.has(at)) offsetAt.set(at, entry.utcOffsetMin);
  }
  // Local dates already taken, by a stored entry of a known offset or by an
  // entry accepted earlier in this batch; and the stored instants (ascending)
  // whose offset is unknown.
  const takenDays = new Set<string>();
  const others: number[] = [];
  for (const { measuredAt } of existing) {
    const utcOffsetMin = offsetAt.get(measuredAt.getTime());
    if (utcOffsetMin === undefined) others.push(measuredAt.getTime());
    else takenDays.add(appleHealthLocalDayKey({ measuredAt, utcOffsetMin }));
  }
  const fresh: BodyMass[] = [];
  let duplicates = 0;
  for (const entry of sorted) {
    const day = appleHealthLocalDayKey(entry);
    const dayStart = appleHealthLocalDayStart(entry.measuredAt.getTime(), entry.utcOffsetMin);
    if (takenDays.has(day) || hasInstantIn(others, dayStart, dayStart + DAY_MS)) {
      duplicates += 1;
    } else {
      takenDays.add(day);
      fresh.push(entry);
    }
  }
  return { fresh, duplicates };
}

// True when the ascending list holds an instant in [from, to).
function hasInstantIn(sorted: readonly number[], from: number, to: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < from) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo]! < to;
}

// POST /api/import/apple-health: import the cardio workouts (and optionally
// the body weight entries) of an Apple Health export (issue #582).
//
// The export is read and reduced in the browser; this route only ever sees
// normalized summaries, a bounded batch at a time. It mirrors the hardened
// FIT route: shared import rate bucket, streamed body cap, Zod-validated
// input, dry-run preview, owner-scoped writes. Unlike a single watch file, an
// export always repeats the whole history, so confirm skips the duplicates
// the preview counted instead of only warning about them: importing a newer
// export adds the new workouts and nothing else.
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();

    // Shared "import:" bucket: one charge per request (a batch counts once).
    // The client sends several batches in a row, so the 429 tells it how long
    // to wait before the next one.
    const rl = rateLimit(`import:${userId}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: `Too many import requests. Retry in ${rl.retryAfterSec}s.`,
          retryAfterSec: rl.retryAfterSec,
        },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }

    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      throw new ApiError(413, 'Batch too large.');
    }

    const data = await parseJsonBody(req, appleHealthImportInputSchema, {
      maxBytes: MAX_BODY_BYTES,
    });

    const { fresh, duplicates } = await planWorkouts(userId, data.workouts);
    const names = [...new Set(fresh.map((w) => appleHealthExerciseName(w.activityType)))];

    if (data.mode === 'preview') {
      // A default name the user already gave to a non-cardio exercise cannot
      // be reused (cardio fields are never written onto it): say so up front.
      const blocked = new Set(
        names.length === 0
          ? []
          : (
              await db.exercise.findMany({
                where: { userId, name: { in: names }, category: { not: 'CARDIO' } },
                select: { name: true },
              })
            ).map((e) => e.name),
      );
      const counts = new Map<string, number>();
      let conflicts = 0;
      for (const workout of fresh) {
        const name = appleHealthExerciseName(workout.activityType);
        if (blocked.has(name)) conflicts += 1;
        else counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const bodyMass = await planBodyMass(db, userId, data.bodyMass);
      return NextResponse.json({
        mode: 'preview',
        workouts: {
          importable: fresh.length - conflicts,
          duplicates,
          conflicts,
          byExercise: [...counts.entries()]
            .map(([exerciseName, count]) => ({ exerciseName, count }))
            .sort((a, b) => b.count - a.count || a.exerciseName.localeCompare(b.exerciseName)),
        },
        bodyMass: { importable: bodyMass.fresh.length, duplicates: bodyMass.duplicates },
      });
    }

    // Confirm. Resolve each exercise name once (created on first use); a name
    // taken by a non-cardio exercise (ApiError 409) skips its workouts without
    // failing the batch. A systemic error is re-thrown so the request fails
    // honestly; sessions already created stay (each is its own atomic write),
    // and a retry skips them as duplicates.
    const exerciseIds = new Map<string, string | null>();
    let createdExercises = 0;
    for (const name of names) {
      try {
        const exercise = await resolveCardioExercise(
          db,
          userId,
          name,
          'Created by the Apple Health import.',
        );
        exerciseIds.set(name, exercise.id);
        if (exercise.created) createdExercises += 1;
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        exerciseIds.set(name, null);
      }
    }

    let createdSessions = 0;
    let skippedConflicts = 0;
    for (const workout of fresh) {
      const exerciseId = exerciseIds.get(appleHealthExerciseName(workout.activityType));
      if (!exerciseId) {
        skippedConflicts += 1;
        continue;
      }
      await createCardioSession(
        db,
        userId,
        exerciseId,
        workout,
        `Imported from Apple Health (${workout.activityType}).`,
      );
      createdSessions += 1;
    }

    // Body weight goes through the shared history mutation: it locks the user
    // row (so the same-day check and the insert cannot race another write) and
    // re-syncs User.bodyweight to the newest entry afterwards.
    let bodyMass = { created: 0, duplicates: 0 };
    if (data.bodyMass.length > 0) {
      const { result } = await mutateBodyweightHistory(userId, async (tx) => {
        const plan = await planBodyMass(tx, userId, data.bodyMass);
        if (plan.fresh.length > 0) {
          await tx.bodyweightEntry.createMany({
            data: plan.fresh.map((entry) => ({
              userId,
              weightKg: entry.weightKg,
              measuredAt: entry.measuredAt,
              note: 'Imported from Apple Health.',
            })),
          });
        }
        return { created: plan.fresh.length, duplicates: plan.duplicates };
      });
      bodyMass = result;
    }

    return NextResponse.json({
      mode: 'confirm',
      createdSessions,
      createdSets: createdSessions,
      createdExercises,
      skippedDuplicates: duplicates,
      skippedConflicts,
      bodyMass,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
