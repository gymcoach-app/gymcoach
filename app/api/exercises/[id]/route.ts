import { NextResponse } from 'next/server';
import { Prisma } from '@/prisma/generated/client';
import { db } from '@/lib/db';
import { exerciseFavoriteSchema, exerciseInputSchema } from '@/lib/schemas/exercise';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';

interface Params {
  params: Promise<{ id: string }>;
}

// Ownership is enforced by scoping every query with userId (issue #317):
// the reads that serve the responses are themselves the checks, and the
// writes carry userId in their where, so a stranger's id yields 404.

export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const exercise = await db.exercise.findFirst({ where: { id: params.id, userId } });
    if (!exercise) throw new ApiError(404, 'Exercise not found.');
    return NextResponse.json(exercise);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const data = await parseJsonBody(req, exerciseInputSchema);
    const updated = await db.exercise.update({
      where: { id: params.id, userId },
      data: { ...data, notes: data.notes ?? null },
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

// Star or unstar an exercise (issue #404). Kept apart from PUT so the edit
// form, which does not send it, never resets the flag.
export async function PATCH(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const data = await parseJsonBody(req, exerciseFavoriteSchema);
    const updated = await db.exercise.update({
      where: { id: params.id, userId },
      data: { isFavorite: data.isFavorite },
      select: { id: true, isFavorite: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();

    // Check whether the exercise is used in an active program or in sets.
    // If so, we refuse to avoid breaking the data. The user must first remove
    // the exercise from the programs or create a variant.
    const usage = await db.exercise.findFirst({
      where: { id: params.id, userId },
      select: {
        _count: { select: { programExercises: true, sets: true } },
      },
    });
    if (!usage) throw new ApiError(404, 'Exercise not found.');
    if (usage._count.programExercises > 0 || usage._count.sets > 0) {
      throw new ApiError(
        409,
        'Exercise used in a program or in history. Remove it first.',
      );
    }

    // A freestyle session (issue #388) may still list the exercise without a
    // logged set. That row carries no history, so it goes with the exercise
    // instead of blocking the delete on its foreign key.
    try {
      await db.$transaction([
        db.sessionExercise.deleteMany({
          where: { exerciseId: params.id, session: { userId } },
        }),
        db.exercise.delete({ where: { id: params.id, userId } }),
      ]);
    } catch (err) {
      // A row that came to reference the exercise after the usage check above
      // (a set, a program row or a freestyle list row written concurrently)
      // fails the foreign key: the same refusal as the check, not a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ApiError(409, 'Exercise used in a program or in history. Remove it first.');
      }
      throw err;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
