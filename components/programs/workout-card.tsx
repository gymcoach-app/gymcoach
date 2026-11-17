'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Copy, MoreHorizontal, Plus, Pencil, Printer, Trash2 } from 'lucide-react';
import type { Exercise, ProgramExercise, Workout } from '@/lib/prisma-client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProgramExerciseRow } from '@/components/programs/program-exercise-row';
import { WorkoutFormDialog } from '@/components/programs/workout-form-dialog';
import { ProgramExerciseFormDialog } from '@/components/programs/program-exercise-form-dialog';
import {
  applyExerciseOrder,
  buildSupersetView,
  moveExerciseBlock,
  smallestFreeGroup,
  supersetBlocks,
  type MoveDirection,
} from '@/lib/supersets';
import { workoutExerciseChoices } from '@/lib/programs/exercise-choices';
import { copyName } from '@/lib/programs/copy';
import { useTrainingName } from '@/components/shared/use-training-name';

const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

type ProgramExerciseWithExercise = ProgramExercise & { exercise: Exercise };
type WorkoutWithExercises = Workout & { exercises: ProgramExerciseWithExercise[] };

interface Props {
  workout: WorkoutWithExercises;
  catalog: Exercise[];
}

export function WorkoutCard({ workout, catalog }: Props) {
  const t = useTranslations('programs.workout');
  const exerciseT = useTranslations('programs.exercise');
  const printT = useTranslations('programs.print');
  const common = useTranslations('common');
  const trainingName = useTrainingName();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [addExoOpen, setAddExoOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const duplicatingRef = useRef(false);
  // Reordering (issue #557): the order shown while a move is being saved and
  // until the refreshed rows arrive. It is tied to the `workout.exercises`
  // array it was computed from, so the next server render (a new array)
  // replaces it without an effect.
  const [orderOverride, setOrderOverride] = useState<{
    source: ProgramExerciseWithExercise[];
    ids: string[];
  } | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const savingOrderRef = useRef(false);

  async function handleDelete() {
    if (!confirm(t('deleteConfirm', { name: trainingName(workout.name) }))) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workouts/${workout.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error(t('deleteError'));
        return;
      }
      toast.success(t('deleted'));
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  // Duplicate (issue #394): copies the workout and every programmed exercise,
  // repeats included, into the same program.
  async function handleDuplicate() {
    // Ignore a second select while the first copy is in flight.
    if (duplicatingRef.current) return;
    duplicatingRef.current = true;
    try {
      await duplicateWorkout();
    } finally {
      duplicatingRef.current = false;
    }
  }

  async function duplicateWorkout() {
    const res = await fetch(`/api/workouts/${workout.id}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: copyName(workout.name, t('copySuffix')) }),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error(t('duplicateError'));
      return;
    }
    toast.success(t('duplicated'));
    router.refresh();
  }

  const dayKey = workout.dayOfWeek != null ? DAY_KEYS[workout.dayOfWeek - 1] : null;
  const dayLabel = dayKey ? common(`days.${dayKey}`) : null;

  // Superset pairing (issue #146, slice 1): rows render in presentation order
  // (group members together) with A1/A2 labels derived on read.
  const exercises =
    orderOverride && orderOverride.source === workout.exercises
      ? applyExerciseOrder(workout.exercises, orderOverride.ids)
      : workout.exercises;
  const supersetView = buildSupersetView(exercises);
  // Reordering works on blocks (a superset moves as one, issue #557): a row
  // can move up unless its block is the first, down unless it is the last.
  const blocks = supersetBlocks(exercises);
  const blockIndexById = new Map<string, number>();
  blocks.forEach((block, blockIndex) => {
    for (const member of block) blockIndexById.set(member.id, blockIndex);
  });
  const workoutExerciseIds = workout.exercises.map((pe) => pe.exerciseId);
  const addChoices = workoutExerciseChoices(catalog, workoutExerciseIds);

  async function updateSupersetGroup(
    pe: ProgramExerciseWithExercise,
    supersetGroup: number | null,
  ): Promise<boolean> {
    const res = await fetch(`/api/program-exercises/${pe.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exerciseId: pe.exerciseId,
        targetSets: pe.targetSets,
        targetRepsMin: pe.targetRepsMin,
        targetRepsMax: pe.targetRepsMax,
        targetRIR: pe.targetRIR,
        restSec: pe.restSec,
        tempo: pe.tempo,
        notes: pe.notes,
        supersetGroup,
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(data?.error ?? t('supersetUpdateError'));
      return false;
    }
    return true;
  }

  // Pairs a row with the one above it (in presentation order): joins the
  // previous row's group, creating a fresh group for both when the previous
  // row is standalone.
  async function handlePairWithPrevious(index: number) {
    const pe = supersetView.ordered[index];
    const previous = supersetView.ordered[index - 1];
    if (!pe || !previous) return;
    let group = previous.supersetGroup;
    if (group == null) {
      group = smallestFreeGroup(workout.exercises);
      if (group == null) {
        toast.error(t('supersetLimit'));
        return;
      }
      if (!(await updateSupersetGroup(previous, group))) return;
    }
    if (!(await updateSupersetGroup(pe, group))) return;
    toast.success(t('supersetPaired'));
    router.refresh();
  }

  async function handleUnpair(pe: ProgramExerciseWithExercise) {
    if (!(await updateSupersetGroup(pe, null))) return;
    toast.success(t('supersetRemoved'));
    router.refresh();
  }

  // Moves a row (with its whole superset, if any) one block up or down. The
  // new order shows at once; if the save fails the previous order comes back
  // with an error toast. One save at a time: the next move is computed from
  // the order the previous one produced.
  async function handleMove(pe: ProgramExerciseWithExercise, direction: MoveDirection) {
    if (savingOrderRef.current) return;
    const ids = moveExerciseBlock(exercises, pe.id, direction);
    if (!ids) return;
    const previousOverride = orderOverride;
    savingOrderRef.current = true;
    setSavingOrder(true);
    setOrderOverride({ source: workout.exercises, ids });
    try {
      const res = await fetch(`/api/workouts/${workout.id}/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programExerciseIds: ids }),
      }).catch(() => null);
      if (!res?.ok) {
        setOrderOverride(previousOverride);
        toast.error(t('reorderError'));
        return;
      }
      router.refresh();
    } finally {
      savingOrderRef.current = false;
      setSavingOrder(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{trainingName(workout.name)}</CardTitle>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              {dayLabel && <Badge variant="secondary">{dayLabel}</Badge>}
              <span>{common('counts.exercises', { count: workout.exercises.length })}</span>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="min-h-tap min-w-tap"
                aria-label={t('actions')}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil className="mr-2 size-4" />
                {common('actions.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  router.push(`/programs/${workout.programId}/print?workout=${workout.id}`)
                }
              >
                <Printer className="mr-2 size-4" />
                {printT('action')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleDuplicate}>
                <Copy className="mr-2 size-4" />
                {t('duplicate')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleDelete}
                disabled={deleting}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 size-4" />
                {common('actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-2 pt-0">
        {workout.exercises.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {supersetView.ordered.map((pe, index) => {
              const previous = supersetView.ordered[index - 1];
              const alreadyPairedWithPrevious =
                pe.supersetGroup != null &&
                previous != null &&
                previous.supersetGroup === pe.supersetGroup;
              const blockIndex = blockIndexById.get(pe.id) ?? 0;
              return (
                <li key={pe.id}>
                  <ProgramExerciseRow
                    programExercise={pe}
                    catalog={workoutExerciseChoices(catalog, workoutExerciseIds, pe.exerciseId)}
                    supersetLabel={supersetView.labels.get(pe.id) ?? null}
                    // Pairing reads the neighbours on screen, so it waits
                    // while a new order is being saved: a failed save puts
                    // the old order back.
                    onPairWithPrevious={
                      !savingOrder && index > 0 && !alreadyPairedWithPrevious
                        ? () => handlePairWithPrevious(index)
                        : null
                    }
                    onUnpair={
                      !savingOrder && pe.supersetGroup != null ? () => handleUnpair(pe) : null
                    }
                    onMoveUp={!savingOrder && blockIndex > 0 ? () => handleMove(pe, 'up') : null}
                    onMoveDown={
                      !savingOrder && blockIndex < blocks.length - 1
                        ? () => handleMove(pe, 'down')
                        : null
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => setAddExoOpen(true)}
          className="min-h-tap self-start"
          disabled={addChoices.length === 0}
        >
          <Plus className="size-4" />
          <span className="ml-2">{exerciseT('add')}</span>
        </Button>
        {catalog.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('catalogEmpty')}</p>
        )}
      </CardContent>

      <WorkoutFormDialog open={editOpen} onOpenChange={setEditOpen} mode="edit" workout={workout} />
      <ProgramExerciseFormDialog
        open={addExoOpen}
        onOpenChange={setAddExoOpen}
        mode="create"
        workoutId={workout.id}
        catalog={addChoices}
      />
    </Card>
  );
}
