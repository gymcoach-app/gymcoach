import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { cardioDistanceUnit } from '@/lib/cardio';
import { blockIndexByRow, blockKey } from '@/lib/exercise-blocks';
import { EffortScaleProvider } from '@/components/shared/effort-scale-provider';
import { DistanceUnitProvider } from '@/components/shared/distance-unit-provider';
import { SessionEditor, type EditorGroup } from '@/components/history/session-editor';
import { getTrainingDisplayName } from '@/i18n/training-names';

interface Params {
  params: Promise<{ id: string }>;
}

// Editor of a finished session (issue #389): its date, start time and
// duration, and every set. Reached from the session's history page and right
// after "Log a past workout".
export default async function HistorySessionEditPage(props: Params) {
  const t = await getTranslations('history');
  const locale = await getLocale();
  const params = await props.params;
  const auth = await requireSession();

  const [session, user, catalog] = await Promise.all([
    // Scoped by userId: someone else's session is a 404, like an unknown id.
    db.session.findFirst({
      where: { id: params.id, userId: auth.userId },
      include: {
        workout: {
          select: {
            name: true,
            exercises: { orderBy: { order: 'asc' }, include: { exercise: true } },
          },
        },
        sets: {
          // Set number first; sets that share one (an import may do that)
          // then follow the time they were done. The editor keeps this order.
          orderBy: [{ setNumber: 'asc' }, { completedAt: 'asc' }, { id: 'asc' }],
          include: { exercise: true },
        },
      },
    }),
    db.user.findUnique({
      where: { id: auth.userId },
      select: { unit: true, distanceUnit: true, effortScale: true },
    }),
    db.exercise.findMany({
      where: { userId: auth.userId },
      orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }],
    }),
  ]);

  if (!session) notFound();
  // A session in progress is edited where it runs.
  if (!session.finishedAt) redirect(`/session/${session.id}`);

  // The cards: the workout's exercises first, in workout order, so a session
  // logged afterwards from a workout opens on the planned list; then whatever
  // else the session has sets for. Same keys as the history page: the first
  // block of a repeated exercise (issue #429) shares the bare exercise key.
  const groups: EditorGroup[] = [];
  const seen = new Set<string>();
  const addGroup = (group: EditorGroup) => {
    const key = blockKey(group.exercise.id, group.block);
    if (seen.has(key)) return;
    seen.add(key);
    groups.push(group);
  };
  const rows = session.workout?.exercises ?? [];
  const rowBlocks = blockIndexByRow(rows);
  for (const row of rows) {
    addGroup({ exercise: row.exercise, block: rowBlocks.get(row.id) || null });
  }
  for (const set of session.sets) {
    addGroup({ exercise: set.exercise, block: set.block || null });
  }

  const title = session.workout?.name
    ? getTrainingDisplayName(session.workout.name, locale)
    : t('freeSession');

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        {/* No back link here: the editor's Done is the way out, and it saves a
            pending date change first instead of dropping it. */}
        <EffortScaleProvider scale={user?.effortScale ?? 'RIR'}>
          <DistanceUnitProvider unit={cardioDistanceUnit(user)}>
            <SessionEditor
              sessionId={session.id}
              title={title}
              startedAt={session.startedAt.toISOString()}
              finishedAt={session.finishedAt.toISOString()}
              groups={groups}
              sets={session.sets.map((set) => ({
                id: set.id,
                exerciseId: set.exerciseId,
                gymEquipmentId: set.gymEquipmentId,
                setNumber: set.setNumber,
                weight: set.weight,
                reps: set.reps,
                rir: set.rir,
                durationSec: set.durationSec,
                distanceM: set.distanceM,
                avgHr: set.avgHr,
                maxHr: set.maxHr,
                notes: set.notes,
                isWarmup: set.isWarmup,
                isDropSet: set.isDropSet,
                block: set.block,
              }))}
              catalog={catalog}
              unit={user?.unit ?? 'KG'}
            />
          </DistanceUnitProvider>
        </EffortScaleProvider>
      </div>
    </main>
  );
}
