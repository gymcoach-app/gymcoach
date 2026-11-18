import { TrendingUp } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { EmptyState } from '@/components/ui/empty-state';
import { muscleGroupMessageKeys } from '@/i18n/enum-keys';
import {
  applyBodyweight,
  best1RM,
  classifyWeeklySets,
  effectiveWeight,
  exerciseProgress,
  isStalled,
  isoWeekKey,
  trainingConsistency,
  weeklyConditioning,
  weeklyFrequencyByMuscleGroup,
  weeklySetsByMuscleGroup,
  weeklyVolumeByMuscleGroup,
  resolveVolumeBand,
  WEEKLY_SETS_MEV,
  WEEKLY_SETS_MRV,
} from '@/lib/stats';
import { buildMuscleMap } from '@/lib/muscle-map';
import {
  DELOAD_READINESS_LOOKBACK,
  DELOAD_READINESS_MAX_AGE_DAYS,
  isDeloadActive,
  recommendDeload,
} from '@/lib/deload';
import { exerciseRecords } from '@/lib/records';
import { ProgressDashboard } from '@/components/progress/progress-dashboard';
import { ConsistencyCard } from '@/components/progress/consistency-card';
import { DeloadBanner } from '@/components/progress/deload-banner';
import { BodyweightCard } from '@/components/progress/bodyweight-card';
import { MeasurementsCard } from '@/components/progress/measurements-card';
import { PhotosCard } from '@/components/progress/photos-card';
import { ConditioningCard } from '@/components/progress/conditioning-card';
import { cardioDistanceUnit } from '@/lib/cardio';
import { RecordsCard } from '@/components/progress/records-card';

interface SearchParams {
  exerciseId?: string;
}

const RECENT_WEEKS = 12;

export default async function ProgressPage(
  props: {
    searchParams: Promise<SearchParams>;
  }
) {
  const t = await getTranslations('progress');
  const exerciseT = await getTranslations('exercises');
  const searchParams = await props.searchParams;
  const auth = await requireSession();

  // Lower bound: 12 weeks before today (Monday 00:00).
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - RECENT_WEEKS * 7);

  // All exercises with at least one non-warmup set in the period.
  const [exercisesWithSets, user] = await Promise.all([
    db.exercise.findMany({
      where: {
        userId: auth.userId,
        // The lifting selector/recap only makes sense for weight x reps work;
        // cardio exercises (issue #133) have no load chart to show here (a
        // dedicated conditioning view is the follow-up, issue #135).
        category: { not: 'CARDIO' },
        sets: {
          some: {
            isWarmup: false,
            completedAt: { gte: since },
            session: { userId: auth.userId },
          },
        },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, muscleGroup: true, usesBodyweight: true },
    }),
    db.user.findUnique({
      where: { id: auth.userId },
      select: {
        bodyweight: true,
        bodyweightGoalKg: true,
        unit: true,
        distanceUnit: true,
        weeklyFrequency: true,
        deloadUntil: true,
      },
    }),
  ]);
  const bodyweight = user?.bodyweight ?? null;
  const unit = user?.unit ?? 'KG';

  // The user's per-muscle volume targets (issue #211): personal MEV/MRV bands
  // that override the global defaults for the volume-landmark card. Absent
  // groups fall back to the defaults via resolveVolumeBand.
  const volumeTargetRows = await db.volumeTarget.findMany({
    where: { userId: auth.userId },
    select: { muscleGroup: true, mev: true, mrv: true },
  });
  const volumeTargets: Record<string, { mev: number; mrv: number }> =
    Object.fromEntries(
      volumeTargetRows.map((t) => [t.muscleGroup, { mev: t.mev, mrv: t.mrv }]),
    );
  const usesBodyweightById = new Map(
    exercisesWithSets.map((e) => [e.id, e.usesBodyweight]),
  );

  // Finished sessions over the window, for the consistency card.
  const finishedSessions = await db.session.findMany({
    where: {
      userId: auth.userId,
      finishedAt: { not: null },
      startedAt: { gte: since },
    },
    select: { startedAt: true },
  });
  const consistency = trainingConsistency(
    finishedSessions.map((s) => s.startedAt),
    { weeklyFrequency: user?.weeklyFrequency ?? null, windowWeeks: RECENT_WEEKS },
  );

  const selectedExerciseId =
    searchParams.exerciseId ?? exercisesWithSets[0]?.id;

  // Max load + 1RM for the selected exercise, over all available history,
  // plus its target goal (issue #90) fetched in parallel.
  const [exerciseSets, selectedGoal] = await Promise.all([
    selectedExerciseId
      ? db.set.findMany({
          where: {
            exerciseId: selectedExerciseId,
            isWarmup: false,
            session: { userId: auth.userId },
          },
          orderBy: { completedAt: 'asc' },
          select: {
            weight: true,
            reps: true,
            isWarmup: true,
            durationSec: true,
            sessionId: true,
            session: { select: { startedAt: true } },
          },
        })
      : Promise.resolve([]),
    selectedExerciseId
      ? db.exerciseGoal.findUnique({
          where: {
            userId_exerciseId: { userId: auth.userId, exerciseId: selectedExerciseId },
          },
        })
      : Promise.resolve(null),
  ]);

  const selectedUsesBodyweight =
    selectedExerciseId != null
      ? (usesBodyweightById.get(selectedExerciseId) ?? false)
      : false;
  const adjustedExerciseSets = applyBodyweight(
    exerciseSets.map((s) => ({
      weight: s.weight,
      reps: s.reps,
      isWarmup: s.isWarmup,
      durationSec: s.durationSec,
      sessionId: s.sessionId,
      sessionStartedAt: s.session.startedAt,
      usesBodyweight: selectedUsesBodyweight,
    })),
    bodyweight,
  );
  const exercisePoints = exerciseProgress(adjustedExerciseSets);

  // The goal is measured against the best bodyweight-adjusted e1RM over the
  // full history loaded above.
  const selectedBestE1RM = best1RM(adjustedExerciseSets);

  // Weekly volume by muscle group over the period (12 weeks).
  const weeklySetsRaw = await db.set.findMany({
    where: {
      isWarmup: false,
      completedAt: { gte: since },
      session: { userId: auth.userId },
    },
    select: {
      weight: true,
      reps: true,
      isWarmup: true,
      durationSec: true,
      distanceM: true,
      sessionId: true,
      exercise: { select: { muscleGroup: true, usesBodyweight: true } },
      session: { select: { startedAt: true } },
    },
  });

  const weeklyPoints = weeklyVolumeByMuscleGroup(
    applyBodyweight(
      weeklySetsRaw.map((s) => ({
        weight: s.weight,
        reps: s.reps,
        isWarmup: s.isWarmup,
        durationSec: s.durationSec,
        muscleGroup: s.exercise.muscleGroup,
        sessionStartedAt: s.session.startedAt,
        usesBodyweight: s.exercise.usesBodyweight,
      })),
      bodyweight,
    ),
  );

  // Weekly working-set count per muscle group, for the MEV/MRV reference band.
  // Set counts are load-agnostic, so no bodyweight adjustment is needed.
  const weeklySetsPoints = weeklySetsByMuscleGroup(
    weeklySetsRaw.map((s) => ({
      isWarmup: s.isWarmup,
      durationSec: s.durationSec,
      muscleGroup: s.exercise.muscleGroup,
      sessionStartedAt: s.session.startedAt,
    })),
  );

  // Weekly training FREQUENCY per muscle group (issue #225): distinct training
  // days (calendar days with >= 1 working set) per muscle, same warmup/cardio
  // exclusion and ISO-week bucketing as the set-count card. Shown alongside the
  // volume on the landmarks view as "Nx/week".
  const weeklyFrequencyPoints = weeklyFrequencyByMuscleGroup(
    weeklySetsRaw.map((s) => ({
      isWarmup: s.isWarmup,
      durationSec: s.durationSec,
      muscleGroup: s.exercise.muscleGroup,
      sessionStartedAt: s.session.startedAt,
    })),
  );

  // Classify the most recent completed (non-current) week against the band so
  // the dashboard can flag below MEV / within / above MRV per muscle group.
  // Falling back to the latest available week keeps a signal when only the
  // current week has data.
  const currentWeekKey = isoWeekKey(new Date());
  const latestCompletedWeek =
    [...weeklySetsPoints]
      .reverse()
      .find((w) => w.weekKey !== currentWeekKey) ??
    weeklySetsPoints[weeklySetsPoints.length - 1];
  // Frequency for the exact week the landmarks card displays, so volume and
  // frequency describe the same week per muscle group.
  const frequencyForWeek =
    latestCompletedWeek
      ? weeklyFrequencyPoints.find((w) => w.weekKey === latestCompletedWeek.weekKey)
          ?.byMuscleGroup ?? {}
      : {};
  const volumeLandmarks = latestCompletedWeek
    ? {
        weekKey: latestCompletedWeek.weekKey,
        // Default band, shown as the card-level reference; each row also
        // carries its own resolved band (custom or default).
        mev: WEEKLY_SETS_MEV,
        mrv: WEEKLY_SETS_MRV,
        byMuscleGroup: Object.fromEntries(
          Object.entries(latestCompletedWeek.byMuscleGroup).map(
            ([group, sets]) => {
              const band = resolveVolumeBand(group, volumeTargets);
              return [
                group,
                {
                  sets,
                  // Distinct training days for this muscle in the same week
                  // (issue #225). 0 when the muscle was not trained.
                  frequency: frequencyForWeek[group] ?? 0,
                  zone: classifyWeeklySets(sets, band.mev, band.mrv),
                  mev: band.mev,
                  mrv: band.mrv,
                  custom: band.custom,
                },
              ];
            },
          ),
        ),
      }
    : null;

  // Muscle heat map (issue #299): same week and same personal-target
  // resolution as the volume-landmarks card, mapped onto silhouette regions.
  const muscleMap = latestCompletedWeek
    ? buildMuscleMap(latestCompletedWeek.byMuscleGroup, volumeTargets)
    : [];

  // Recap table: per exercise, first and last session in the period,
  // delta of the max load and the 1RM.
  const recapRows = await Promise.all(
    exercisesWithSets.map(async (exo) => {
      const sets = await db.set.findMany({
        where: {
          exerciseId: exo.id,
          isWarmup: false,
          completedAt: { gte: since },
          session: { userId: auth.userId },
        },
        orderBy: { completedAt: 'asc' },
        select: {
          weight: true,
          reps: true,
          isWarmup: true,
          durationSec: true,
          sessionId: true,
          session: { select: { startedAt: true } },
        },
      });
      const points = exerciseProgress(
        applyBodyweight(
          sets.map((s) => ({
            weight: s.weight,
            reps: s.reps,
            isWarmup: s.isWarmup,
            durationSec: s.durationSec,
            sessionId: s.sessionId,
            sessionStartedAt: s.session.startedAt,
            usesBodyweight: exo.usesBodyweight,
          })),
          bodyweight,
        ),
      );
      const first = points[0];
      const last = points[points.length - 1];
      if (!first || !last) return null;
      return {
        exerciseId: exo.id,
        exerciseName: exo.name,
        muscleGroup: exerciseT(
          `muscleGroups.${muscleGroupMessageKeys[exo.muscleGroup]}`,
        ),
        sessions: points.length,
        firstWeight: first.maxWeight,
        firstDate: first.date,
        lastWeight: last.maxWeight,
        lastDate: last.date,
        weightDelta: +(last.maxWeight - first.maxWeight).toFixed(2),
        firstE1RM: first.estimated1RM,
        lastE1RM: last.estimated1RM,
        e1rmDelta: +(last.estimated1RM - first.estimated1RM).toFixed(1),
        // Read-only flag: e1RM has not improved over the recent sessions.
        stalled: isStalled(points.map((p) => p.estimated1RM)),
      };
    }),
  );
  const recap = recapRows.filter(
    (r): r is NonNullable<typeof r> => r !== null,
  );

  // Program-level deload recommendation: aggregates the stalled flags above
  // with the most recent readiness check-ins. Display-only. Stale check-ins
  // are excluded so the trigger reflects the current block, not dead data.
  const readinessSince = new Date();
  readinessSince.setUTCDate(
    readinessSince.getUTCDate() - DELOAD_READINESS_MAX_AGE_DAYS,
  );
  const recentCheckins = await db.readinessCheckin.findMany({
    where: { userId: auth.userId, createdAt: { gte: readinessSince } },
    orderBy: { createdAt: 'desc' },
    take: DELOAD_READINESS_LOOKBACK,
    select: { readiness: true },
  });
  // Bodyweight trend (issue #99): entries of the last 12 weeks, newest first.
  // Independent of training data, so the card renders even on the empty state.
  const bodyweightEntries = await db.bodyweightEntry.findMany({
    where: { userId: auth.userId, measuredAt: { gte: since } },
    orderBy: { measuredAt: 'desc' },
    select: { id: true, weightKg: true, measuredAt: true },
  });

  // Body measurements (issue #202): entries of the same 12-week window, newest
  // first, across every site. The card slices per site client-side. Like the
  // bodyweight card, it renders on the empty state too.
  const bodyMeasurements = await db.bodyMeasurement.findMany({
    where: { userId: auth.userId, measuredAt: { gte: since } },
    orderBy: { measuredAt: 'desc' },
    select: { id: true, site: true, valueCm: true, measuredAt: true },
  });

  // Progress photos (issue #269): ALL of the user's photos (not just the
  // 12-week window - a before/after compare wants the full timeline), newest
  // first. Only metadata crosses the boundary; the bytes stay behind the
  // ownership-scoped image route.
  const progressPhotos = await db.progressPhoto.findMany({
    where: { userId: auth.userId },
    orderBy: { takenAt: 'desc' },
    select: { id: true, takenAt: true, note: true },
  });

  // Conditioning card (issue #135, display-only): weekly cardio minutes /
  // distance / sessions over the last 8 weeks, derived from the cardio sets
  // already fetched for the window. The card stays hidden until the user has
  // logged at least one cardio set EVER (not just in the window), so a brand
  // new axis never shows an empty chart unprompted.
  const hasCardioSets =
    (await db.set.count({
      where: { durationSec: { not: null }, session: { userId: auth.userId } },
    })) > 0;
  const conditioningWeeks = hasCardioSets
    ? weeklyConditioning(
        weeklySetsRaw
          .filter((s) => s.durationSec != null)
          .map((s) => ({
            durationSec: s.durationSec,
            distanceM: s.distanceM,
            isWarmup: s.isWarmup,
            sessionId: s.sessionId,
            sessionStartedAt: s.session.startedAt,
          })),
        { windowWeeks: 8 },
      )
    : null;

  // Records board (issue #190, display-only): all-time bests per strength
  // exercise over the user's full set history (not just the 12-week window).
  // Cardio is excluded at the query (category != CARDIO); warm-ups are excluded
  // both here and in the derivation. Bodyweight-effective load is applied so a
  // bodyweight movement's records read on the load actually moved, consistent
  // with every other load aggregation on this page.
  const recordSetsRaw = await db.set.findMany({
    where: {
      isWarmup: false,
      session: { userId: auth.userId },
      exercise: { category: { not: 'CARDIO' } },
    },
    // Oldest first so that on a tie (same load / e1RM) exerciseRecords keeps
    // the EARLIEST date, matching its documented "first to reach it" behavior:
    // the reducer keeps the first-seen row, which is only the earliest when the
    // rows arrive chronologically.
    orderBy: { session: { startedAt: 'asc' } },
    select: {
      weight: true,
      reps: true,
      isWarmup: true,
      durationSec: true,
      exercise: { select: { name: true, usesBodyweight: true } },
      session: { select: { startedAt: true } },
    },
  });
  const records = exerciseRecords(
    recordSetsRaw.map((s) => ({
      weight: effectiveWeight(s.weight, s.exercise.usesBodyweight, bodyweight),
      reps: s.reps,
      isWarmup: s.isWarmup,
      durationSec: s.durationSec,
      exerciseName: s.exercise.name,
      sessionStartedAt: s.session.startedAt,
    })),
  );

  const deload = recommendDeload({
    stalledExerciseNames: recap
      .filter((r) => r.stalled)
      .map((r) => r.exerciseName),
    recentReadiness: recentCheckins.map((c) => c.readiness),
  });

  // Active planned deload week (issue #112): only a future deloadUntil counts;
  // an expired one reads as inactive without any cleanup write.
  const deloadActive = isDeloadActive(user?.deloadUntil ?? null, new Date());
  const deloadUntilIso = deloadActive ? user!.deloadUntil!.toISOString() : null;

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <TrendingUp className="size-6" />
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        </div>

        <BodyweightCard
          entries={bodyweightEntries.map((e) => ({
            id: e.id,
            weightKg: e.weightKg,
            measuredAt: e.measuredAt.toISOString(),
          }))}
          unit={unit}
          goalKg={user?.bodyweightGoalKg ?? null}
        />

        <MeasurementsCard
          entries={bodyMeasurements.map((e) => ({
            id: e.id,
            site: e.site,
            valueCm: e.valueCm,
            measuredAt: e.measuredAt.toISOString(),
          }))}
          unit={unit}
        />

        <PhotosCard
          photos={progressPhotos.map((p) => ({
            id: p.id,
            takenAt: p.takenAt.toISOString(),
            note: p.note,
          }))}
        />

        {conditioningWeeks && (
          <ConditioningCard
            weeks={conditioningWeeks.map((w) => ({
              weekKey: w.weekKey,
              weekStartIso: w.weekStart.toISOString(),
              minutes: w.minutes,
              distanceKm: w.distanceKm,
              sessions: w.sessions,
            }))}
            distanceUnit={cardioDistanceUnit(user)}
          />
        )}

        {exercisesWithSets.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title={t('emptyTitle')}
            description={t('emptyDescription', { weeks: RECENT_WEEKS })}
            action={{ label: t('firstSession'), href: '/session/new' }}
          />
        ) : (
          <>
            {(deload.recommended || deloadActive) && (
              <DeloadBanner reasons={deload.reasons} deloadUntil={deloadUntilIso} />
            )}
            <ConsistencyCard
              weeks={consistency.weeks}
              currentStreak={consistency.currentStreak}
              weeklyFrequency={consistency.weeklyFrequency}
            />
            <ProgressDashboard
              exercises={exercisesWithSets.map((e) => ({
                id: e.id,
                name: e.name,
                muscleGroup: exerciseT(
                  `muscleGroups.${muscleGroupMessageKeys[e.muscleGroup]}`,
                ),
              }))}
              selectedExerciseId={selectedExerciseId}
              exercisePoints={exercisePoints}
              weeklyPoints={weeklyPoints.map((w) => ({
                weekKey: w.weekKey,
                weekStartIso: w.weekStart.toISOString(),
                byMuscleGroup: w.byMuscleGroup,
                total: w.total,
              }))}
              volumeLandmarks={volumeLandmarks}
              muscleMap={muscleMap}
              defaultBand={{ mev: WEEKLY_SETS_MEV, mrv: WEEKLY_SETS_MRV }}
              recap={recap}
              unit={unit}
              selectedGoal={
                selectedGoal
                  ? {
                      id: selectedGoal.id,
                      targetWeight: selectedGoal.targetWeight,
                      targetReps: selectedGoal.targetReps,
                      achievedAt: selectedGoal.achievedAt?.toISOString() ?? null,
                    }
                  : null
              }
              selectedBestE1RM={selectedBestE1RM}
              selectedUsesBodyweight={selectedUsesBodyweight}
            />
            {records.length > 0 && (
              <RecordsCard records={records} unit={unit} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
