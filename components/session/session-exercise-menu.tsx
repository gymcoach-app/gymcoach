'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Plus, Replace, Search, Star, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { favoritesFirst } from '@/lib/exercise-favorites';
import { matchesSearch } from '@/lib/search-fold';
import { defaultIntraSetConfig } from '@/lib/intra-set-autoregulation';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type SessionProgramExercise = ProgramExercise & { exercise: Exercise };
// The catalog fields this menu reads. The session page selects exactly these,
// so the rest of each exercise row (notes, owner id) stays on the server.
export type SessionCatalogExercise = Pick<
  Exercise,
  'id' | 'name' | 'muscleGroup' | 'category' | 'usesBodyweight' | 'defaultRestSec' | 'isFavorite'
>;
type View = 'actions' | 'replace' | 'add' | 'removeConfirm';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programExercise: SessionProgramExercise;
  programExercises: SessionProgramExercise[];
  catalog: SessionCatalogExercise[];
  loggedSetCount: number;
  onChanged: (options?: { selectProgramExerciseId?: string; removedProgramExerciseId?: string }) => void;
}

// Targets for a program row created from the session menu. Cardio follows the
// repo rule (one continuous effort is one set, logged as duration/distance, see
// lib/prompts/program-system-prompt.ts). The autoregulation config is left out:
// the POST route derives it from the exercise.
function additionPayload(exercise: Pick<Exercise, 'id' | 'category' | 'defaultRestSec'>) {
  const cardio = exercise.category === 'CARDIO';
  return {
    exerciseId: exercise.id,
    targetSets: cardio ? 1 : 4,
    targetRepsMin: cardio ? 1 : 8,
    targetRepsMax: cardio ? 1 : 12,
    targetRIR: cardio ? 0 : 2,
    restSec: exercise.defaultRestSec,
  };
}

function replacementPayload(
  programExercise: SessionProgramExercise,
  exercise: SessionCatalogExercise,
) {
  // Strength targets make no sense for cardio and the other way round, so a
  // swap across that line starts from the new exercise's defaults.
  const sameKind =
    (programExercise.exercise.category === 'CARDIO') === (exercise.category === 'CARDIO');
  const targets = sameKind
    ? {
        exerciseId: exercise.id,
        targetSets: programExercise.targetSets,
        targetRepsMin: programExercise.targetRepsMin,
        targetRepsMax: programExercise.targetRepsMax,
        targetRIR: programExercise.targetRIR,
        restSec: programExercise.restSec,
      }
    : additionPayload(exercise);
  // The fatigue rate and load step were tuned for the old exercise, and the
  // PUT route stores what it receives. Send the new exercise's defaults, which
  // is what the POST route stores for a freshly added row.
  const autoregulation = defaultIntraSetConfig(exercise);
  return {
    ...targets,
    autoregulationMode: programExercise.autoregulationMode,
    fatigueRate: autoregulation.fatigueRate,
    loadAdjustmentPct: autoregulation.loadAdjustmentPct,
    tempo: programExercise.tempo,
    notes: programExercise.notes,
    supersetGroup: programExercise.supersetGroup,
  };
}

export function SessionExerciseMenu({
  open,
  onOpenChange,
  programExercise,
  programExercises,
  catalog,
  loggedSetCount,
  onChanged,
}: Props) {
  const t = useTranslations('session.exerciseMenu');
  const exerciseName = useExerciseName();
  const locale = useLocale();
  const [view, setView] = useState<View>('actions');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingReplacement, setPendingReplacement] = useState<SessionCatalogExercise | null>(null);
  // `busy` disables the buttons on the next render; the ref closes the gap
  // for a second call that arrives before that render.
  const inFlight = useRef(false);

  const currentIndex = programExercises.findIndex((item) => item.id === programExercise.id);
  const previous = currentIndex > 0 ? programExercises[currentIndex - 1] : undefined;
  const next = currentIndex >= 0 ? programExercises[currentIndex + 1] : undefined;
  // Removing the only exercise would leave the runner on its empty state,
  // which has no Finish button. Replace stays available.
  const onlyExercise = programExercises.length <= 1;
  const removeBlockedId = useId();
  const existingExerciseIds = useMemo(
    () => new Set(programExercises.map((item) => item.exerciseId)),
    [programExercises],
  );

  const choices = useMemo(() => {
    const needle = query.trim();
    const source =
      view === 'add'
        ? catalog.filter((exercise) => !existingExerciseIds.has(exercise.id))
        : catalog.filter(
            (exercise) =>
              exercise.id !== programExercise.exerciseId &&
              !existingExerciseIds.has(exercise.id) &&
              exercise.muscleGroup === programExercise.exercise.muscleGroup,
          );
    // Favourites lead the list (issue #404), search or not.
    if (!needle) return favoritesFirst(source);
    return favoritesFirst(
      source.filter(
        (exercise) =>
          matchesSearch(exercise.name, needle, locale) ||
          matchesSearch(exerciseName(exercise.name), needle, locale),
      ),
    );
  }, [
    catalog,
    exerciseName,
    existingExerciseIds,
    locale,
    programExercise.exercise.muscleGroup,
    programExercise.exerciseId,
    query,
    view,
  ]);

  function close(nextOpen: boolean) {
    if (busy && !nextOpen) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setView('actions');
      setQuery('');
      setPendingReplacement(null);
    }
  }

  function openView(nextView: View) {
    setView(nextView);
    setQuery('');
    setPendingReplacement(null);
  }

  async function replaceExercise(exercise: SessionCatalogExercise) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch(
        '/api/program-exercises/' + encodeURIComponent(programExercise.id),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(replacementPayload(programExercise, exercise)),
        },
      );
      if (!response.ok) {
        toast.error(response.status === 409 ? t('duplicate') : t('replaceError'));
        return;
      }
      toast.success(t('replaced'));
      onOpenChange(false);
      setView('actions');
      setPendingReplacement(null);
      setQuery('');
      onChanged();
    } catch {
      toast.error(t('replaceError'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // A replace rewrites the saved program row, so it always asks first; the
  // wording depends on whether sets were already logged on the old exercise.
  function requestReplacement(exercise: SessionCatalogExercise) {
    setPendingReplacement(exercise);
  }

  async function addExercise(exercise: SessionCatalogExercise) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch(
        '/api/workouts/' + encodeURIComponent(programExercise.workoutId) + '/program-exercises',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(additionPayload(exercise)),
        },
      );
      if (!response.ok) {
        toast.error(response.status === 409 ? t('duplicate') : t('addError'));
        return;
      }
      toast.success(t('added'));
      onOpenChange(false);
      setView('actions');
      setQuery('');
      onChanged();
    } catch {
      toast.error(t('addError'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function removeExercise() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch(
        '/api/program-exercises/' + encodeURIComponent(programExercise.id),
        {
          method: 'DELETE',
        },
      );
      if (!response.ok) throw new Error('remove failed');
      toast.success(t('removed'));
      onOpenChange(false);
      setView('actions');
      setQuery('');
      onChanged({
        selectProgramExerciseId: next?.id ?? previous?.id,
        removedProgramExerciseId: programExercise.id,
      });
    } catch {
      toast.error(t('removeError'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>
          {view === 'actions'
            ? t('actions')
            : view === 'replace'
              ? t('replace')
              : view === 'add'
                ? t('addExercises')
                : t('remove')}
        </DialogTitle>
        <DialogDescription>
          {view === 'actions'
            ? t('actionsDescription')
            : view === 'replace'
              ? t('replaceDescription')
              : view === 'add'
                ? t('addDescription')
                : t('removeDescription')}
        </DialogDescription>

        {view === 'actions' && (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-tap justify-start"
              onClick={() => openView('replace')}
            >
              <Replace className="mr-2 size-4" aria-hidden />
              {t('replace')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-tap justify-start"
              onClick={() => openView('add')}
            >
              <Plus className="mr-2 size-4" aria-hidden />
              {t('addExercises')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-tap justify-start"
              disabled={onlyExercise}
              aria-describedby={onlyExercise ? removeBlockedId : undefined}
              onClick={() => openView('removeConfirm')}
            >
              <Trash2 className="mr-2 size-4" aria-hidden />
              {t('remove')}
            </Button>
            {onlyExercise && (
              <p id={removeBlockedId} className="text-sm text-muted-foreground">
                {t('removeLastBlocked')}
              </p>
            )}
          </div>
        )}

        {view === 'removeConfirm' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {loggedSetCount > 0 ? t('removeLoggedWarning') : t('removeConfirm')}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                className="min-h-tap"
                variant="outline"
                disabled={busy}
                onClick={() => setView('actions')}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                className="min-h-tap"
                variant="destructive"
                disabled={busy}
                onClick={() => void removeExercise()}
              >
                {t('remove')}
              </Button>
            </div>
          </div>
        )}

        {(view === 'replace' || view === 'add') && pendingReplacement ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {loggedSetCount > 0 ? t('replaceLoggedWarning') : t('replaceConfirm')}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                className="min-h-tap"
                variant="outline"
                disabled={busy}
                onClick={() => setPendingReplacement(null)}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                className="min-h-tap"
                disabled={busy}
                onClick={() => void replaceExercise(pendingReplacement)}
              >
                {t('confirmReplace', { name: exerciseName(pendingReplacement.name) })}
              </Button>
            </div>
          </div>
        ) : view === 'replace' || view === 'add' ? (
          <>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('searchExercises')}
                className="pl-9"
                aria-label={t('searchExercises')}
              />
            </div>
            <div className="flex flex-col gap-1">
              {choices.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">{t('noExercises')}</p>
              ) : (
                choices.map((exercise) => (
                  <Button
                    key={exercise.id}
                    type="button"
                    variant="ghost"
                    className="min-h-tap justify-start"
                    disabled={busy}
                    onClick={() =>
                      view === 'replace' ? requestReplacement(exercise) : void addExercise(exercise)
                    }
                    aria-label={
                      exercise.isFavorite
                        ? t('favoriteChoice', { name: exerciseName(exercise.name) })
                        : undefined
                    }
                  >
                    {exercise.isFavorite && (
                      <Star className="size-4 fill-current text-amber-500" aria-hidden />
                    )}
                    {exerciseName(exercise.name)}
                  </Button>
                ))
              )}
            </div>
            <Button
              type="button"
              className="min-h-tap"
              variant="outline"
              disabled={busy}
              onClick={() => setView('actions')}
            >
              {t('back')}
            </Button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
