import { db } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { ExercisesView } from '@/components/exercises/exercises-view';
import { buildGymInventory } from '@/lib/exercise-filters';

export default async function ExercisesPage() {
  const session = await requireSession();
  const [exercises, gyms, user] = await Promise.all([
    db.exercise.findMany({
      where: { userId: session.userId },
      orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }],
    }),
    // What the "only what my gym has" filter reads (issue #402). Item photos
    // (GymEquipment.imageData) are deliberately not selected.
    db.gym.findMany({
      where: { userId: session.userId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        dumbbellWeights: true,
        plateWeights: true,
        barWeights: true,
        equipment: {
          select: { equipmentType: true, exerciseLinks: { select: { exerciseId: true } } },
        },
        exerciseConfigs: { select: { exerciseId: true, isAvailable: true, weightOptions: true } },
      },
    }),
    db.user.findUnique({ where: { id: session.userId }, select: { activeGymId: true } }),
  ]);

  return (
    <main className="flex-1 px-4 py-6">
      <ExercisesView
        exercises={exercises}
        gyms={gyms.map(buildGymInventory)}
        activeGymId={user?.activeGymId ?? null}
      />
    </main>
  );
}
