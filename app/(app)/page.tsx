import Link from 'next/link';
import { Dumbbell, Play, AlertCircle, Lightbulb } from 'lucide-react';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getHomeInsight } from '@/lib/home-insight';
import { getTrainingDisplayName } from '@/i18n/training-names';

const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export default async function DashboardPage() {
  const t = await getTranslations('dashboard');
  const common = await getTranslations('common');
  const format = await getFormatter();
  const locale = await getLocale();
  const session = await requireSession();

  // Look for an unfinished session to offer resuming it.
  const inProgressSession = await db.session.findFirst({
    where: { userId: session.userId, finishedAt: null },
    orderBy: { startedAt: 'desc' },
    include: { workout: { select: { name: true } } },
  });

  const activeProgram = await db.program.findFirst({
    where: { userId: session.userId, isActive: true },
    include: {
      workouts: {
        orderBy: { order: 'asc' },
        include: { _count: { select: { exercises: true } } },
      },
    },
  });

  // Proactive coach insight (issue #237): the single highest-priority
  // deterministic signal (recommended deload / stalled lift / fresh PR /
  // on-track), composed from the existing derivations. Display-only, no LLM
  // call; null on a brand-new account with no history.
  const insight = await getHomeInsight(session.userId, new Date(), locale);

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Dumbbell className="size-8" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">GymCoach</h1>
            <p className="text-xs text-muted-foreground">{session.email}</p>
          </div>
        </div>

        {insight && (
          <Link href={insight.href} className="block">
            <Card className="border-primary/30 bg-primary/5 transition-colors hover:bg-primary/10">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="size-4 text-primary" />
                  {insight.title}
                </CardTitle>
                <CardDescription>{insight.detail}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}

        {inProgressSession ? (
          <Card className="border-primary/40 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('activeSession')}</CardTitle>
              <CardDescription>
                {t('startedOn', {
                  name: inProgressSession.workout?.name
                    ? getTrainingDisplayName(inProgressSession.workout.name, locale)
                    : t('sessionFallback'),
                  date: format.dateTime(inProgressSession.startedAt, {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="min-h-tap w-full text-base">
                <Link href={`/session/${inProgressSession.id}`}>{t('resumeSession')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : !activeProgram ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('noActiveProgram')}</CardTitle>
              <CardDescription>{t('noActiveProgramDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href="/programs">{t('viewPrograms')}</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/session/new">{t('startEmpty')}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : activeProgram.workouts.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('emptyProgram')}</CardTitle>
              <CardDescription>
                {t('emptyProgramDescription', {
                  name: getTrainingDisplayName(activeProgram.name, locale),
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={`/programs/${activeProgram.id}`}>{t('configureProgram')}</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/session/new">{t('startEmpty')}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('startSession')}</CardTitle>
                <CardDescription>
                  {t('activeProgram', {
                    name: getTrainingDisplayName(activeProgram.name, locale),
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="min-h-tap w-full text-base">
                  <Link href="/session/new">
                    <Play className="size-5" />
                    <span className="ml-2">{t('chooseSession')}</span>
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('programSessions')}
              </h2>
              <ul className="flex flex-col gap-2">
                {activeProgram.workouts.map((w) => {
                  const dayKey = w.dayOfWeek != null ? DAY_KEYS[w.dayOfWeek - 1] : null;
                  const day = dayKey ? common(`days.${dayKey}`) : null;
                  const empty = w._count.exercises === 0;
                  return (
                    <li key={w.id}>
                      <Card>
                        <CardContent className="flex items-center justify-between gap-3 p-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {getTrainingDisplayName(w.name, locale)}
                            </p>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              {day && <Badge variant="secondary">{day}</Badge>}
                              <span>
                                {common('counts.exercises', { count: w._count.exercises })}
                              </span>
                              {empty && (
                                <span className="flex items-center gap-1 text-amber-600">
                                  <AlertCircle className="size-3" />
                                  {common('states.empty')}
                                </span>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
