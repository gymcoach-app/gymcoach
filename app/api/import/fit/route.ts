import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { fitImportInputSchema } from '@/lib/schemas/import';
import { parseFit, fitExerciseName, type FitActivity } from '@/lib/import/fit';
import {
  createCardioSession,
  findSessionStartsNear,
  resolveCardioExercise,
} from '@/lib/import/cardio-session';

// Streamed body cap. Generous enough for a batch of up to FIT_MAX_BATCH files
// (real FIT activity files are tens of KB), while still bounding total work.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

// One activity's summary plus any near-duplicate sessions the user already has.
async function summarize(userId: string, activity: FitActivity) {
  const exerciseName = fitExerciseName(activity.sport);
  const nearDuplicates = await findSessionStartsNear(userId, [activity.startedAt]);
  return {
    sport: activity.sport,
    exerciseName,
    startedAt: activity.startedAt.toISOString(),
    durationSec: activity.durationSec,
    distanceM: activity.distanceM,
    avgHr: activity.avgHr,
    maxHr: activity.maxHr,
    duplicateSessions: nearDuplicates.map((s) => s.toISOString()),
  };
}

// Persist one activity in a single transaction: create (or reuse, ownership-
// scoped) the cardio exercise, the session and its single cardio set.
async function confirmOne(userId: string, activity: FitActivity) {
  const exerciseName = fitExerciseName(activity.sport);
  return db.$transaction(async (tx) => {
    const exercise = await resolveCardioExercise(
      tx,
      userId,
      exerciseName,
      'Created by the FIT import.',
    );
    const { sessionId } = await createCardioSession(
      tx,
      userId,
      exercise.id,
      activity,
      `Imported from a FIT file (${activity.sport}).`,
    );
    return { sessionId, createdExercise: exercise.created };
  });
}

function decodeFit(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// POST /api/import/fit: import one or more Garmin FIT activity files as cardio
// sessions (issues #249, #253). Mirrors the hardened GPX/TCX routes: shared
// import rate bucket, streamed body cap, dry-run preview, transactional confirm.
// Files are untrusted BINARY blobs carried base64-encoded; lib/import/fit.ts
// bounds-checks every offset, verifies the FIT CRC, and bounds every value.
//
// A single file in `fit` keeps the original flat response; a batch in `fits`
// returns one result per file (an unparseable file is skipped, not fatal).
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();

    // Shared "import:" bucket: one charge per request (a batch counts once).
    const rl = rateLimit(`import:${userId}`, 10, 60_000);
    if (!rl.ok) {
      throw new ApiError(429, `Too many import requests. Retry in ${rl.retryAfterSec}s.`);
    }

    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      throw new ApiError(413, 'Files too large.');
    }

    const data = await parseJsonBody(req, fitImportInputSchema, { maxBytes: MAX_BODY_BYTES });

    // ---- Single-file path (original contract, flat response) ----
    if (data.fits === undefined) {
      const parsed = parseFit(decodeFit(data.fit!));
      if (!parsed.ok || !parsed.activity) {
        throw new ApiError(400, parsed.fatalError ?? 'Unreadable file.');
      }
      const summary = await summarize(userId, parsed.activity);
      if (data.mode === 'preview') {
        return NextResponse.json({ mode: 'preview', ...summary });
      }
      const result = await confirmOne(userId, parsed.activity);
      return NextResponse.json({
        mode: 'confirm',
        createdSessions: 1,
        createdSets: 1,
        createdExercises: result.createdExercise ? 1 : 0,
        sessionId: result.sessionId,
        ...summary,
      });
    }

    // ---- Batch path (issue #253): one result per file ----
    const parsedFiles = data.fits.map((b64) => parseFit(decodeFit(b64)));

    if (data.mode === 'preview') {
      const activities = await Promise.all(
        parsedFiles.map(async (p, index) =>
          p.ok && p.activity
            ? { index, ok: true as const, ...(await summarize(userId, p.activity)) }
            : { index, ok: false as const, error: p.fatalError ?? 'Unreadable file.' },
        ),
      );
      return NextResponse.json({
        mode: 'preview',
        activities,
        importable: activities.filter((a) => a.ok).length,
        skipped: activities.filter((a) => !a.ok).length,
      });
    }

    // Confirm: import every file that parsed; a single file that fails never
    // blocks the rest (each is its own transaction, so earlier files stay
    // committed). An unparseable file, or a per-file domain conflict (e.g. the
    // default name collides with a non-cardio exercise -> ApiError 409), is
    // counted as skipped rather than failing the whole batch. A SYSTEMIC error
    // (DB down, etc.) is re-thrown so the request fails honestly.
    let createdSessions = 0;
    let createdExercises = 0;
    let skipped = 0;
    for (const p of parsedFiles) {
      if (!p.ok || !p.activity) {
        skipped += 1;
        continue;
      }
      try {
        const result = await confirmOne(userId, p.activity);
        createdSessions += 1;
        if (result.createdExercise) createdExercises += 1;
      } catch (err) {
        if (err instanceof ApiError) {
          skipped += 1;
          continue;
        }
        throw err;
      }
    }
    return NextResponse.json({
      mode: 'confirm',
      createdSessions,
      createdSets: createdSessions,
      createdExercises,
      skipped,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
