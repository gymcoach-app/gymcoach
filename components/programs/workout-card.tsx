'use client';

import { useId, useRef, useState } from 'react';
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
import { dropExerciseBlock } from '@/lib/programs/drag-reorder';
import { workoutExerciseChoices } from '@/lib/programs/exercise-choices';
import { copyName } from '@/lib/programs/copy';
import { useTrainingName } from '@/components/shared/use-training-name';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { useDragReorder, usePointerEventsSupported } from '@/components/programs/use-drag-reorder';

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
  const exerciseName = useExerciseName();
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
  // What a screen reader hears after a move, by menu, arrow key or drag.
  const [orderAnnouncement, setOrderAnnouncement] = useState('');
  const dragHintId = useId();
  const dragSupported = usePointerEventsSupported();

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

  // Saves a new order of the whole workout (issue #557). The new order shows
  // at once; if the save fails the previous order comes back with an error
  // toast. One save at a time, whatever started it (menu, arrow key, drop):
  // moves are refused while one is in flight, so the next one is always
  // computed from the order the previous one produced and two saves can never
  // reach the server out of order.
  async function saveOrder(ids: string[], movedId: string) {
    if (savingOrderRef.current) return;
    const previousOverride = orderOverride;
    savingOrderRef.current = true;
    setSavingOrder(true);
    setOrderOverride({ source: workout.exercises, ids });
    const moved = workout.exercises.find((pe) => pe.id === movedId);
    setOrderAnnouncement(
      moved
        ? t('reorderAnnouncement', {
            name: exerciseName(moved.exercise.name),
            position: ids.indexOf(movedId) + 1,
            total: ids.length,
          })
        : '',
    );
    try {
      const res = await fetch(`/api/workouts/${workout.id}/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programExerciseIds: ids }),
      }).catch(() => null);
      if (!res?.ok) {
        setOrderOverride(previousOverride);
        setOrderAnnouncement('');
        toast.error(t('reorderError'));
        return;
      }
      router.refresh();
    } finally {
      savingOrderRef.current = false;
      setSavingOrder(false);
    }
  }

  // Moves a row (with its whole superset, if any) one block up or down.
  function handleMove(pe: ProgramExerciseWithExercise, direction: MoveDirection) {
    if (savingOrderRef.current) return;
    const ids = moveExerciseBlock(exercises, pe.id, direction);
    if (ids) void saveOrder(ids, pe.id);
  }

  // Drag-and-drop (issue #557, step 2): the block holding the grabbed row
  // lands among the other blocks, in one save. Same rules as the menu moves.
  function handleDrop(id: string, dropIndex: number) {
    if (savingOrderRef.current) return;
    const ids = dropExerciseBlock(exercises, id, dropIndex);
    if (ids) void saveOrder(ids, id);
  }

  const { containerRef, drag, startDrag } = useDragReorder({
    blocks: blocks.map((block) => block.map((pe) => pe.id)),
    disabled: savingOrder,
    onDrop: handleDrop,
  });
  // A grip needs Pointer Events and something to reorder against.
  const showGrips = dragSupported && blocks.length > 1;

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
          <div ref={containerRef} className="relative">
            <ul className="flex flex-col gap-2">
              {supersetView.ordered.map((pe, index) => {
                const previous = supersetView.ordered[index - 1];
                const alreadyPairedWithPrevious =
                  pe.supersetGroup != null &&
                  previous != null &&
                  previous.supersetGroup === pe.supersetGroup;
                const blockIndex = blockIndexById.get(pe.id) ?? 0;
                const isDragged = drag != null && drag.ids.indexOf(pe.id) !== -1;
                return (
                  <li
                    key={pe.id}
                    // The drag hook finds the rows of a block by this id.
                    data-reorder-id={pe.id}
                    // Above its neighbours while it is dragged over them.
                    className={isDragged ? 'relative z-10' : undefined}
                  >
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
                      dragHandle={
                        showGrips
                          ? {
                              onPointerDown: (event) => startDrag(pe.id, event),
                              describedBy: dragHintId,
                              disabled: savingOrder,
                            }
                          : null
                      }
                      dragging={isDragged}
                    />
                  </li>
                );
              })}
            </ul>
            {drag?.indicatorTop != null && (
              // Where the dragged block lands if it is released now.
              <div
                aria-hidden="true"
                data-drop-indicator=""
                className="pointer-events-none absolute inset-x-0 z-20 h-0.5 -translate-y-1/2 rounded-full bg-primary"
                style={{ top: drag.indicatorTop }}
              />
            )}
            {showGrips && (
              <span id={dragHintId} className="sr-only">
                {exerciseT('dragHint')}
              </span>
            )}
            <span className="sr-only" role="status" aria-live="polite">
              {orderAnnouncement}
            </span>
          </div>
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
