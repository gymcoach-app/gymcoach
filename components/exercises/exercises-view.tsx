'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Pencil, Search, Star } from 'lucide-react';
import { toast } from 'sonner';
import type { Exercise, MuscleGroup } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ExerciseFormDialog } from '@/components/exercises/exercise-form-dialog';
import { ExerciseMediaDialog } from '@/components/exercises/exercise-media-dialog';
import { DeleteExerciseButton } from '@/components/exercises/delete-exercise-button';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { matchesSearch } from '@/lib/search-fold';
import { cn } from '@/lib/utils';
import {
  equipmentTypeMessageKeys,
  exerciseCategoryMessageKeys,
  muscleGroupMessageKeys,
} from '@/i18n/enum-keys';

interface ExercisesViewProps {
  exercises: Exercise[];
}

export function ExercisesView({ exercises }: ExercisesViewProps) {
  const t = useTranslations('exercises');
  const common = useTranslations('common');
  const exerciseName = useExerciseName();
  const locale = useLocale();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [query, setQuery] = useState('');
  // Stars toggled on this page before the refreshed list arrives (issue #404),
  // so a starred row moves to the favourites section at once.
  const [favoriteOverrides, setFavoriteOverrides] = useState<Record<string, boolean>>({});
  // One star request at a time across the whole list: the reorder slides
  // another row's star under the finger, so a double tap must be ignored on
  // every star, not only the one being saved, and two PATCHes never race.
  const [pendingFavorites, setPendingFavorites] = useState<ReadonlySet<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  // Starring moves the row to another section, which remounts it; focus
  // follows the exercise's star to its new place.
  const starRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focusStarId, setFocusStarId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!focusStarId) return;
    starRefs.current.get(focusStarId)?.focus();
    setFocusStarId(null);
  }, [focusStarId, favoriteOverrides]);

  // Drop an override once the refreshed list agrees with it, so a later server
  // value (another tab, a backup import) is not masked for the page's life.
  useEffect(() => {
    setFavoriteOverrides((current) => {
      const stale = exercises.filter(
        (ex) =>
          ex.id in current && current[ex.id] === ex.isFavorite && !pendingRef.current.has(ex.id),
      );
      if (stale.length === 0) return current;
      const rest = { ...current };
      for (const ex of stale) delete rest[ex.id];
      return rest;
    });
  }, [exercises]);

  function setPending(id: string, pending: boolean) {
    if (pending) pendingRef.current.add(id);
    else pendingRef.current.delete(id);
    setPendingFavorites(new Set(pendingRef.current));
  }

  const withFavorites = useMemo(
    () =>
      exercises.map((ex) =>
        ex.id in favoriteOverrides ? { ...ex, isFavorite: favoriteOverrides[ex.id]! } : ex,
      ),
    [exercises, favoriteOverrides],
  );

  async function toggleFavorite(exercise: Exercise) {
    if (pendingRef.current.size > 0) return;
    const next = !exercise.isFavorite;
    const hadOverride = exercise.id in favoriteOverrides;
    const previous = favoriteOverrides[exercise.id];
    setPending(exercise.id, true);
    setFavoriteOverrides((current) => ({ ...current, [exercise.id]: next }));
    setFocusStarId(exercise.id);
    const res = await fetch(`/api/exercises/${exercise.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite: next }),
    }).catch(() => null);
    setPending(exercise.id, false);
    if (!res?.ok) {
      // Put back exactly what was shown before this tap, not the server prop,
      // which may still predate an earlier successful toggle.
      setFavoriteOverrides((current) => {
        const rest = { ...current };
        if (hadOverride) rest[exercise.id] = previous!;
        else delete rest[exercise.id];
        return rest;
      });
      // Bring focus back to the star only if the user has not moved on.
      const active = document.activeElement;
      if (!active || active === document.body || active === starRefs.current.get(exercise.id)) {
        setFocusStarId(exercise.id);
      }
      toast.error(t('favoriteError'));
      return;
    }
    router.refresh();
  }

  function rowProps(ex: Exercise) {
    return {
      exercise: ex,
      onEdit: () => setEditing(ex),
      onToggleFavorite: () => void toggleFavorite(ex),
      favoritePending: pendingFavorites.size > 0,
      starRef: (node: HTMLButtonElement | null) => {
        // React detaches the old node before attaching the moved one.
        if (node) starRefs.current.set(ex.id, node);
        else starRefs.current.delete(ex.id);
      },
    };
  }

  // Case- and accent-insensitive substring match on the exercise name, folded
  // with the active locale (lib/search-fold.ts). The query only narrows the
  // already-loaded list (no API call); an empty query shows everything,
  // preserving the original behaviour.
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return withFavorites;
    return withFavorites.filter(
      (ex) =>
        matchesSearch(ex.name, q, locale) || matchesSearch(exerciseName(ex.name), q, locale),
    );
  }, [exerciseName, locale, withFavorites, query]);

  // Favourites are pinned in their own section at the top and not repeated in
  // their muscle group below.
  const favorites = useMemo(() => filtered.filter((ex) => ex.isFavorite), [filtered]);
  const grouped = useMemo(() => groupByMuscle(filtered.filter((ex) => !ex.isFavorite)), [filtered]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('savedCount', { count: exercises.length })}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="min-h-tap">
          <Plus className="size-4" />
          <span className="ml-2">{common('actions.add')}</span>
        </Button>
      </div>

      {exercises.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="pl-9"
          />
        </div>
      )}

      {exercises.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyDescription')}</CardDescription>
          </CardHeader>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('noMatchTitle')}</CardTitle>
            <CardDescription>{t('noMatchDescription', { query: query.trim() })}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {favorites.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="exercise-favorites-heading">
              <h2
                id="exercise-favorites-heading"
                className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t('favorites')}
              </h2>
              <div className="flex flex-col gap-2">
                {favorites.map((ex) => (
                  <ExerciseRow key={ex.id} {...rowProps(ex)} />
                ))}
              </div>
            </section>
          )}
          {Object.entries(grouped).map(([group, list]) => (
            <section key={group} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`muscleGroups.${muscleGroupMessageKeys[group as MuscleGroup]}`)}
              </h2>
              <div className="flex flex-col gap-2">
                {list.map((ex) => (
                  <ExerciseRow key={ex.id} {...rowProps(ex)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ExerciseFormDialog open={createOpen} onOpenChange={setCreateOpen} mode="create" />
      <ExerciseFormDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        mode="edit"
        exercise={editing ?? undefined}
      />
    </div>
  );
}

function ExerciseRow({
  exercise,
  onEdit,
  onToggleFavorite,
  favoritePending,
  starRef,
}: {
  exercise: Exercise;
  onEdit: () => void;
  onToggleFavorite: () => void;
  favoritePending: boolean;
  starRef: (node: HTMLButtonElement | null) => void;
}) {
  const t = useTranslations('exercises');
  const exerciseName = useExerciseName();
  const displayName = exerciseName(exercise.name);

  // Mobile-first card (issue #330). Every tap target is 64px (the `tap` token),
  // so three of them in a trailing column would leave the name ~150px at 400px
  // wide and truncate it first. Instead: a fixed 64px technique slot leads the
  // row, the name takes the remaining width and may wrap to two lines, the
  // equipment label is compact plain text, and edit/delete sit on their own
  // full-width row below (inline again from `sm`).
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start gap-x-3 gap-y-1 p-3 sm:flex-nowrap">
        <ExerciseMediaDialog
          exerciseName={exercise.name}
          displayName={displayName}
          equipmentType={exercise.equipmentType}
          compact
        />
        <div className="min-w-0 flex-1 basis-40 py-0.5">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{displayName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="secondary">
              {t(`categories.${exerciseCategoryMessageKeys[exercise.category]}`)}
            </Badge>
            {/* One non-wrapping unit, so the separator never orphans at a line end. */}
            <span className="whitespace-nowrap">
              <span>
                {t(`equipmentTypesShort.${equipmentTypeMessageKeys[exercise.equipmentType]}`)}
              </span>
              <span aria-hidden="true"> &middot; </span>
              <span>{t('restSeconds', { seconds: exercise.defaultRestSec })}</span>
            </span>
          </div>
          {exercise.notes && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{exercise.notes}</p>
          )}
        </div>
        <div className="-mb-2 -mr-2 -mt-4 flex w-full shrink-0 items-center justify-end sm:-mt-2 sm:w-auto">
          <Button
            variant="ghost"
            size="icon"
            ref={starRef}
            onClick={onToggleFavorite}
            // aria-disabled rather than disabled, so the star keeps focus while
            // its save is in flight; the handler ignores the tap meanwhile.
            aria-disabled={favoritePending || undefined}
            aria-pressed={exercise.isFavorite}
            aria-label={t(exercise.isFavorite ? 'unfavorite' : 'favorite', { name: displayName })}
            className="min-h-tap min-w-tap aria-disabled:opacity-50"
          >
            <Star
              className={cn('size-4', exercise.isFavorite && 'fill-current text-amber-500')}
              aria-hidden
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onEdit}
            aria-label={t('editTitle')}
            className="min-h-tap min-w-tap"
          >
            <Pencil className="size-4" />
          </Button>
          <DeleteExerciseButton exerciseId={exercise.id} exerciseName={displayName} />
        </div>
      </CardContent>
    </Card>
  );
}

function groupByMuscle(exercises: Exercise[]): Record<string, Exercise[]> {
  const out: Record<string, Exercise[]> = {};
  for (const ex of exercises) {
    if (!out[ex.muscleGroup]) out[ex.muscleGroup] = [];
    out[ex.muscleGroup]!.push(ex);
  }
  return out;
}
