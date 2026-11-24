import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { pastSessionSchema } from '@/lib/schemas/session';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { endsInFuture } from '@/lib/session-edit';
import { rateLimit } from '@/lib/rate-limit';

const PAST_SESSIONS_PER_MINUTE = 30;

// POST /api/sessions/past: logs a workout that already happened (issue #389),
// on one of the user's workouts or as a freestyle session.
//
// The session is created FINISHED, with the start and the duration the lifter
// gave, so it is never the "session in progress" of the home page and it never
// resumes, replaces or closes one: unlike POST /api/sessions, this route does
// not look at the unfinished sessions at all. Its sets are then entered
// through the history editor (`amend: true` on the set routes).
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();
    // Generous for a person entering old workouts one by one, small enough
    // that a script cannot fill a history with empty sessions.
    const rl = rateLimit(`past-session:${userId}`, PAST_SESSIONS_PER_MINUTE, 60_000);
    if (!rl.ok) {
      throw new ApiError(429, `Too many workouts logged. Retry in ${rl.retryAfterSec}s.`);
    }
    const data = await parseJsonBody(req, pastSessionSchema);

    const finishedAt = new Date(data.startedAt.getTime() + data.durationMin * 60 * 1000);
    if (endsInFuture(finishedAt, new Date())) {
      throw new ApiError(400, 'A session cannot be in the future.');
    }

    const workout = data.workoutId
      ? await db.workout.findFirst({
          where: { id: data.workoutId, program: { userId } },
          select: { id: true, programId: true },
        })
      : null;
    if (data.workoutId && !workout) {
      throw new ApiError(404, 'Session not found.');
    }

    // Same gym rule as a live start: the one given, else the active gym.
    const selectedGymId =
      data.gymId ??
      (await db.user.findUnique({ where: { id: userId }, select: { activeGymId: true } }))
        ?.activeGymId ??
      null;
    if (selectedGymId) {
      const gym = await db.gym.findFirst({
        where: { id: selectedGymId, userId },
        select: { id: true },
      });
      if (!gym) throw new ApiError(400, 'Invalid gym.');
    }

    const created = await db.session.create({
      data: {
        userId,
        workoutId: workout?.id ?? null,
        programId: workout?.programId ?? null,
        freestyle: !workout,
        gymId: selectedGymId,
        startedAt: data.startedAt,
        finishedAt,
      },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
