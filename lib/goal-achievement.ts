import { db } from '@/lib/db';
import type { Prisma } from '@/lib/prisma-client';
import { findAchievingSet } from '@/lib/goals';
import { effectiveWeight } from '@/lib/stats';

// ExerciseGoal.achievedAt is the one record the app stores instead of reading
// it back from the sets, so every write that changes a set's values, type or
// timestamp re-derives it here, in the same transaction as the write (set
// edits and deletes, and since issue #389 the edits of a finished session).

const MAX_SERIALIZABLE_ATTEMPTS = 3;

export async function runSerializableSetTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (err) {
      const isWriteConflict =
        typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2034';
      if (!isWriteConflict || attempt === MAX_SERIALIZABLE_ATTEMPTS) throw err;
    }
  }

  throw new Error('Serializable set transaction retry exhausted.');
}

export async function lockExerciseGoal(
  tx: Prisma.TransactionClient,
  userId: string,
  exerciseId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "ExerciseGoal" WHERE "userId" = ${userId} AND "exerciseId" = ${exerciseId} FOR UPDATE`;
}

// A deleted set may have been the one that stamped the exercise's goal as
// achieved (issue #96). Re-derive achievedAt from the remaining sets: clear it
// when nothing meets the target anymore, or re-stamp it with the earliest
// remaining achieving set. Comparison runs on the effective load, consistent
// with the stamping path and lib/stats.
export async function rederiveGoalAchievement(
  tx: Prisma.TransactionClient,
  userId: string,
  exerciseId: string,
  allowAchievement: boolean,
): Promise<void> {
  const goal = await tx.exerciseGoal.findUnique({
    where: { userId_exerciseId: { userId, exerciseId } },
  });
  if (!goal || (!allowAchievement && !goal.achievedAt)) return;

  const [exercise, sets] = await Promise.all([
    tx.exercise.findFirst({
      where: { id: exerciseId, userId },
      select: { usesBodyweight: true },
    }),
    tx.set.findMany({
      where: { exerciseId, isWarmup: false, session: { userId } },
      select: { weight: true, reps: true, isWarmup: true, completedAt: true },
    }),
  ]);
  if (!exercise) return;

  let bodyweight: number | null = null;
  if (exercise.usesBodyweight) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { bodyweight: true },
    });
    bodyweight = user?.bodyweight ?? null;
  }

  const achieving = findAchievingSet(
    sets.map((s) => ({
      ...s,
      weight: effectiveWeight(s.weight, exercise.usesBodyweight, bodyweight),
    })),
    goal,
  );
  const achievedAt = achieving?.completedAt ?? null;
  if (achievedAt?.getTime() !== goal.achievedAt?.getTime()) {
    await tx.exerciseGoal.update({
      where: { id: goal.id },
      data: { achievedAt },
    });
  }
}
