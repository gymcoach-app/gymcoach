import { NextResponse } from 'next/server';
import type { Exercise, Prisma, Set } from '@/lib/prisma-client';
import { db } from '@/lib/db';
import { setCreateSchema, validateSetForCategory } from '@/lib/schemas/set';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { setAchievesGoal } from '@/lib/goals';
import { effectiveWeight } from '@/lib/stats';
import { resolveSetEquipmentSnapshot } from '@/lib/set-equipment';
import { effectiveSetBlock } from '@/lib/exercise-blocks';
import { addedSetCompletedAt } from '@/lib/session-edit';
import {
  lockExerciseGoal,
  rederiveGoalAchievement,
  runSerializableSetTransaction,
} from '@/lib/goal-achievement';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/sessions/[id]/sets: records a set in a session.
//
// A finished session only takes a set from a request that says `amend: true`
// (the history editor, issue #389). The live logger and its offline queue
// never send it, so a set queued offline is still refused once its session
// was finished. An amended set is not stamped "now": it is dated inside the
// session (lib/session-edit.ts), or it would become the latest performance of
// its exercise whatever the date of the session.
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();

    // Scoped reads (issue #317): ownership is part of each query, not a
    // separate comparison that a later edit could drop.
    const session = await db.session.findFirst({ where: { id: params.id, userId } });
    if (!session) {
      throw new ApiError(404, 'Session not found.');
    }
    const data = await parseJsonBody(req, setCreateSchema);
    const amend = data.amend === true;
    if (session.finishedAt && !amend) {
      throw new ApiError(400, 'Session already finished.');
    }
    if (!session.finishedAt && amend) {
      throw new ApiError(409, 'This session is still in progress.');
    }

    // Validation: the exercise must belong to the user.
    const exercise = await db.exercise.findFirst({
      where: { id: data.exerciseId, userId },
    });
    if (!exercise) {
      throw new ApiError(400, 'Invalid exercise.');
    }

    // Cardio cross-field rule (issue #133): duration/distance only on CARDIO
    // exercises, and a cardio set requires a duration.
    const categoryError = validateSetForCategory(exercise.category, data);
    if (categoryError) {
      throw new ApiError(400, categoryError);
    }
    const isCardio = exercise.category === 'CARDIO';

    // Block of a repeated exercise (issue #429): stored only when the
    // session's workout holds this exercise more than once, normalized into
    // range, so a single-occurrence exercise always stores NULL as before.
    const occurrences = session.workoutId
      ? await db.programExercise.count({
          // Ownership in the query scope itself (issue #317): the session is
          // the user's, and so must the workout whose rows are counted.
          where: {
            workoutId: session.workoutId,
            exerciseId: data.exerciseId,
            workout: { program: { userId } },
          },
        })
      : 0;
    const block = occurrences > 1 ? effectiveSetBlock(data.block, occurrences) : null;

    const finishedAt = session.finishedAt;
    const created = await (finishedAt ? runSerializableSetTransaction : runLiveTransaction)(async (tx) => {
      const canonicalWeight = isCardio ? 0 : data.weight;
      // Amending a finished session: date the set inside the session and
      // re-derive the goal in the same transaction, since a set dated in the
      // past may achieve a goal earlier than the set that stamped it.
      let completedAt: Date | undefined;
      if (finishedAt) {
        await lockExerciseGoal(tx, userId, data.exerciseId);
        const lastSet = await tx.set.findFirst({
          where: { sessionId: session.id, session: { userId } },
          orderBy: { completedAt: 'desc' },
          select: { completedAt: true },
        });
        completedAt = addedSetCompletedAt({
          startedAt: session.startedAt,
          finishedAt,
          lastSetAt: lastSet?.completedAt ?? null,
        });
      }
      const equipmentSnapshot = await resolveSetEquipmentSnapshot(tx, {
        userId,
        sessionGymId: session.gymId,
        exerciseId: data.exerciseId,
        gymEquipmentId: data.gymEquipmentId,
      });
      const row = await tx.set.create({
        data: {
          ...(completedAt ? { completedAt } : {}),
          sessionId: params.id,
          exerciseId: data.exerciseId,
          ...equipmentSnapshot,
          setNumber: data.setNumber,
          // Cardio sets store weight = 0 / reps = 1 by convention (the columns
          // are NOT NULL); the UI never shows them for CARDIO exercises.
          weight: canonicalWeight,
          reps: isCardio ? 1 : data.reps,
          rir: isCardio ? null : (data.rir ?? null),
          durationSec: isCardio ? data.durationSec : null,
          distanceM: isCardio ? (data.distanceM ?? null) : null,
          avgHr: isCardio ? (data.avgHr ?? null) : null,
          maxHr: isCardio ? (data.maxHr ?? null) : null,
          notes: data.notes ?? null,
          isWarmup: data.isWarmup ?? false,
          isDropSet: data.isDropSet ?? false,
          block,
        },
      });
      if (finishedAt) {
        await rederiveGoalAchievement(tx, userId, data.exerciseId, true);
      }
      return row;
    });
    if (finishedAt) {
      return NextResponse.json(created, { status: 201 });
    }
    // Best-effort: the set is already committed, so a failure here must never
    // fail the request (a 500 would make the offline sync retry the POST and
    // duplicate the set). An unstamped goal self-heals on the next achieving
    // set or on goal re-creation, which re-derives achievedAt from history.
    try {
      await stampGoalIfAchieved(userId, exercise, created);
    } catch (stampErr) {
      console.error('[api] goal achievement stamping failed:', stampErr);
    }

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

// The live path keeps its plain transaction (default isolation, no retry).
function runLiveTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(operation);
}

// Per-exercise goal (issue #90): when a freshly logged working set meets an
// unachieved goal's target, stamp achievedAt with the set's completedAt
// (deterministic - the same instant the goal-creation path would derive).
// Comparison runs on the effective load (bodyweight + added load for
// bodyweight exercises), consistent with lib/stats.
async function stampGoalIfAchieved(userId: string, exercise: Exercise, set: Set): Promise<void> {
  if (set.isWarmup) return;
  const goal = await db.exerciseGoal.findUnique({
    where: { userId_exerciseId: { userId, exerciseId: exercise.id } },
  });
  if (!goal || goal.achievedAt) return;

  let weight = set.weight;
  if (exercise.usesBodyweight) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { bodyweight: true },
    });
    weight = effectiveWeight(set.weight, true, user?.bodyweight);
  }
  if (setAchievesGoal({ weight, reps: set.reps, isWarmup: set.isWarmup }, goal)) {
    await db.exerciseGoal.update({
      where: { id: goal.id },
      data: { achievedAt: set.completedAt },
    });
  }
}
