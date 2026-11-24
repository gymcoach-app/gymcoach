'use client';

import { useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Unlink,
} from 'lucide-react';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProgramExerciseFormDialog } from '@/components/programs/program-exercise-form-dialog';
import { exerciseCategoryMessageKeys, muscleGroupMessageKeys } from '@/i18n/enum-keys';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { formatEffort } from '@/lib/effort';
import { useEffortScale } from '@/components/shared/effort-scale-provider';
import { formatCardioTarget, isCardioExercise } from '@/lib/cardio-target';
import { useDistanceUnit } from '@/components/shared/distance-unit-provider';
import { cn } from '@/lib/utils';

type ProgramExerciseWithExercise = ProgramExercise & { exercise: Exercise };

// The drag handle of a row (issue #557, step 2). The parent owns the drag;
// the row only draws the grip and forwards the press.
export interface DragHandleProps {
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  // Id of the element that explains the handle to assistive technology.
  describedBy: string;
  // True while a new order is being saved: the grip stays focusable but
  // starts nothing.
  disabled: boolean;
}

interface Props {
  programExercise: ProgramExerciseWithExercise;
  catalog: Exercise[];
  // Superset pairing (issue #146, slice 1). The label ("A1") is derived by the
  // parent from group membership and order; the actions are null when not
  // applicable (first row cannot pair up, a standalone row cannot unpair).
  supersetLabel?: string | null;
  onPairWithPrevious?: (() => void) | null;
  onUnpair?: (() => void) | null;
  // Reordering (issue #557). Both items are always shown; null disables one
  // (top or bottom edge of the workout, or a save in flight).
  onMoveUp?: (() => void) | null;
  onMoveDown?: (() => void) | null;
  // Drag-and-drop (issue #557, step 2). Null hides the grip: the browser has
  // no Pointer Events, or the workout has nothing to reorder. The menu items
  // above stay the accessible path either way.
  dragHandle?: DragHandleProps | null;
  // True while this row is being dragged.
  dragging?: boolean;
}

export function ProgramExerciseRow({
  programExercise,
  catalog,
  supersetLabel = null,
  onPairWithPrevious = null,
  onUnpair = null,
  onMoveUp = null,
  onMoveDown = null,
  dragHandle = null,
  dragging = false,
}: Props) {
  const t = useTranslations('programs.exercise');
  const locale = useLocale();
  const effortScale = useEffortScale();
  const exerciseT = useTranslations('exercises');
  const common = useTranslations('common');
  const exerciseName = useExerciseName();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(t('removeConfirm', { name: exerciseName(programExercise.exercise.name) }))) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/program-exercises/${programExercise.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error(t('removeError'));
        return;
      }
      toast.success(t('removed'));
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  // The grip also takes the arrow keys, so a keyboard user who lands on it is
  // not left with a control that only a pointer can use.
  function handleGripKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    // Arrow keys would scroll the page otherwise.
    event.preventDefault();
    const move = event.key === 'ArrowUp' ? onMoveUp : onMoveDown;
    if (!move) return;
    move();
    // The row changes place in the list; some browsers drop the focus of a
    // node that is moved, so it is put back once the new order is painted.
    const grip = event.currentTarget;
    window.requestAnimationFrame(() => grip.focus());
  }

  const repsLabel =
    programExercise.targetRepsMin === programExercise.targetRepsMax
      ? `${programExercise.targetRepsMin}`
      : `${programExercise.targetRepsMin}-${programExercise.targetRepsMax}`;

  // A cardio exercise reads as its duration and distance target (issue #558),
  // or as a neutral label when it has none: never as sets, reps and RIR.
  const isCardio = isCardioExercise(programExercise.exercise);
  const distanceUnit = useDistanceUnit();
  const cardioTarget = isCardio
    ? formatCardioTarget(programExercise, { locale, distanceUnit })
    : null;

  return (
    <>
      <div
        className={cn(
          'rounded-md border border-border bg-card/50 p-3 motion-safe:transition-shadow',
          dragging && 'bg-card shadow-lg ring-1 ring-ring',
        )}
      >
        <div className="flex items-start gap-2">
          {dragHandle && (
            <Button
              type="button"
              variant="ghost"
              data-drag-handle=""
              aria-label={t('dragHandle', { name: exerciseName(programExercise.exercise.name) })}
              aria-describedby={dragHandle.describedBy}
              aria-disabled={dragHandle.disabled || undefined}
              onPointerDown={dragHandle.onPointerDown}
              onKeyDown={handleGripKeyDown}
              // A long press on the grip is a drag, not a context menu.
              onContextMenu={(event) => event.preventDefault()}
              // touch-none is what lets a finger drag from here; it is set on
              // the grip only, so the rest of the row still scrolls the page.
              className={cn(
                '-my-3 -ml-3 h-auto min-h-tap w-10 shrink-0 touch-none select-none self-stretch rounded-r-none px-0 text-muted-foreground',
                dragging ? 'cursor-grabbing' : 'cursor-grab',
                dragHandle.disabled && 'cursor-default opacity-50',
              )}
              style={{ WebkitTouchCallout: 'none' }}
            >
              <GripVertical aria-hidden="true" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {exerciseName(programExercise.exercise.name)}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              {supersetLabel && <Badge>{t('superset', { label: supersetLabel })}</Badge>}
              <Badge variant="secondary">
                {exerciseT(
                  `muscleGroups.${muscleGroupMessageKeys[programExercise.exercise.muscleGroup]}`,
                )}
              </Badge>
              <Badge variant="outline">
                {exerciseT(
                  `categories.${exerciseCategoryMessageKeys[programExercise.exercise.category]}`,
                )}
              </Badge>
              {!isCardio && (
                <Badge variant="outline">
                  {programExercise.autoregulationMode === 'PRESERVE_REPS'
                    ? t('preserveRepsShort')
                    : t('preserveRirShort')}
                </Badge>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground" data-prescription>
              {isCardio ? (
                (cardioTarget ?? t('cardioNoTarget'))
              ) : (
                <>
                  {t('prescription', {
                    sets: programExercise.targetSets,
                    reps: repsLabel,
                    effort: formatEffort(effortScale, programExercise.targetRIR),
                    seconds: programExercise.restSec,
                  })}
                  {programExercise.tempo && t('tempoValue', { tempo: programExercise.tempo })}
                </>
              )}
            </p>
            {programExercise.notes && (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                {programExercise.notes}
              </p>
            )}
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
              <DropdownMenuItem onSelect={() => onMoveUp?.()} disabled={!onMoveUp}>
                <ArrowUp className="mr-2 size-4" />
                {t('moveUp')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMoveDown?.()} disabled={!onMoveDown}>
                <ArrowDown className="mr-2 size-4" />
                {t('moveDown')}
              </DropdownMenuItem>
              {onPairWithPrevious && (
                <DropdownMenuItem onSelect={() => onPairWithPrevious()}>
                  <Link2 className="mr-2 size-4" />
                  {t('pairPrevious')}
                </DropdownMenuItem>
              )}
              {onUnpair && (
                <DropdownMenuItem onSelect={() => onUnpair()}>
                  <Unlink className="mr-2 size-4" />
                  {t('unpair')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleDelete}
                disabled={deleting}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 size-4" />
                {common('actions.remove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ProgramExerciseFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        programExercise={programExercise}
        catalog={catalog}
      />
    </>
  );
}
