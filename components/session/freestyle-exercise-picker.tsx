'use client';

import { useMemo, useRef, useState } from 'react';
import { Search, Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { favoritesFirst } from '@/lib/exercise-favorites';
import { addedExerciseTargets } from '@/lib/freestyle';
import { matchesSearch } from '@/lib/search-fold';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { SessionCatalogExercise } from '@/components/session/session-exercise-menu';

// Empty state of a freestyle session (issue #388): the session has no
// exercise yet, so the runner has no card to hang the exercise menu on. The
// lifter picks the first exercise here; later ones go through the menu.
export function FreestyleExercisePicker({
  sessionId,
  catalog,
  onAdded,
}: {
  sessionId: string;
  catalog: SessionCatalogExercise[];
  onAdded: () => void;
}) {
  const t = useTranslations('session');
  const menu = useTranslations('session.exerciseMenu');
  const exerciseName = useExerciseName();
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  // `busy` disables the buttons on the next render; the ref closes the gap
  // for a second tap that arrives before that render.
  const inFlight = useRef(false);

  const choices = useMemo(() => {
    const needle = query.trim();
    if (!needle) return favoritesFirst(catalog);
    return favoritesFirst(
      catalog.filter(
        (exercise) =>
          matchesSearch(exercise.name, needle, locale) ||
          matchesSearch(exerciseName(exercise.name), needle, locale),
      ),
    );
  }, [catalog, exerciseName, locale, query]);

  async function addExercise(exercise: SessionCatalogExercise) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch(
        '/api/sessions/' + encodeURIComponent(sessionId) + '/exercises',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(addedExerciseTargets(exercise)),
        },
      );
      // 409: the exercise is already on the list (a double tap that got
      // through, or another tab). The refresh below shows it either way.
      if (!response.ok && response.status !== 409) {
        toast.error(menu('addError'));
        return;
      }
      onAdded();
    } catch {
      toast.error(menu('addError'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('freestyleEmptyTitle')}</CardTitle>
        <CardDescription>{t('freestyleEmptyDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={menu('searchExercises')}
            className="pl-9"
            aria-label={menu('searchExercises')}
          />
        </div>
        <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {choices.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{menu('noExercises')}</p>
          ) : (
            choices.map((exercise) => (
              <Button
                key={exercise.id}
                type="button"
                variant="ghost"
                className="min-h-tap justify-start"
                disabled={busy}
                onClick={() => void addExercise(exercise)}
                aria-label={
                  exercise.isFavorite
                    ? menu('favoriteChoice', { name: exerciseName(exercise.name) })
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
      </CardContent>
    </Card>
  );
}
