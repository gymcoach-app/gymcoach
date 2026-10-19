import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { getLastPerformances, type LastPerformance } from '@/lib/last-performance';
import { READINESS_RECENCY_HOURS, type ReadinessSignal } from '@/lib/progression';
import { isDeloadActive } from '@/lib/deload';
import { getReturnToTrainingRecommendations } from '@/lib/return-to-training-history';
import { SessionRunner, type SerializedLastPerformance } from '@/components/session/session-runner';
import { liveSessionGymInclude } from '@/lib/session-gym-selection';
import { blockIndexByRow } from '@/lib/exercise-blocks';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ programExerciseId?: string }>;
}

export default async function SessionRunPage(props: Props) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const auth = await requireSession();

  const session = await db.session.findFirst({
    where: { id: params.id, userId: auth.userId },
    include: {
      workout: {
        include: {
          program: { select: { id: true, name: true } },
          exercises: {
            orderBy: { order: 'asc' },
            include: { exercise: true },
          },
        },
      },
      sets: { orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }] },
      gym: { include: liveSessionGymInclude },
    },
  });

  if (!session) notFound();
  if (session.finishedAt) {
    // Session already finished: redirect to home. In LOT 8 we will point
    // to the session history page.
    redirect('/');
  }
  if (!session.workout) notFound();

  const exerciseIds = session.workout.exercises.map((pe) => pe.exerciseId);
  // One extra lookup per block of a deliberately repeated exercise (issue
  // #429), so each block's "last session" and suggestion read its own sets.
  const rowBlocks = blockIndexByRow(session.workout.exercises);
  const blocks = session.workout.exercises.flatMap((pe) => {
    const block = rowBlocks.get(pe.id);
    return block == null ? [] : [{ exerciseId: pe.exerciseId, block }];
  });
  const userPromise = db.user.findUnique({
    where: { id: auth.userId },
    select: { unit: true, deloadUntil: true, bodyweight: true },
  });
  const [lastPerformances, user, latestCheckin, returnRecommendations, catalog] = await Promise.all([
    getLastPerformances(auth.userId, exerciseIds, session.id, blocks),
    userPromise,
    db.readinessCheckin.findFirst({
      where: { userId: auth.userId },
      orderBy: { createdAt: 'desc' },
    }),
    userPromise.then((resolvedUser) =>
      getReturnToTrainingRecommendations({
        userId: auth.userId,
        programExercises: session.workout!.exercises,
        excludeSessionId: session.id,
        now: session.startedAt,
        bodyweight: resolvedUser?.bodyweight ?? null,
        gym: session.gym,
      }),
    ),
    // Catalog for the in-session exercise menu: only the fields it reads
    // (SessionCatalogExercise), not the whole row.
    db.exercise.findMany({
      where: { userId: auth.userId },
      orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        muscleGroup: true,
        category: true,
        usesBodyweight: true,
        defaultRestSec: true,
        isFavorite: true,
      },
    }),
  ]);

  const lastPerfRecord: Record<string, SerializedLastPerformance> = {};
  for (const [k, v] of lastPerformances) {
    lastPerfRecord[k] = serializePerf(v);
  }

  const readiness = buildReadinessSignal(latestCheckin);
  // Planned deload week (issue #112): resolved against the clock here so the
  // client never reasons about dates; an expired deloadUntil has no effect.
  const deloadActive = isDeloadActive(user?.deloadUntil ?? null, new Date());
  // "Last done N days ago" (issue #459), per exercise rather than per block:
  // it says how fresh the movement is. Dated by the session start, like the
  // "Last session ({date})" box next to it. Only the timestamp is sent: the
  // runner counts the days in the browser's zone after mount (review of #476),
  // since the server zone is not the lifter's and a cached page outlives the day.
  const lastDoneAt: Record<string, string> = {};
  for (const exerciseId of exerciseIds) {
    const perf = lastPerformances.get(exerciseId);
    if (perf) lastDoneAt[exerciseId] = perf.sessionStartedAt.toISOString();
  }

  return (
    <SessionRunner
      session={session}
      lastPerformances={lastPerfRecord}
      lastDoneAt={lastDoneAt}
      returnRecommendations={returnRecommendations}
      readiness={readiness}
      deloadActive={deloadActive}
      unit={user?.unit ?? 'KG'}
      initialProgramExerciseId={searchParams.programExerciseId}
      catalog={catalog}
    />
  );
}

// Turn the latest check-in into the readiness signal that drives the load
// suggestion. We only forward an in-window check-in; a stale one is dropped here
// so the client never has to reason about clocks (and the suggestion stays
// identical to the no-data path). Returns null when there is no usable signal.
function buildReadinessSignal(
  checkin: {
    readiness: number;
    soreness: unknown;
    createdAt: Date;
  } | null,
): ReadinessSignal | null {
  if (!checkin) return null;
  const ageHours = (Date.now() - checkin.createdAt.getTime()) / (1000 * 60 * 60);
  if (ageHours > READINESS_RECENCY_HOURS) return null;

  // soreness is stored as JSON; coerce defensively to a plain { group: 1-5 } map.
  let soreness: ReadinessSignal['soreness'] = null;
  if (
    checkin.soreness &&
    typeof checkin.soreness === 'object' &&
    !Array.isArray(checkin.soreness)
  ) {
    const entries = Object.entries(checkin.soreness as Record<string, unknown>).filter(
      ([, v]) => typeof v === 'number',
    ) as Array<[string, number]>;
    if (entries.length > 0) {
      soreness = Object.fromEntries(entries) as ReadinessSignal['soreness'];
    }
  }

  return { readiness: checkin.readiness, soreness, ageHours };
}

function serializePerf(p: LastPerformance): SerializedLastPerformance {
  return {
    sessionStartedAt: p.sessionStartedAt.toISOString(),
    sets: p.sets,
    maxWeight: p.maxWeight,
    repsAtMaxWeight: p.repsAtMaxWeight,
    cardio: p.cardio,
  };
}
