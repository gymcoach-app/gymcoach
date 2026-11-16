import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { watchFileInputSchema } from '@/lib/schemas/watch-file';
import { readWatchFile } from '@/lib/import/watch-file';
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
// exercise and never touches the session's sets, dates or notes.
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

    const read = readWatchFile({ format: data.format, content: data.file });
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

    await db.session.update({
      where: { id: params.id, userId },
      data: {
        avgHr,
        maxHr,
        hrTrack: hrTrack ? (hrTrack as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
      select: { id: true },
    });
    return NextResponse.json({ mode: 'confirm', ...summary });
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/sessions/[id]/watch-file: remove the attached heart rate. Only
// the three columns are cleared; the session itself is untouched.
export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const { count } = await db.session.updateMany({
      where: { id: params.id, userId },
      data: { avgHr: null, maxHr: null, hrTrack: Prisma.DbNull },
    });
    if (count === 0) throw new ApiError(404, 'Session not found.');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
