import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessionStartSchema } from '@/lib/schemas/session';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';

export async function GET() {
  try {
    const userId = await requireApiUserId();
    const sessions = await db.session.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      include: {
        workout: { select: { name: true } },
        program: { select: { name: true } },
        _count: { select: { sets: true } },
      },
      take: 50,
    });
    return NextResponse.json(sessions);
  } catch (err) {
    return handleApiError(err);
  }
}

// POST /api/sessions: starts a new session on one of the user's workouts, or a
// freestyle session when no workout is given (issue #388).
// Returns the unfinished session that already exists on the same workout
// instead of creating a second one (avoids zombie sessions created by a
// double-click); a freestyle start resumes the unfinished freestyle session.
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();
    const { workoutId, gymId } = await parseJsonBody(req, sessionStartSchema);

    const workout = workoutId
      ? await db.workout.findFirst({
          where: { id: workoutId, program: { userId } },
        })
      : null;
    if (workoutId && !workout) {
      throw new ApiError(404, 'Session not found.');
    }

    const selectedGymId =
      gymId ??
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

    // A freestyle start matches only a session without a workout and without
    // a program. A session whose workout was removed from a program that still
    // exists keeps its programId, so it is not picked up here.
    const inProgress = await db.session.findFirst({
      where: workout
        ? { userId, workoutId: workout.id, finishedAt: null }
        : { userId, workoutId: null, programId: null, finishedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (inProgress) {
      // We return the existing session instead of creating a new one:
      // allows resuming cleanly after a reload.
      return NextResponse.json(inProgress, { status: 200 });
    }

    const created = await db.session.create({
      data: {
        userId,
        workoutId: workout?.id ?? null,
        programId: workout?.programId ?? null,
        gymId: selectedGymId,
      },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
