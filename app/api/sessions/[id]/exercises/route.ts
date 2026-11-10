import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessionExerciseInputSchema } from '@/lib/schemas/session';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { requireOpenFreestyleSession } from '@/lib/freestyle-session';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/exercises: adds an exercise to a freestyle session
// (issue #388). The list belongs to the session alone, so no saved program
// changes. The order is computed automatically.
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    await requireOpenFreestyleSession(params.id, userId);
    const data = await parseJsonBody(req, sessionExerciseInputSchema);

    // The exercise must belong to the user too.
    const exercise = await db.exercise.findFirst({
      where: { id: data.exerciseId, userId },
      select: { id: true },
    });
    if (!exercise) {
      throw new ApiError(400, 'Invalid exercise.');
    }

    // One row per exercise, as in a workout (issue #379): a Set carries only
    // an exerciseId, so two rows of the same exercise would share one set pool.
    const duplicate = await db.sessionExercise.findFirst({
      where: { sessionId: params.id, exerciseId: data.exerciseId, session: { userId } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError(409, 'That exercise is already in this session.');
    }

    const last = await db.sessionExercise.findFirst({
      where: { sessionId: params.id, session: { userId } },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const created = await db.sessionExercise.create({
      data: {
        sessionId: params.id,
        exerciseId: data.exerciseId,
        order: (last?.order ?? 0) + 1,
        targetSets: data.targetSets,
        targetRepsMin: data.targetRepsMin,
        targetRepsMax: data.targetRepsMax,
        targetRIR: data.targetRIR,
        restSec: data.restSec,
      },
      include: { exercise: true },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
