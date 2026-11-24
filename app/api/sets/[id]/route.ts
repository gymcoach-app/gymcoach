import { NextResponse } from 'next/server';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { setPatchSchema } from '@/lib/schemas/set';
import {
  lockExerciseGoal,
  lockOwnedSession,
  rederiveGoalAchievement,
  runSerializableSetTransaction,
} from '@/lib/goal-achievement';

interface Params {
  params: Promise<{ id: string }>;
}

// PATCH /api/sets/[id]: correct a logged set in place.
//
// In a session in progress this is the live table's inline edit: weight, reps
// and RIR of a strength set, nothing else. A finished session is only changed
// by a request that says `amend: true` (the history editor, issue #389), which
// may also change the set type and, on a cardio set, its cardio fields. The
// live logger and its offline queue never send the flag, so they are refused
// on a finished session exactly as before.
export async function PATCH(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const data = await parseJsonBody(req, setPatchSchema);

    const amend = data.amend === true;
    const updated = await runSerializableSetTransaction(async (tx) => {
      // An amend write takes the session's row lock first, like every write
      // that edits a finished session (lock order: session, set, goal), so it
      // never interleaves with a move of that session.
      if (amend) {
        const owned = await tx.set.findFirst({
          where: { id: params.id, session: { userId } },
          select: { sessionId: true },
        });
        if (!owned) throw new ApiError(404, 'Set not found.');
        await lockOwnedSession(tx, userId, owned.sessionId);
      }
      // Serialize same-set mutations first, then serialize goal re-derivation
      // for the exercise. The set values and derived achievedAt now commit or
      // roll back together instead of leaving a stale goal after a successful edit.
      await tx.$queryRaw`SELECT "Set".id FROM "Set" JOIN "Session" ON "Session".id = "Set"."sessionId" WHERE "Set".id = ${params.id} AND "Session"."userId" = ${userId} FOR UPDATE OF "Set"`;
      const set = await tx.set.findFirst({
        where: { id: params.id, session: { userId } },
        include: {
          session: { select: { finishedAt: true } },
          exercise: { select: { category: true } },
        },
      });
      if (!set) {
        throw new ApiError(404, 'Set not found.');
      }
      if (set.session.finishedAt && !amend) {
        throw new ApiError(400, 'Session already finished.');
      }
      if (!set.session.finishedAt && amend) {
        throw new ApiError(409, 'This session is still in progress.');
      }

      const isCardio = set.exercise.category === 'CARDIO';
      if ('weight' in data) {
        if (isCardio) {
          throw new ApiError(400, 'Cardio sets cannot be edited with strength fields.');
        }
        await lockExerciseGoal(tx, userId, set.exerciseId);
        const row = await tx.set.update({
          where: { id: set.id, session: { userId } },
          data: {
            weight: data.weight,
            reps: data.reps,
            rir: data.rir,
            ...(amend && data.isWarmup !== undefined ? { isWarmup: data.isWarmup } : {}),
            ...(amend && data.isDropSet !== undefined ? { isDropSet: data.isDropSet } : {}),
          },
        });
        await rederiveGoalAchievement(tx, userId, set.exerciseId, true);
        return row;
      }

      if (!isCardio) {
        throw new ApiError(400, 'A strength set needs a weight and reps.');
      }
      if (!amend) {
        throw new ApiError(400, 'Cardio sets cannot be edited during a session.');
      }
      // Stored like the create route stores a cardio set: weight 0 and reps 1
      // stay as they are, only the cardio fields change. The recorded track
      // of an imported activity (Set.track) is left as it is: the lifter is
      // correcting the summary, and the recording remains what the device saw.
      return tx.set.update({
        where: { id: set.id, session: { userId } },
        data: {
          durationSec: data.durationSec,
          distanceM: data.distanceM ?? null,
          avgHr: data.avgHr ?? null,
          maxHr: data.maxHr ?? null,
          ...(data.isWarmup !== undefined ? { isWarmup: data.isWarmup } : {}),
        },
      });
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/sets/[id]: deletes a set (e.g. an input mistake).
// The user can then re-enter it; value corrections use PATCH above.
export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    await runSerializableSetTransaction(async (tx) => {
      await tx.$queryRaw`SELECT "Set".id FROM "Set" JOIN "Session" ON "Session".id = "Set"."sessionId" WHERE "Set".id = ${params.id} AND "Session"."userId" = ${userId} FOR UPDATE OF "Set"`;
      const set = await tx.set.findFirst({
        where: { id: params.id, session: { userId } },
      });
      if (!set) {
        throw new ApiError(404, 'Set not found.');
      }

      await lockExerciseGoal(tx, userId, set.exerciseId);
      await tx.set.delete({ where: { id: params.id, session: { userId } } });
      await rederiveGoalAchievement(tx, userId, set.exerciseId, false);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
