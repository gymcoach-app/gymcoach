import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getLocale, getTimeZone, getTranslations } from 'next-intl/server';
import { ArrowLeft, Calendar, Clock, Download, Dumbbell } from 'lucide-react';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { muscleGroupMessageKeys } from '@/i18n/enum-keys';
import { applyBodyweight, best1RM, totalVolume } from '@/lib/stats';
import {
  formatCardioSet,
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  sumCardioWorkingSets,
} from '@/lib/cardio';
import { formatWeight } from '@/lib/units';
import { formatWorkoutText } from '@/lib/workout-text';
import { blockKey, distinctExerciseCount } from '@/lib/exercise-blocks';
import { CopyWorkoutButton } from '@/components/history/copy-workout-button';
import { SaveAsWorkoutButton } from '@/components/history/save-as-workout-button';
import { DeleteSessionButton } from '@/components/history/delete-session-button';
import { ActivityTrackChart } from '@/components/history/activity-track-chart';
import { TrackDecoupling } from '@/components/history/track-decoupling';
import { getExerciseDisplayName } from '@/i18n/exercise-names';
import { getTrainingDisplayName } from '@/i18n/training-names';
import { resolveCalendarTimeZone } from '@/lib/history-calendar';

interface Params {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; day?: string; programId?: string; tz?: string }>;
}

// The calendar links here with the month, day, program filter and the
// lifter's zone; the back link returns to that exact view and the date badge
// is formatted in that zone (review of #351).
function buildBackHref(params: { month?: string; day?: string; programId?: string; tz?: string }) {
  const query = new URLSearchParams();
  for (const key of ['month', 'day', 'programId', 'tz'] as const) {
    const value = params[key];
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return qs ? `/history?${qs}` : '/history';
}

export default async function HistorySessionPage(props: Params) {
  const t = await getTranslations('history');
  const detail = await getTranslations('history.detail');
  const copyT = await getTranslations('history.copy');
  const exerciseT = await getTranslations('exercises');
  const locale = await getLocale();
  const format = await getFormatter();
  const params = await props.params;
  const searchParams = await props.searchParams;
  const timeZone = resolveCalendarTimeZone(searchParams.tz, await getTimeZone());
  const auth = await requireSession();

  const [session, user] = await Promise.all([
    db.session.findUnique({
      where: { id: params.id },
      include: {
        workout: { select: { name: true } },
        program: { select: { name: true } },
        sets: {
          orderBy: [{ exerciseId: 'asc' }, { block: 'asc' }, { setNumber: 'asc' }],
          include: {
            exercise: {
              select: {
                id: true,
                name: true,
                muscleGroup: true,
                category: true,
                usesBodyweight: true,
              },
            },
          },
        },
      },
    }),
    db.user.findUnique({
      where: { id: auth.userId },
      select: { bodyweight: true, unit: true },
    }),
  ]);

  if (!session || session.userId !== auth.userId) {
    notFound();
  }
  const bodyweight = user?.bodyweight ?? null;
  const unit = user?.unit ?? 'KG';

  // Group sets by exercise (keeping the order of the first set per exercise).
  // A later block of a deliberately repeated exercise (issue #429, 5/3/1 BBB)
  // is its own group; block 0 and NULL share the bare exerciseId key, so a
  // session without repeats groups exactly as before.
  const exerciseOrder: string[] = [];
  const setsByExercise = new Map<
    string,
    { exercise: (typeof session.sets)[number]['exercise']; sets: typeof session.sets }
  >();
  for (const s of session.sets) {
    const key = blockKey(s.exerciseId, s.block ? s.block : null);
    let entry = setsByExercise.get(key);
    if (!entry) {
      entry = { exercise: s.exercise, sets: [] };
      setsByExercise.set(key, entry);
      exerciseOrder.push(key);
    }
    entry.sets.push(s);
  }

  // For tonnage, we enrich the sets with their usesBodyweight + the user's
  // bodyweight. Exercises that are not flagged stay unchanged.
  const enrichedAllSets = applyBodyweight(
    session.sets.map((s) => ({
      weight: s.weight,
      reps: s.reps,
      isWarmup: s.isWarmup,
      durationSec: s.durationSec,
      usesBodyweight: s.exercise.usesBodyweight,
    })),
    bodyweight,
  );
  const volume = totalVolume(enrichedAllSets);
  const workingSetCount = session.sets.filter((s) => !s.isWarmup).length;
  // The Exercises stat counts distinct lifts (issue #475): a 5/3/1 BBB squat
  // logged as two blocks is two groups below but one exercise here.
  const exerciseCount = distinctExerciseCount(session.sets);
  // TCX export (issue #175) is offered only for a FINISHED session that has
  // cardio sets; the route 400s on a cardio-less session, and an in-progress
  // session (reachable only by direct URL here) is not a complete export.
  const hasCardio = session.finishedAt != null && session.sets.some((s) => s.durationSec != null);
  const durationMin =
    session.finishedAt && session.startedAt
      ? Math.round((session.finishedAt.getTime() - session.startedAt.getTime()) / 60000)
      : null;
  const sessionTitle = session.workout?.name
    ? getTrainingDisplayName(session.workout.name, locale)
    : t('freeSession');
  // "Copy as text" (issue #405) recaps a FINISHED session only, like the TCX
  // export: an in-progress session is not a log worth pasting yet.
  const workoutText =
    session.finishedAt != null && exerciseOrder.length > 0
      ? formatWorkoutText(
          {
            title: sessionTitle,
            date: format.dateTime(session.startedAt, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone,
            }),
            notes: session.notes,
            exercises: exerciseOrder.flatMap((exerciseId) => {
              const entry = setsByExercise.get(exerciseId);
              if (!entry) return [];
              return [
                {
                  name: getExerciseDisplayName(entry.exercise.name, locale),
                  isCardio: entry.exercise.category === 'CARDIO',
                  usesBodyweight: entry.exercise.usesBodyweight,
                  sets: entry.sets,
                },
              ];
            }),
          },
          {
            unit,
            locale,
            labels: {
              warmup: copyT('warmup'),
              dropSet: copyT('dropSet'),
              bodyweight: detail('bodyweight'),
              setNote: (number) => detail('setNote', { number }),
              notes: copyT('notes'),
            },
          },
        )
      : null;

  // "Save as a workout" (issue #394): a FINISHED session with at least one
  // working set, saved into one of the trainee's programs.
  const canSaveAsWorkout =
    session.finishedAt != null && session.sets.some((s) => !s.isWarmup && !s.isDropSet);
  const programs = canSaveAsWorkout
    ? await db.program.findMany({
        where: { userId: auth.userId },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, name: true },
      })
    : [];

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href={buildBackHref(searchParams)}>
              <ArrowLeft className="size-4" />
              <span className="ml-1">{t('title')}</span>
            </Link>
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {workoutText && <CopyWorkoutButton text={workoutText} />}
            {canSaveAsWorkout && (
              <SaveAsWorkoutButton
                sessionId={session.id}
                programs={programs.map((p) => ({
                  id: p.id,
                  name: getTrainingDisplayName(p.name, locale),
                }))}
                defaultProgramId={session.programId}
                defaultName={sessionTitle}
              />
            )}
            {hasCardio && (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/cardio/tcx?sessionId=${session.id}`} download>
                  <Download className="size-4" />
                  <span className="ml-1">{detail('downloadTcx')}</span>
                </a>
              </Button>
            )}
            <DeleteSessionButton
              sessionId={session.id}
              workoutName={
                session.workout?.name ? getTrainingDisplayName(session.workout.name, locale) : null
              }
              startedAt={session.startedAt}
            />
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <h1 className="text-2xl font-bold tracking-tight">{sessionTitle}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {session.program && (
                <Badge variant="secondary">
                  {getTrainingDisplayName(session.program.name, locale)}
                </Badge>
              )}
              <Badge variant="outline" className="gap-1">
                <Calendar className="size-3" />
                {format.dateTime(session.startedAt, {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone,
                })}
              </Badge>
              {durationMin != null && (
                <Badge variant="outline" className="gap-1">
                  <Clock className="size-3" />
                  {t('minutes', { count: durationMin })}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 pt-0 text-sm sm:grid-cols-3">
            <Stat label={detail('sets')} value={String(workingSetCount)} />
            <Stat label={detail('exercises')} value={String(exerciseCount)} />
            <Stat
              label={detail('totalVolume')}
              value={formatWeight(volume, unit, { decimals: 0, locale })}
            />
          </CardContent>
        </Card>

        {session.notes && (
          <Card>
            <CardContent className="py-4 text-sm">
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                {detail('notes')}
              </p>
              <p className="whitespace-pre-line">{session.notes}</p>
            </CardContent>
          </Card>
        )}

        {exerciseOrder.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {detail('noSets')}
            </CardContent>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {exerciseOrder.map((exerciseId) => {
              const entry = setsByExercise.get(exerciseId);
              if (!entry) return null;
              const isCardio = entry.exercise.category === 'CARDIO';
              const enrichedExoSets = applyBodyweight(
                entry.sets.map((s) => ({
                  weight: s.weight,
                  reps: s.reps,
                  isWarmup: s.isWarmup,
                  durationSec: s.durationSec,
                  usesBodyweight: entry.exercise.usesBodyweight,
                })),
                bodyweight,
              );
              const exoVolume = totalVolume(enrichedExoSets);
              const e1rm = best1RM(enrichedExoSets);
              // Cardio recap (issue #133): totals across the WORKING sets, with
              // derived pace and speed (issue #177) appended when a distance was
              // covered (omitted for duration-only cardio). Warmups are excluded
              // (issue #183), matching the working-set convention used elsewhere.
              const { durationSec: cardioDurationTotal, distanceM: cardioDistanceTotal } =
                sumCardioWorkingSets(entry.sets);
              const cardioTotal = isCardio
                ? [
                    formatCardioSet(cardioDurationTotal, cardioDistanceTotal),
                    formatPace(cardioDurationTotal, cardioDistanceTotal, unit),
                    formatSpeed(cardioDurationTotal, cardioDistanceTotal, unit),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : null;
              return (
                <li key={exerciseId}>
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="text-base font-semibold">
                          {getExerciseDisplayName(entry.exercise.name, locale)}
                        </h2>
                        <Badge variant="secondary" className="text-xs">
                          {exerciseT(
                            `muscleGroups.${muscleGroupMessageKeys[entry.exercise.muscleGroup]}`,
                          )}
                        </Badge>
                      </div>
                      <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                        {cardioTotal ? (
                          <span>{detail('total', { value: cardioTotal })}</span>
                        ) : (
                          <span>
                            {detail('volume', {
                              value: formatWeight(exoVolume, unit, {
                                decimals: 0,
                                group: false,
                                locale,
                              }),
                            })}
                          </span>
                        )}
                        {e1rm > 0 && (
                          <span>
                            {detail('oneRm', {
                              value: formatWeight(e1rm, unit, {
                                decimals: 1,
                                fixed: true,
                                group: false,
                                locale,
                              }),
                            })}
                          </span>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {isCardio ? (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                              <th className="py-1.5 font-medium">#</th>
                              <th className="py-1.5 font-medium">{detail('duration')}</th>
                              <th className="py-1.5 font-medium">{detail('distance')}</th>
                              <th className="py-1.5 font-medium">{detail('pace')}</th>
                              <th className="py-1.5 font-medium">{detail('avgHr')}</th>
                              <th className="py-1.5 font-medium">{detail('maxHr')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.sets.map((s) => {
                              const pace =
                                s.durationSec != null
                                  ? formatPace(s.durationSec, s.distanceM, unit)
                                  : null;
                              return (
                                <tr key={s.id} className="border-b border-border/40">
                                  <td className="py-1.5">{s.setNumber}</td>
                                  <td className="py-1.5">
                                    {s.durationSec != null ? formatDuration(s.durationSec) : '-'}
                                  </td>
                                  <td className="py-1.5">
                                    {s.distanceM != null && s.distanceM > 0
                                      ? formatDistance(s.distanceM)
                                      : '-'}
                                  </td>
                                  <td className="py-1.5">{pace ?? '-'}</td>
                                  <td className="py-1.5">
                                    {s.avgHr != null ? `${s.avgHr} bpm` : '-'}
                                  </td>
                                  <td className="py-1.5">
                                    {s.maxHr != null ? `${s.maxHr} bpm` : '-'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : null}
                      {isCardio &&
                        entry.sets.map((s) => {
                          if (!Array.isArray(s.track) || s.track.length === 0) return null;
                          const track = s.track as { t: number; d?: number; hr?: number }[];
                          return (
                            <div key={`track-${s.id}`}>
                              <ActivityTrackChart track={track} />
                              <TrackDecoupling track={track} />
                            </div>
                          );
                        })}
                      {!isCardio && (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                              <th className="py-1.5 font-medium">#</th>
                              <th className="py-1.5 font-medium">{detail('load')}</th>
                              <th className="py-1.5 font-medium">{detail('reps')}</th>
                              <th className="py-1.5 font-medium">RIR</th>
                              <th className="py-1.5 font-medium">{detail('type')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entry.sets.map((s) => {
                              const isBw = entry.exercise.usesBodyweight && bodyweight;
                              const effective = isBw ? bodyweight + s.weight : s.weight;
                              return (
                                <tr
                                  key={s.id}
                                  className={
                                    s.isWarmup
                                      ? 'text-muted-foreground'
                                      : 'border-b border-border/40'
                                  }
                                >
                                  <td className="py-1.5">{s.setNumber}</td>
                                  <td className="py-1.5">
                                    {isBw ? (
                                      <span>
                                        {formatWeight(effective, unit, {
                                          decimals: 2,
                                          group: false,
                                          locale,
                                        })}
                                        <span className="ml-1 text-xs text-muted-foreground">
                                          ({s.weight >= 0 ? '+' : ''}
                                          {formatWeight(s.weight, unit, {
                                            decimals: 2,
                                            withUnit: false,
                                            group: false,
                                            locale,
                                          })}{' '}
                                          {detail('external')})
                                        </span>
                                      </span>
                                    ) : effective === 0 ? (
                                      detail('bodyweight')
                                    ) : (
                                      formatWeight(effective, unit, {
                                        decimals: 2,
                                        group: false,
                                        locale,
                                      })
                                    )}
                                  </td>
                                  <td className="py-1.5">{s.reps}</td>
                                  <td className="py-1.5">{s.rir ?? '-'}</td>
                                  <td className="py-1.5 text-xs">
                                    {s.isWarmup
                                      ? detail('warmup')
                                      : s.isDropSet
                                        ? detail('dropSet')
                                        : detail('working')}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                      {entry.sets.some((s) => s.notes) && (
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {entry.sets
                            .filter((s) => s.notes)
                            .map((s) => (
                              <p key={s.id}>
                                <span className="font-medium">
                                  {detail('setNote', { number: s.setNumber })}{' '}
                                </span>
                                {s.notes}
                              </p>
                            ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Dumbbell className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-medium">{value}</p>
      </div>
    </div>
  );
}
