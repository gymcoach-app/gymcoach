import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { watchFileInputSchema } from '@/lib/schemas/watch-file';
import { readWatchFileDetailed } from '@/lib/import/watch-file';
import { splitHeartRateBySet } from '@/lib/set-heart-rate';
import { Prisma } from '@/prisma/generated/client';

interface Params {
  params: Promise<{ id: string }>;
}

// Streamed body cap: one file of at most 5 MB, base64-inflated for FIT, plus
// the JSON envelope.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

// The preview warns (it never blocks) when the recording starts this far from
// the session: most likely the file of another workout.
const FAR_FROM_SESSION_MS = 6 * 60 * 60 * 1000;

// Ownership is enforced by scoping every query with userId (issue #317): the
// read is itself the check and the writes carry userId in their where, so a
// stranger's or unknown session id yields 404.
const HEART_RATE_SELECT = {
  startedAt: true,
  finishedAt: true,
  avgHr: true,
  maxHr: true,
  hrTrack: true,
} as const;

// Shared "import:" bucket: attaching a file parses the same untrusted formats
// as the cardio imports, so it draws on the same budget.
function chargeImportBucket(userId: string) {
  const rl = rateLimit(`import:${userId}`, 10, 60_000);
  if (!rl.ok) {
    throw new ApiError(429, `Too many import requests. Retry in ${rl.retryAfterSec}s.`);
  }
}

// POST /api/sessions/[id]/watch-file: attach the heart rate of a watch
// recording (FIT, TCX or GPX) to an existing session (issue #562). Mirrors the
// hardened import routes: shared rate bucket, streamed body cap, read-only
// preview, then confirm. Confirm writes avgHr, maxHr and hrTrack on the
// session, replacing a previous attachment; it creates no session, set or
// exercise and never touches the session's dates or notes.
//
// Confirm also splits the full-resolution heart rate of the file over the
// session's sets (issue #576, lib/set-heart-rate.ts) and writes the average
// and peak of each set's window in Set.watchAvgHr / Set.watchMaxHr. Those two
// columns are the only thing it writes on a set: Set.avgHr / Set.maxHr (the
// heart rate the user logged or imported on a cardio set) are never read or
// written here. A replacement first clears what the previous file wrote, so a
// set outside the new recording does not keep a stale value. A set logged
// after the session was finished gets nothing (its log time is not when it
// was done), and sets logged after the file was attached get nothing until a
// file is attached again.
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    chargeImportBucket(userId);

    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      throw new ApiError(413, 'File too large.');
    }

    const data = await parseJsonBody(req, watchFileInputSchema, { maxBytes: MAX_BODY_BYTES });

    const session = await db.session.findFirst({
      where: { id: params.id, userId },
      select: HEART_RATE_SELECT,
    });
    if (!session) throw new ApiError(404, 'Session not found.');

    // The full-resolution samples ride along for the per-set split of confirm;
    // the preview only reports the summary.
    const read = readWatchFileDetailed({ format: data.format, content: data.file });
    if (!read.ok) throw new ApiError(400, read.error);
    const { startedAt, durationSec, avgHr, maxHr, hrTrack } = read.data;

    const offsetMs = startedAt.getTime() - session.startedAt.getTime();
    const summary = {
      avgHr,
      maxHr,
      startedAt: startedAt.toISOString(),
      durationSec,
      // File start minus session start: positive when the watch started later.
      offsetMinutes: Math.round(offsetMs / 60000),
      farFromSession: Math.abs(offsetMs) > FAR_FROM_SESSION_MS,
      replaces: session.avgHr != null || session.maxHr != null || session.hrTrack != null,
    };

    if (data.mode === 'preview') {
      return NextResponse.json({ mode: 'preview', ...summary });
    }

    const { hrSamples } = read;
    const setsWithHeartRate = await db.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: params.id, userId },
        data: {
          avgHr,
          maxHr,
          hrTrack: hrTrack ? (hrTrack as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        },
        select: { id: true },
      });
      // Every set query below carries the session's userId as well.
      const ownSets = { sessionId: params.id, session: { userId } };
      const sets = await tx.set.findMany({
        where: ownSets,
        orderBy: [{ completedAt: 'asc' }, { setNumber: 'asc' }, { id: 'asc' }],
        select: { id: true, completedAt: true },
      });
      const perSet = splitHeartRateBySet({
        sessionStartedAt: session.startedAt,
        sessionFinishedAt: session.finishedAt,
        recordingStartedAt: startedAt,
        samples: hrSamples,
        sets,
      });
      await tx.set.updateMany({
        where: { ...ownSets, OR: [{ watchAvgHr: { not: null } }, { watchMaxHr: { not: null } }] },
        data: { watchAvgHr: null, watchMaxHr: null },
      });
      for (const s of perSet) {
        await tx.set.updateMany({
          where: { ...ownSets, id: s.id },
          data: { watchAvgHr: s.avgHr, watchMaxHr: s.maxHr },
        });
      }
      return perSet.length;
    });
    return NextResponse.json({ mode: 'confirm', ...summary, setsWithHeartRate });
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/sessions/[id]/watch-file: remove the attached heart rate. Only
// what the file wrote is cleared: the three session columns and the per-set
// Set.watchAvgHr / Set.watchMaxHr (issue #576). The heart rate logged on a
// cardio set (Set.avgHr / Set.maxHr) is not the file's and stays.
export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const count = await db.$transaction(async (tx) => {
      const cleared = await tx.session.updateMany({
        where: { id: params.id, userId },
        data: { avgHr: null, maxHr: null, hrTrack: Prisma.DbNull },
      });
      if (cleared.count === 0) return 0;
      await tx.set.updateMany({
        where: {
          sessionId: params.id,
          session: { userId },
          OR: [{ watchAvgHr: { not: null } }, { watchMaxHr: { not: null } }],
        },
        data: { watchAvgHr: null, watchMaxHr: null },
      });
      return cleared.count;
    });
    if (count === 0) throw new ApiError(404, 'Session not found.');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
