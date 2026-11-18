import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { ProgramDetailView } from '@/components/programs/program-detail-view';
import { EffortScaleProvider } from '@/components/shared/effort-scale-provider';
import { DistanceUnitProvider } from '@/components/shared/distance-unit-provider';
import { cardioDistanceUnit } from '@/lib/cardio';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProgramDetailPage(props: Props) {
  const params = await props.params;
  const session = await requireSession();

  const program = await db.program.findFirst({
    where: { id: params.id, userId: session.userId },
    include: {
      workouts: {
        orderBy: { order: 'asc' },
        include: {
          exercises: {
            orderBy: { order: 'asc' },
            include: { exercise: true },
          },
        },
      },
    },
  });

  if (!program) notFound();

  const [exercisesCatalog, user] = await Promise.all([
    db.exercise.findMany({
      where: { userId: session.userId },
      orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }],
    }),
    // The prescription line of each exercise follows the effort scale (#390)
    // and, for a cardio target, the distance unit (#582).
    db.user.findUnique({
      where: { id: session.userId },
      select: { effortScale: true, unit: true, distanceUnit: true },
    }),
  ]);

  return (
    <main className="flex-1 px-4 py-6">
      <EffortScaleProvider scale={user?.effortScale ?? 'RIR'}>
        <DistanceUnitProvider unit={cardioDistanceUnit(user)}>
          <ProgramDetailView program={program} catalog={exercisesCatalog} />
        </DistanceUnitProvider>
      </EffortScaleProvider>
    </main>
  );
}
