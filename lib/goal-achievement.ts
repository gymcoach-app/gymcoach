import { db } from '@/lib/db';
import type { Prisma } from '@/lib/prisma-client';
import { findAchievingSet, setAchievesGoal } from '@/lib/goals';
import { effectiveWeight } from '@/lib/stats';
import { isTransactionWriteConflict } from '@/lib/tx-conflict';

// ExerciseGoal.achievedAt is the one record the app stores instead of reading
// it back from the sets, so every write that changes a set's values, type or
// timestamp re-derives it here, in the same transaction as the write (set
// edits and deletes, and since issue #389 the edits of a finished session).

// Under serializable isolation a writer that queued behind another one on a
// row lock is not simply let through: Postgres fails it and asks for a retry.
// So N writers of one session need up to N attempts, one of them getting
// through each round. Eight covers a burst of edits from one screen, and the
// short growing pause keeps the retries from colliding again at once.
const MAX_SERIALIZABLE_ATTEMPTS = 8;
const RETRY_PAUSE_MS = 15;

export async function runSerializableSetTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: 'Serializable',
        ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
      });
    } catch (err) {
      if (!isTransactionWriteConflict(err) || attempt === MAX_SERIALIZABLE_ATTEMPTS) throw err;
      const pauseMs = RETRY_PAUSE_MS * attempt * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }

  throw new Error('Serializable set transaction retry exhausted.');
}

// Row lock on a session the caller owns, shared by every write that edits a
// FINISHED session (issue #389): the timing edit and the amend set writes.
// Whoever holds it reads a session window that cannot move under them, so a
// set is never dated inside a window another request is replacing. Returns
// the row as it is under the lock, or null when it is not the caller's.
// Always taken before any set or goal lock, so two writers cannot deadlock.
export async function lockOwnedSession(
  tx: Prisma.TransactionClient,
  userId: string,
  sessionId: string,
): Promise<{ id: string; startedAt: Date; finishedAt: Date | null } | null> {
  await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${sessionId} AND "userId" = ${userId} FOR UPDATE`;
  return tx.session.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, startedAt: true, finishedAt: true },
  });
}

export interface MovedSet {
  weight: number;
  reps: number;
  isWarmup: boolean;
  /** Set.completedAt before and after the session moved. */
  from: Date;
  to: Date;
}

// A session that only MOVES in time (issue #389) changes when its sets were
// done, not what they were. So the goal is not judged again: it is never
// cleared, never newly achieved, and today's bodyweight plays no part.
// Only the date follows:
// - the set that stamped the goal moved: the date moves with it, unless
//   another working set of the exercise that meets the target on its own
//   logged weight now comes first, in which case that one dates the goal;
// - a moved set that meets the target on its logged weight now comes before
//   the date: the goal was achieved then.
//
// The stamping set is the moved working set logged at the stamped instant
// that could have achieved the goal: enough reps, and enough logged weight
// unless the exercise adds the lifter's bodyweight (unknown for that day).
// Called after the sets were updated, in the same transaction.
export async function shiftGoalAchievementForMove(
  tx: Prisma.TransactionClient,
  userId: string,
  exerciseId: string,
  moved: readonly MovedSet[],
): Promise<void> {
  const goal = await tx.exerciseGoal.findUnique({
    where: { userId_exerciseId: { userId, exerciseId } },
  });
  if (!goal?.achievedAt) return;
  const stampedAt = goal.achievedAt.getTime();

  const exercise = await tx.exercise.findFirst({
    where: { id: exerciseId, userId },
    select: { usesBodyweight: true },
  });
  if (!exercise) return;
  const stamping = moved.find(
    (set) =>
      set.from.getTime() === stampedAt &&
      !set.isWarmup &&
      set.reps >= goal.targetReps &&
      (exercise.usesBodyweight || set.weight >= goal.targetWeight),
  );

  let achievedAt = stampedAt;
  if (stamping) {
    achievedAt = stamping.to.getTime();
    const earliestLogged = await tx.set.findFirst({
      where: {
        exerciseId,
        isWarmup: false,
        weight: { gte: goal.targetWeight },
        reps: { gte: goal.targetReps },
        session: { userId },
      },
      orderBy: { completedAt: 'asc' },
      select: { completedAt: true },
    });
    if (earliestLogged && earliestLogged.completedAt.getTime() < achievedAt) {
      achievedAt = earliestLogged.completedAt.getTime();
    }
  }
  for (const set of moved) {
    if (setAchievesGoal(set, goal) && set.to.getTime() < achievedAt) {
      achievedAt = set.to.getTime();
    }
  }
  if (achievedAt !== stampedAt) {
    await tx.exerciseGoal.update({
      where: { id: goal.id },
      data: { achievedAt: new Date(achievedAt) },
    });
  }
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
