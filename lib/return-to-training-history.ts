import type {
  Exercise,
  Gym,
  GymExerciseConfig,
  MuscleGroup,
  ProgramExercise,
} from '@/lib/prisma-client';
import { db } from '@/lib/db';
import {
  blockIndexByRow,
  blockSetWhere,
  occurrenceCounts,
  rowBlockKey,
} from '@/lib/exercise-blocks';
import type { GymLoadConstraints } from '@/lib/gym-loads';
import {
  BASELINE_MUSCLE_VOLUME_DAYS,
  calculateReturnRecommendation,
  isRecentReturnSession,
  RECENT_MUSCLE_VOLUME_DAYS,
  RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT,
  RETURN_RECENT_SESSION_LIMIT,
  type ReturnHistorySession,
  type ReturnRecommendation,
  type ReturnTrainingHistory,
} from '@/lib/return-to-training';

type ProgramExerciseForReturn = Pick<
  ProgramExercise,
  'id' | 'exerciseId' | 'targetSets' | 'targetRepsMin' | 'targetRIR'
> & {
  // Row position in the workout, used to rank the blocks of a repeated
  // exercise (issue #429). Callers without it pass the rows in workout order.
  order?: number;
  exercise: Pick<Exercise, 'category' | 'equipmentType' | 'usesBodyweight' | 'muscleGroup'>;
};

type GymForReturn = Pick<Gym, 'dumbbellWeights' | 'plateWeights' | 'barWeights'> & {
  exerciseConfigs: Pick<GymExerciseConfig, 'exerciseId' | 'isAvailable' | 'weightOptions'>[];
};

interface ReturnRecommendationQuery {
  userId: string;
  programExercises: ProgramExerciseForReturn[];
  excludeSessionId: string | null;
  now: Date;
  bodyweight?: number | null;
  gym?: GymForReturn | null;
}

interface BoundedExerciseHistory {
  lastPerformedAt: Date | null;
  sessions: ReturnHistorySession[];
}

// Detailed load anchors older than ten years are intentionally ignored. The
// latest-performance lookup remains unbounded and indexed, so an older real
// performance still activates return calibration; it simply falls back to a
// conservative load instead of mining an arbitrarily large history.
export const RETURN_HISTORY_LOOKBACK_DAYS = 3650;

// Builds session-only return recommendations. Nothing is persisted to the
// program: the active runner applies these targets while this session is open.
export async function getReturnToTrainingRecommendations({
  userId,
  programExercises,
  excludeSessionId,
  now,
  bodyweight = null,
  gym = null,
}: ReturnRecommendationQuery): Promise<Record<string, ReturnRecommendation>> {
  if (programExercises.length === 0) return {};

  // One history per block of a deliberately repeated exercise (issue #475):
  // a 5x10 Boring But Big row anchors on past 5x10 sets, not on the heavy
  // 5/3/1 sets of the same lift, like getLastPerformances. An exercise the
  // workout holds once keeps a single per-exercise history, keyed by its bare
  // exerciseId exactly as before.
  const rowBlocks = blockIndexByRow(
    programExercises.map((pe, index) => ({
      id: pe.id,
      exerciseId: pe.exerciseId,
      order: pe.order ?? index,
    })),
  );
  const counts = occurrenceCounts(programExercises);
  const lookups = new Map<string, { exerciseId: string; block: number | null }>();
  for (const pe of programExercises) {
    const key = rowBlockKey(pe, rowBlocks);
    if (!lookups.has(key)) {
      lookups.set(key, { exerciseId: pe.exerciseId, block: rowBlocks.get(pe.id) ?? null });
    }
  }
  const muscleGroups = [...new Set(programExercises.map((item) => item.exercise.muscleGroup))];
  const excludedSession = excludeSessionId ? { id: { not: excludeSessionId } } : {};
  const historyStart = new Date(now.getTime() - RETURN_HISTORY_LOOKBACK_DAYS * 86_400_000);
  const baselineStart = new Date(
    now.getTime() - (RECENT_MUSCLE_VOLUME_DAYS + BASELINE_MUSCLE_VOLUME_DAYS) * 86_400_000,
  );
  const recentStart = new Date(now.getTime() - RECENT_MUSCLE_VOLUME_DAYS * 86_400_000);

  const [exerciseEntries, muscleLatestEntries, volumeRows] = await Promise.all([
    Promise.all(
      [...lookups].map(async ([key, { exerciseId, block }]) => {
        const workingSetFilter = {
          exerciseId,
          isWarmup: false,
          isDropSet: false,
          reps: { gt: 0 },
          weight: { gte: 0 },
          completedAt: { lt: now },
        } as const;
        // The anchor sessions read only this block's sets. The latest-set
        // lookup stays per exercise: how long ago the movement was trained
        // is the same for every block of it.
        const blockSetFilter = {
          ...workingSetFilter,
          ...(block == null ? {} : blockSetWhere(block, counts.get(exerciseId))),
        };

        // Both queries are bounded in what they return. The indexed latest-set
        // lookup preserves knowledge of arbitrarily old real exercise history,
        // while only the newest sessions needed by the anchor algorithm are
        // loaded with their sets: every session inside the recent exact window
        // (up to RETURN_RECENT_SESSION_LIMIT of them) plus the long-term pool.
        // The read fetches both budgets together and splits below, so a few
        // recent sessions no longer displace long-term anchors; more recent
        // sessions than the recent budget still squeeze the long-term pool,
        // which is accepted (see RETURN_RECENT_SESSION_LIMIT).
        const [latestSet, sessions] = await Promise.all([
          db.set.findFirst({
            where: {
              ...workingSetFilter,
              session: { userId, finishedAt: { not: null }, ...excludedSession },
            },
            orderBy: { completedAt: 'desc' },
            select: { session: { select: { startedAt: true } } },
          }),
          db.session.findMany({
            where: {
              userId,
              finishedAt: { not: null },
              ...excludedSession,
              startedAt: { gte: historyStart, lt: now },
              sets: { some: blockSetFilter },
            },
            orderBy: { startedAt: 'desc' },
            take: RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT + RETURN_RECENT_SESSION_LIMIT,
            select: {
              id: true,
              startedAt: true,
              sets: {
                where: blockSetFilter,
                orderBy: { setNumber: 'asc' },
                select: {
                  setNumber: true,
                  weight: true,
                  reps: true,
                  rir: true,
                  isDropSet: true,
                },
              },
            },
          }),
        ]);

        const recentSessions = sessions.filter((session) =>
          isRecentReturnSession(session.startedAt, now),
        );
        const longTermSessions = sessions
          .filter((session) => !isRecentReturnSession(session.startedAt, now))
          .slice(0, RETURN_LONG_TERM_ANCHOR_SESSION_LIMIT);
        const history: BoundedExerciseHistory = {
          lastPerformedAt: latestSet?.session.startedAt ?? null,
          sessions: [...recentSessions, ...longTermSessions].map((session) => ({
            sessionId: session.id,
            performedAt: session.startedAt,
            sets: session.sets.map(({ weight, reps, rir, isDropSet }) => ({
              weight,
              reps,
              rir,
              isDropSet,
            })),
          })),
        };
        return [key, history] as const;
      }),
    ),
    Promise.all(
      muscleGroups.map(async (muscleGroup) => {
        const row = await db.set.findFirst({
          where: {
            isWarmup: false,
            isDropSet: false,
            reps: { gt: 0 },
            completedAt: { lt: now },
            session: { userId, finishedAt: { not: null }, ...excludedSession },
            exercise: { muscleGroup, category: { not: 'CARDIO' } },
          },
          orderBy: { completedAt: 'desc' },
          select: { session: { select: { startedAt: true } } },
        });
        return [muscleGroup, row?.session.startedAt ?? null] as const;
      }),
    ),
    db.set.findMany({
      where: {
        isWarmup: false,
        isDropSet: false,
        reps: { gt: 0 },
        completedAt: { gte: baselineStart, lt: now },
        session: { userId, finishedAt: { not: null }, ...excludedSession },
        exercise: {
          muscleGroup: { in: muscleGroups },
          category: { not: 'CARDIO' },
        },
      },
      select: {
        completedAt: true,
        exercise: { select: { muscleGroup: true } },
      },
    }),
  ]);

  const historiesByExercise = new Map<string, ReturnTrainingHistory>();
  const latestByMuscle = new Map<MuscleGroup, Date | null>(muscleLatestEntries);
  const recentSetsByMuscle = new Map<MuscleGroup, number>();
  const baselineSetsByMuscle = new Map<MuscleGroup, number>();

  for (const row of volumeRows) {
    const target = row.completedAt >= recentStart ? recentSetsByMuscle : baselineSetsByMuscle;
    const group = row.exercise.muscleGroup;
    target.set(group, (target.get(group) ?? 0) + 1);
  }

  const exerciseHistory = new Map<string, BoundedExerciseHistory>(exerciseEntries);
  for (const pe of programExercises) {
    const key = rowBlockKey(pe, rowBlocks);
    if (historiesByExercise.has(key)) continue;
    const history = exerciseHistory.get(key) ?? { lastPerformedAt: null, sessions: [] };
    const baselineSets = baselineSetsByMuscle.get(pe.exercise.muscleGroup) ?? 0;
    historiesByExercise.set(key, {
      exerciseLastPerformedAt: history.lastPerformedAt,
      muscleLastPerformedAt: latestByMuscle.get(pe.exercise.muscleGroup) ?? null,
      recentMuscleSets: recentSetsByMuscle.get(pe.exercise.muscleGroup) ?? 0,
      baselineMuscleSetsPer28Days:
        baselineSets * (RECENT_MUSCLE_VOLUME_DAYS / BASELINE_MUSCLE_VOLUME_DAYS),
      exerciseSessions: history.sessions,
    });
  }

  return Object.fromEntries(
    programExercises.map((pe) => [
      pe.id,
      calculateReturnRecommendation({
        programExercise: pe,
        history: historiesByExercise.get(rowBlockKey(pe, rowBlocks))!,
        now,
        bodyweight,
        loadConstraints: loadConstraintsFor(pe, gym),
      }),
    ]),
  );
}

function loadConstraintsFor(
  pe: ProgramExerciseForReturn,
  gym: GymForReturn | null,
): GymLoadConstraints | null {
  if (!gym) return null;
  const config = gym.exerciseConfigs.find((item) => item.exerciseId === pe.exerciseId);
  return {
    equipmentType: pe.exercise.equipmentType,
    isAvailable: config?.isAvailable ?? true,
    dumbbellWeights: gym.dumbbellWeights,
    plateWeights: gym.plateWeights,
    barWeights: gym.barWeights,
    weightOptions: config?.weightOptions ?? [],
  };
}
