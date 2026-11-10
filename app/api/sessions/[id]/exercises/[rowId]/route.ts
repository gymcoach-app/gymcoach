import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessionExerciseInputSchema } from '@/lib/schemas/session';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { requireOpenFreestyleSession } from '@/lib/freestyle-session';

interface Params {
  params: Promise<{ id: string; rowId: string }>;
}

// Ownership is part of every query (issue #317): the row is looked up through
// its session and the session through its user, so a stranger's ids yield 404.

// PUT /api/sessions/[id]/exercises/[rowId]: replaces the exercise (and its
// targets) on one row of a freestyle session (issue #388). The row keeps its
// place in the list.
export async function PUT(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    await requireOpenFreestyleSession(params.id, userId);
    const row = await db.sessionExercise.findFirst({
      where: { id: params.rowId, sessionId: params.id, session: { userId } },
      select: { id: true },
    });
    if (!row) throw new ApiError(404, 'Session exercise not found.');

    const data = await parseJsonBody(req, sessionExerciseInputSchema);
    const exercise = await db.exercise.findFirst({
      where: { id: data.exerciseId, userId },
      select: { id: true },
    });
    if (!exercise) {
      throw new ApiError(400, 'Invalid exercise.');
    }
    const duplicate = await db.sessionExercise.findFirst({
      where: {
        sessionId: params.id,
        exerciseId: data.exerciseId,
        id: { not: params.rowId },
        session: { userId },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError(409, 'That exercise is already in this session.');
    }

    const updated = await db.sessionExercise.update({
      where: { id: params.rowId, sessionId: params.id, session: { userId } },
      data: {
        exerciseId: data.exerciseId,
        targetSets: data.targetSets,
        targetRepsMin: data.targetRepsMin,
        targetRepsMax: data.targetRepsMax,
        targetRIR: data.targetRIR,
        restSec: data.restSec,
      },
      include: { exercise: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/sessions/[id]/exercises/[rowId]: takes an exercise off a
// freestyle session's list. Sets already logged stay in the session.
export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    await requireOpenFreestyleSession(params.id, userId);
    const removed = await db.sessionExercise.deleteMany({
      where: { id: params.rowId, sessionId: params.id, session: { userId } },
    });
    if (removed.count === 0) throw new ApiError(404, 'Session exercise not found.');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
