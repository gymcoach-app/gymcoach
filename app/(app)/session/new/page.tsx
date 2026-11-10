import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ReadinessCheckin } from '@/components/session/readiness-checkin';
import { WorkoutStartList } from '@/components/session/workout-start-list';
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

export default async function NewSessionPage() {
  const t = await getTranslations('session');
  const common = await getTranslations('common');
  const locale = await getLocale();
  const session = await requireSession();
  const [activeProgram, user, gyms] = await Promise.all([
    db.program.findFirst({
      where: { userId: session.userId, isActive: true },
      include: {
        workouts: {
          orderBy: { order: 'asc' },
          include: {
            _count: { select: { exercises: true } },
          },
        },
      },
    }),
    db.user.findUnique({ where: { id: session.userId }, select: { activeGymId: true } }),
    db.gym.findMany({
      where: { userId: session.userId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href="/">
            <ChevronLeft className="size-4" />
            <span className="ml-1">{common('actions.back')}</span>
          </Link>
        </Button>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('startTitle')}</h1>
          {activeProgram ? (
            <p className="text-sm text-muted-foreground">
              {t('activeProgram', {
                name: getTrainingDisplayName(activeProgram.name, locale),
              })}
            </p>
          ) : null}
        </div>

        {!activeProgram ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('noActiveProgram')}</CardTitle>
              <CardDescription>{t('noActiveProgramDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/programs">{t('viewPrograms')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : activeProgram.workouts.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('noSession')}</CardTitle>
              <CardDescription>{t('noSessionDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href={`/programs/${activeProgram.id}`}>{t('configureProgram')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ReadinessCheckin />
        )}
        {/* Always rendered: with no program or no workout it still offers the
            freestyle session (issue #388) and the gym choice that goes with it. */}
        <WorkoutStartList
          activeGymId={user?.activeGymId ?? null}
          gyms={gyms}
          workouts={(activeProgram?.workouts ?? []).map((w) => {
            const dayKey = w.dayOfWeek != null ? DAY_KEYS[w.dayOfWeek - 1] : null;
            const day = dayKey ? common(`days.${dayKey}`) : null;
            return {
              id: w.id,
              name: getTrainingDisplayName(w.name, locale),
              day,
              exerciseCount: w._count.exercises,
            };
          })}
        />
      </div>
    </main>
  );
}
