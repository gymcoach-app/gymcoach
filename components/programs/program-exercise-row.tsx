'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link2, MoreHorizontal, Pencil, Trash2, Unlink } from 'lucide-react';
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

type ProgramExerciseWithExercise = ProgramExercise & { exercise: Exercise };

interface Props {
  programExercise: ProgramExerciseWithExercise;
  catalog: Exercise[];
  // Superset pairing (issue #146, slice 1). The label ("A1") is derived by the
  // parent from group membership and order; the actions are null when not
  // applicable (first row cannot pair up, a standalone row cannot unpair).
  supersetLabel?: string | null;
  onPairWithPrevious?: (() => void) | null;
  onUnpair?: (() => void) | null;
}

export function ProgramExerciseRow({
  programExercise,
  catalog,
  supersetLabel = null,
  onPairWithPrevious = null,
  onUnpair = null,
}: Props) {
  const t = useTranslations('programs.exercise');
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

  const repsLabel =
    programExercise.targetRepsMin === programExercise.targetRepsMax
      ? `${programExercise.targetRepsMin}`
      : `${programExercise.targetRepsMin}-${programExercise.targetRepsMax}`;

  return (
    <>
      <div className="rounded-md border border-border bg-card/50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
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
              <Badge variant="outline">
                {programExercise.autoregulationMode === 'PRESERVE_REPS'
                  ? t('preserveRepsShort')
                  : t('preserveRirShort')}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('prescription', {
                sets: programExercise.targetSets,
                reps: repsLabel,
                effort: formatEffort(effortScale, programExercise.targetRIR),
                seconds: programExercise.restSec,
              })}
              {programExercise.tempo && t('tempoValue', { tempo: programExercise.tempo })}
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
