import { getLocale, getTimeZone, getTranslations } from 'next-intl/server';
import { CalendarDays } from 'lucide-react';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { EmptyState } from '@/components/ui/empty-state';
import { applyBodyweight, totalVolume } from '@/lib/stats';
import { formatWeight } from '@/lib/units';
import { cardioDistanceUnit, formatDistance, formatDuration } from '@/lib/cardio';
import { HistoryFilters } from '@/components/history/history-filters';
import { LogPastWorkoutButton } from '@/components/history/log-past-workout-button';
import {
  HistoryCalendar,
  type HistoryCalendarSession,
} from '@/components/history/history-calendar';
import { getExerciseDisplayName } from '@/i18n/exercise-names';
import { getTrainingDisplayName } from '@/i18n/training-names';
import {
  formatMonthKey,
  getMonthQueryRange,
  parseMonthKey,
  resolveCalendarTimeZone,
} from '@/lib/history-calendar';

interface SearchParams {
  programId?: string;
  month?: string;
  day?: string;
  tz?: string;
}

export default async function HistoryPage(props: { searchParams: Promise<SearchParams> }) {
  const t = await getTranslations('history');
  const locale = await getLocale();
  const searchParams = await props.searchParams;
  const timeZone = resolveCalendarTimeZone(searchParams.tz, await getTimeZone());
  const auth = await requireSession();
  const month = parseMonthKey(searchParams.month, new Date(), timeZone);
  const monthKey = formatMonthKey(month);
  const monthRange = getMonthQueryRange(month);
  const programFilter = searchParams.programId ? { programId: searchParams.programId } : {};

  const [sessions, programs, user, totalHistoryCount, workouts, gyms] = await Promise.all([
    db.session.findMany({
      where: {
        userId: auth.userId,
        finishedAt: { not: null },
        startedAt: monthRange,
        ...programFilter,
      },
      orderBy: { startedAt: 'asc' },
      include: {
        workout: { select: { name: true } },
        program: { select: { name: true } },
        sets: {
          select: {
            weight: true,
            reps: true,
            isWarmup: true,
            durationSec: true,
            distanceM: true,
            avgHr: true,
            exercise: { select: { usesBodyweight: true, name: true, category: true } },
          },
        },
      },
    }),
    db.program.findMany({
      where: { userId: auth.userId },
      orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
      select: { id: true, name: true },
    }),
    db.user.findUnique({
      where: { id: auth.userId },
      select: { bodyweight: true, unit: true, distanceUnit: true, activeGymId: true },
    }),
    db.session.count({
      where: { userId: auth.userId, finishedAt: { not: null } },
    }),
    // The workouts "Log a past workout" offers (issue #389): the active
    // program's first.
    db.workout.findMany({
      where: { program: { userId: auth.userId } },
      orderBy: [{ program: { isActive: 'desc' } }, { programId: 'asc' }, { order: 'asc' }],
      select: { id: true, name: true, program: { select: { name: true } } },
    }),
    db.gym.findMany({
      where: { userId: auth.userId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const unit = user?.unit ?? 'KG';
  const distanceUnit = cardioDistanceUnit(user);
  const calendarSessions: HistoryCalendarSession[] = sessions.map((session) => {
    const enrichedSets = applyBodyweight(
      session.sets.map((set) => ({
        weight: set.weight,
        reps: set.reps,
        isWarmup: set.isWarmup,
        durationSec: set.durationSec,
        usesBodyweight: set.exercise.usesBodyweight,
      })),
      user?.bodyweight,
    );
    const working = session.sets.filter((set) => !set.isWarmup);
    const cardioSets = working.filter(
      (set) => set.exercise.category === 'CARDIO' && set.durationSec != null,
    );
    const isCardio = working.length > 0 && cardioSets.length === working.length;
    const cardioDistance = cardioSets.reduce((sum, set) => sum + (set.distanceM ?? 0), 0);
    const cardioDurationSec = cardioSets.reduce((sum, set) => sum + (set.durationSec ?? 0), 0);
    const cardioAvgHr = cardioSets.find((set) => set.avgHr != null)?.avgHr ?? null;
    const durationMin = session.finishedAt
      ? Math.round((session.finishedAt.getTime() - session.startedAt.getTime()) / 60000)
      : null;
    const cardioName = cardioSets[0]?.exercise.name
      ? getExerciseDisplayName(cardioSets[0].exercise.name, locale)
      : t('cardio');

    return {
      id: session.id,
      startedAt: session.startedAt.toISOString(),
      title: session.workout?.name
        ? getTrainingDisplayName(session.workout.name, locale)
        : isCardio
          ? cardioName
          : t('freeSession'),
      programName: session.program?.name
        ? getTrainingDisplayName(session.program.name, locale)
        : null,
      workingSets: working.length,
      volumeLabel: isCardio
        ? null
        : t('volumeShort', {
            weight: formatWeight(totalVolume(enrichedSets), unit, {
              decimals: 0,
              locale,
            }),
          }),
      durationLabel: !isCardio && durationMin != null ? t('minutes', { count: durationMin }) : null,
      cardioDistanceLabel: isCardio && cardioDistance > 0 ? formatDistance(cardioDistance, distanceUnit) : null,
      cardioDurationLabel:
        isCardio && (cardioDurationSec > 0 || durationMin != null)
          ? formatDuration(cardioDurationSec || (durationMin ?? 0) * 60)
          : null,
      cardioHeartRateLabel: isCardio && cardioAvgHr != null ? `${cardioAvgHr} bpm` : null,
    };
  });

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CalendarDays className="size-6" />
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          </div>
          <LogPastWorkoutButton
            gyms={gyms}
            activeGymId={user?.activeGymId ?? null}
            workouts={workouts.map((workout) => ({
              id: workout.id,
              name: `${getTrainingDisplayName(workout.program.name, locale)} - ${getTrainingDisplayName(workout.name, locale)}`,
            }))}
          />
        </div>

        <HistoryFilters
          programs={programs}
          selectedProgramId={searchParams.programId}
          selectedMonth={monthKey}
        />

        {totalHistoryCount === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={{ label: t('firstSession'), href: '/session/new' }}
          />
        ) : (
          <HistoryCalendar
            monthKey={monthKey}
            initialDay={searchParams.day}
            sessions={calendarSessions}
            selectedProgramId={searchParams.programId}
            timeZone={timeZone}
          />
        )}
      </div>
    </main>
  );
}
