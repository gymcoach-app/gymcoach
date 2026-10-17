'use client';

import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, HelpCircle, Lightbulb, MoreHorizontal, TrendingUp } from 'lucide-react';
import type { Exercise, ProgramExercise, WeightUnit } from '@/lib/prisma-client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { exerciseCategoryMessageKeys, muscleGroupMessageKeys } from '@/i18n/enum-keys';
import {
  suggestNextWeight,
  SORENESS_HOLD_AT_OR_ABOVE,
  type ReadinessSignal,
} from '@/lib/progression';
import { formatWeight } from '@/lib/units';
import { formatCardioSet } from '@/lib/cardio';
import type { SerializedLastPerformance } from './session-runner';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import type { GymLoadConstraints } from '@/lib/gym-loads';
import { ExerciseMediaDialog } from '@/components/exercises/exercise-media-dialog';

// Last-session reference line for a cardio exercise (issue #176): duration and
// distance via the shared cardio formatter, with average heart rate appended
// when the previous session recorded one. Distance and bpm are simply omitted
// when absent, so a duration-only cardio set shows just the duration.
function cardioLastLine(cardio: NonNullable<SerializedLastPerformance['cardio']>): string {
  const base = formatCardioSet(cardio.durationSec, cardio.distanceM);
  return cardio.avgHr != null ? `${base} · ${cardio.avgHr} bpm` : base;
}

interface Props {
  programExercise: ProgramExercise & { exercise: Exercise };
  lastPerformance: SerializedLastPerformance | undefined;
  // Calendar days since this exercise's last working set (issue #459): null
  // when it was never done, undefined to show no "last done" line.
  lastDoneDaysAgo?: number | null;
  readiness: ReadinessSignal | null;
  // True while a planned deload week is active (issue #112).
  deloadActive: boolean;
  unit: WeightUnit;
  gymName?: string | null;
  loadConstraints?: GymLoadConstraints | null;
  onOpenMenu?: () => void;
  // The button stays rendered while disabled (during a rest) so the header
  // keeps its height across the set/rest transition.
  menuDisabled?: boolean;
}

export function ExerciseCard({
  programExercise,
  lastPerformance,
  lastDoneDaysAgo,
  readiness,
  deloadActive,
  unit,
  gymName = null,
  loadConstraints = null,
  onOpenMenu,
  menuDisabled = false,
}: Props) {
  const t = useTranslations('session.exerciseCard');
  const exerciseT = useTranslations('exercises');
  const locale = useLocale();
  const exerciseName = useExerciseName();
  const format = useFormatter();
  const [notesOpen, setNotesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const exo = programExercise.exercise;
  // Cardio exercises (issue #133) are duration/distance based: the weight x
  // reps targets, load suggestion and last-performance load make no sense for
  // them, so those blocks are hidden.
  const isCardio = exo.category === 'CARDIO';

  const repsLabel =
    programExercise.targetRepsMin === programExercise.targetRepsMax
      ? `${programExercise.targetRepsMin}`
      : `${programExercise.targetRepsMin}-${programExercise.targetRepsMax}`;

  const suggestion = suggestNextWeight(
    programExercise,
    lastPerformance?.sets ?? [],
    readiness,
    deloadActive,
    loadConstraints,
  );
  const groupSoreness = readiness?.soreness?.[exo.muscleGroup];
  const sorenessHigh =
    typeof groupSoreness === 'number' && groupSoreness >= SORENESS_HOLD_AT_OR_ABOVE;
  const readinessNote =
    suggestion.reason === 'planned-deload'
      ? t('readiness.planned')
      : suggestion.reason === 'readiness-deload'
        ? t(sorenessHigh ? 'readiness.sorenessLighter' : 'readiness.readinessLighter')
        : suggestion.reason === 'readiness-hold'
          ? t(sorenessHigh ? 'readiness.sorenessHeld' : 'readiness.readinessHeld')
          : null;
  const working = formatWeight(suggestion.workingWeight ?? 0, unit, {
    decimals: 2,
    group: false,
    locale,
  });
  const suggestionHelp =
    suggestion.reason === 'progression'
      ? t('help.progression', {
          reps: suggestion.targetRepsMax ?? programExercise.targetRepsMax,
          weight: working,
          delta: formatWeight(suggestion.delta ?? 0, unit, {
            decimals: 2,
            group: false,
            locale,
          }),
        })
      : suggestion.reason === 'readiness-hold'
        ? t('help.readinessHold', { weight: working })
        : suggestion.reason === 'readiness-deload'
          ? t('help.readinessDeload', { weight: working })
          : suggestion.reason === 'planned-deload'
            ? t('help.plannedDeload', { weight: working })
            : t('help.hold', {
                reps: suggestion.targetRepsMax ?? programExercise.targetRepsMax,
              });
  const lastDate = lastPerformance
    ? format.dateTime(new Date(lastPerformance.sessionStartedAt), {
        day: '2-digit',
        month: '2-digit',
      })
    : null;

  return (
    <Card className="min-w-0">
      <CardHeader className="min-w-0 pb-3">
        <div className="flex min-w-0 items-start gap-1">
          <div
            data-testid="exercise-title-scroll"
            className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <h2 className="w-max min-w-full whitespace-nowrap text-xl font-bold tracking-tight sm:text-2xl">
              {exerciseName(exo.name)}
            </h2>
          </div>
          {onOpenMenu && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onOpenMenu}
              disabled={menuDisabled}
              aria-label={t('actions')}
              className="-mr-2 -mt-2 min-h-tap min-w-tap shrink-0"
            >
              <MoreHorizontal className="size-5" aria-hidden />
            </Button>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge variant="secondary">
            {exerciseT(`muscleGroups.${muscleGroupMessageKeys[exo.muscleGroup]}`)}
          </Badge>
          <Badge variant="outline">
            {exerciseT(`categories.${exerciseCategoryMessageKeys[exo.category]}`)}
          </Badge>
          {gymName && <Badge variant="outline">{gymName}</Badge>}
          {loadConstraints?.isAvailable === false && (
            <Badge variant="destructive">{t('notAvailable')}</Badge>
          )}
        </div>
        {lastDoneDaysAgo !== undefined && (
          <p className="mt-1 text-xs text-muted-foreground" data-testid="exercise-last-done">
            {lastDoneDaysAgo === null ? t('lastDoneNever') : t('lastDone', { days: lastDoneDaysAgo })}
          </p>
        )}
        <ExerciseMediaDialog
          exerciseName={exo.name}
          displayName={exerciseName(exo.name)}
          equipmentType={exo.equipmentType}
        />
        {/* Exercise cue (issue #224): when the exercise carries a technique
            note, surface it as an always-visible muted line right under the
            header so the form reminder is there exactly while logging the set.
            This is the exercise's own notes; the per-set quick-note field and
            the collapsible program-notes block below are unchanged. */}
        {exo.notes && (
          <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
            <Lightbulb className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="whitespace-pre-line">{exo.notes}</span>
          </p>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-0">
        <p className="text-sm font-medium">
          {isCardio ? (
            <>
              {t('cardioPrescription', {
                sets: programExercise.targetSets,
                seconds: programExercise.restSec,
              })}
            </>
          ) : (
            <>
              {t('strengthPrescription', {
                sets: programExercise.targetSets,
                reps: repsLabel,
                rir: programExercise.targetRIR,
                seconds: programExercise.restSec,
                tempo: programExercise.tempo ?? 'none',
              })}
            </>
          )}
        </p>

        {lastPerformance && (!isCardio || lastPerformance.cardio) && (
          <div className="rounded-md bg-secondary/50 p-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="text-xs">{t('lastSession', { date: lastDate ?? '' })}</span>
            </div>
            <p className="font-medium">
              {isCardio && lastPerformance.cardio
                ? cardioLastLine(lastPerformance.cardio)
                : lastPerformance.maxWeight === 0
                  ? t('bodyweightReps', { reps: lastPerformance.repsAtMaxWeight })
                  : t('weightedReps', {
                      weight: formatWeight(lastPerformance.maxWeight, unit, {
                        decimals: 2,
                        group: false,
                        locale,
                      }),
                      reps: lastPerformance.repsAtMaxWeight,
                    })}
            </p>
          </div>
        )}

        {!isCardio && suggestion.weight != null && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
            <div className="flex items-center gap-2">
              {suggestion.reason === 'progression' ? (
                <TrendingUp className="size-4 text-primary" />
              ) : (
                <Lightbulb className="size-4 text-primary" />
              )}
              <span className="flex-1">
                {t('suggestion')}{' '}
                <span className="font-medium">
                  {suggestion.weight === 0
                    ? t('bodyweight')
                    : formatWeight(suggestion.weight, unit, {
                        decimals: 2,
                        group: false,
                        locale,
                      })}
                </span>
                {suggestion.reason === 'progression' && suggestion.delta && (
                  <span className="ml-1 text-xs text-primary">
                    (+
                    {formatWeight(suggestion.delta, unit, {
                      decimals: 2,
                      group: false,
                      locale,
                    })}
                    )
                  </span>
                )}
                {readinessNote && (
                  <Badge variant="secondary" className="ml-2 align-middle">
                    {readinessNote}
                  </Badge>
                )}
              </span>
              <button
                type="button"
                onClick={() => setHelpOpen((v) => !v)}
                aria-label={t('suggestionHelp')}
                aria-expanded={helpOpen}
                className="text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="size-4" />
              </button>
            </div>
            {helpOpen && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{suggestionHelp}</p>
            )}
          </div>
        )}

        {programExercise.notes && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNotesOpen((v) => !v)}
              className="-ml-2"
            >
              {notesOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              <span className="ml-1">{t('notes')}</span>
            </Button>
            {notesOpen && (
              <div className="mt-2 space-y-2 rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                {/* The exercise's own notes are the always-visible cue under the
                    header; this block holds only the program-specific note so
                    the same text is never shown twice. */}
                {programExercise.notes && (
                  <p className="whitespace-pre-line">{programExercise.notes}</p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
