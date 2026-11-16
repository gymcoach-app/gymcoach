import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workoutOrderInputSchema } from '@/lib/schemas/workout';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';

interface Params {
  params: Promise<{ id: string }>;
}

// PUT /api/workouts/[id]/order (issue #557): saves a new order for the
// exercises of one workout. The body is the complete list of the workout's
// ProgramExercise ids, top to bottom; each row gets order 1..n.
//
// The list must be exactly a permutation of the workout's current rows. A
// missing, extra, duplicated or foreign id (another workout's, another
// user's, unknown) is a 400 and nothing is written, so a client holding a
// stale list cannot corrupt the order - it reloads and tries again.
export async function PUT(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    // Scoped existence probe (issue #317): a stranger's or unknown workout id
    // is a 404 before any 400 about the body.
    const workout = await db.workout.findFirst({
      where: { id: params.id, program: { userId } },
      select: { id: true },
    });
    if (!workout) throw new ApiError(404, 'Session not found.');

    const { programExerciseIds } = await parseJsonBody(req, workoutOrderInputSchema);

    await db.$transaction(async (tx) => {
      // Read inside the transaction, with the ownership scope repeated, so the
      // check and the writes see the same rows.
      const rows = await tx.programExercise.findMany({
        where: { workoutId: params.id, workout: { program: { userId } } },
        select: { id: true },
      });
      const current = new Set(rows.map((row) => row.id));
      const requested = new Set(programExerciseIds);
      const isPermutation =
        programExerciseIds.length === rows.length &&
        requested.size === rows.length &&
        programExerciseIds.every((id) => current.has(id));
      if (!isPermutation) {
        throw new ApiError(400, 'The exercise list does not match this workout. Reload and retry.');
      }

      // Rows are written in id order, not list order, so two concurrent
      // reorders of one workout take their row locks in the same sequence and
      // cannot deadlock; the last one to commit wins as a whole.
      const position = new Map(programExerciseIds.map((id, index) => [id, index + 1]));
      for (const id of [...programExerciseIds].sort()) {
        await tx.programExercise.update({
          where: { id, workoutId: params.id, workout: { program: { userId } } },
          data: { order: position.get(id)! },
        });
      }
    });

    return NextResponse.json({ ok: true, programExerciseIds });
  } catch (err) {
    return handleApiError(err);
  }
}
