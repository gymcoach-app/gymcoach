'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, Check, Trophy } from 'lucide-react';
import type { Exercise, ProgramExercise, Session, WeightUnit } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import type { PendingSet } from '@/lib/indexeddb';
import { formatWeight } from '@/lib/units';
import { detectPRs, type PRType } from '@/lib/records';
import { formatCardioSet, formatPace, formatSpeed } from '@/lib/cardio';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { blockIndexByRow, occurrenceCounts, rowBlockKey, setBlockKey } from '@/lib/exercise-blocks';

// Prior (previous-session) non-warmup sets per exerciseId, used as the PR
// baseline. Same source as the in-session badge (getLastPerformances): a PR
// here means "beats your last session", not an all-time record.
type PriorSets = Record<string, { weight: number; reps: number }[]>;

interface Props {
  session: Session;
  sets: PendingSet[];
  programExercises: (ProgramExercise & { exercise: Exercise })[];
  unit: WeightUnit;
  // Previous-session sets per exercise; absent entries mean no prior history.
  priorSets?: PriorSets;
  onBack: () => void;
  onFinish: () => Promise<void> | void;
  finishing: boolean;
}

export interface SessionPR {
  exerciseId: string;
  exerciseName: string;
  // The PR types achieved by any working set of this exercise this session.
  types: PRType[];
  // The heaviest working load of this session for the exercise (for display).
  bestWeight: number;
}

const PR_TYPE_KEYS = { weight: 'heaviest', e1rm: 'bestOneRm' } as const;

// Computes which exercises set a personal record during this session. PR math
// is reused from lib/records (detectPRs); the comparison baseline is the prior
// session's sets plus any earlier working set of the same exercise this
// session, so a set is never compared against itself.
export function computeSessionPRs(
  sets: PendingSet[],
  programExercises: (ProgramExercise & { exercise: Exercise })[],
  priorSets: PriorSets,
): SessionPR[] {
  const prs: SessionPR[] = [];
  const seen = new Set<string>();

  for (const pe of programExercises) {
    // A workout may list the same exercise more than once; the PR is per
    // exercise, so process each exerciseId at most once (also keeps React keys
    // unique below).
    if (seen.has(pe.exerciseId)) continue;
    seen.add(pe.exerciseId);

    const exoSets = sets.filter((s) => s.exerciseId === pe.exerciseId && !s.isWarmup);
    if (exoSets.length === 0) continue;

    const baseline = (priorSets[pe.exerciseId] ?? []).map((s) => ({ ...s, isWarmup: false }));
    const achieved = new Set<PRType>();
    const earlier: { weight: number; reps: number; isWarmup: boolean }[] = [];

    for (const set of exoSets) {
      const candidate = { weight: set.weight, reps: set.reps, isWarmup: false };
      for (const type of detectPRs(candidate, [...baseline, ...earlier])) {
        achieved.add(type);
      }
      earlier.push(candidate);
    }

    if (achieved.size === 0) continue;

    // Preserve a stable type order: weight before e1rm.
    const types: PRType[] = (['weight', 'e1rm'] as PRType[]).filter((t) => achieved.has(t));
    prs.push({
      exerciseId: pe.exerciseId,
      exerciseName: pe.exercise.name,
      types,
      bestWeight: Math.max(...exoSets.map((s) => s.weight)),
    });
  }

  return prs;
}

export function SessionSummary({
  session,
  sets,
  programExercises,
  unit,
  priorSets = {},
  onBack,
  onFinish,
  finishing,
}: Props) {
  const t = useTranslations('session.summary');
  const locale = useLocale();
  const exerciseName = useExerciseName();
  const [notes, setNotes] = useState(session.notes ?? '');

  const sessionPRs = computeSessionPRs(sets, programExercises, priorSets);

  const durationMin = Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000);
  const totalSets = sets.filter((s) => !s.isWarmup).length;
  // Cardio sets (issue #133) store reps = 1 / weight = 0 by convention, so
  // they are excluded from the rep count (and contribute 0 to the volume).
  const totalReps = sets.reduce((acc, s) => acc + (s.durationSec != null ? 0 : s.reps), 0);
  const totalVolume = sets.reduce(
    (acc, s) => acc + (s.durationSec != null ? 0 : s.weight * s.reps),
    0,
  );

  // Per block (issue #429): a deliberately repeated exercise (5/3/1 BBB)
  // shows each row with its own sets; otherwise the key is the exerciseId.
  const rowBlocks = blockIndexByRow(programExercises);
  const occurrences = occurrenceCounts(programExercises);
  const exerciseStats = programExercises.map((pe) => {
    const key = rowBlockKey(pe, rowBlocks);
    const exoSets = sets.filter((s) => setBlockKey(s, occurrences) === key && !s.isWarmup);
    const targetSets = pe.targetSets;
    const isCardio = pe.exercise.category === 'CARDIO';
    return {
      pe,
      doneSets: exoSets.length,
      targetSets,
      maxWeight: isCardio || exoSets.length === 0 ? 0 : Math.max(...exoSets.map((s) => s.weight)),
      // Cardio recap: total duration and distance across the logged sets,
      // plus derived pace and speed (issue #177) when the session covered a
      // distance. Pace/speed are omitted for duration-only cardio.
      cardioLabel:
        isCardio && exoSets.length
          ? cardioRecap(
              exoSets.reduce((acc, s) => acc + (s.durationSec ?? 0), 0),
              exoSets.reduce((acc, s) => acc + (s.distanceM ?? 0), 0),
              unit,
            )
          : null,
      complete: exoSets.length >= targetSets,
    };
  });

  async function handleClose() {
    // Save the notes before closing if they changed.
    if (notes && notes !== (session.notes ?? '')) {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        toast.error(t('noteSaveError'));
        return;
      }
    }
    await onFinish();
  }

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
        <Button variant="ghost" size="sm" onClick={onBack} className="self-start">
          <ChevronLeft className="size-4" />
          <span className="ml-1">{t('back')}</span>
        </Button>

        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>

        <div className="grid grid-cols-3 gap-3">
          <Stat label={t('duration')} value={t('minutes', { count: durationMin })} />
          <Stat label={t('sets')} value={totalSets} />
          <Stat
            label={t('volume')}
            value={formatWeight(totalVolume, unit, { decimals: 0, locale })}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t('volumeFormula', { reps: totalReps })}</p>

        {sessionPRs.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Trophy className="size-4 text-primary" />
                {t('records')}
              </CardTitle>
              <CardDescription>{t('bests')}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="divide-y divide-border">
                {sessionPRs.map((pr) => (
                  <li
                    key={pr.exerciseId}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate font-medium">
                      {exerciseName(pr.exerciseName)}
                    </span>
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      {pr.types.map((type) => (
                        <Badge key={type} className="gap-1 text-xs">
                          <Trophy className="size-3" />
                          {t(PR_TYPE_KEYS[type])}
                        </Badge>
                      ))}
                      <span className="text-xs text-muted-foreground">
                        {formatWeight(pr.bestWeight, unit, {
                          decimals: 2,
                          group: false,
                          locale,
                        })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('exercises')}</CardTitle>
            <CardDescription>{t('exerciseProgress')}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y divide-border">
              {exerciseStats.map((s) => (
                <li key={s.pe.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    {s.complete ? (
                      <Check className="size-4 text-primary" />
                    ) : (
                      <span className="size-4 flex-shrink-0 rounded-full border border-muted-foreground/40" />
                    )}
                    <span className="truncate">{exerciseName(s.pe.exercise.name)}</span>
                  </div>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    {t('setProgress', { done: s.doneSets, target: s.targetSets })}
                    {s.cardioLabel
                      ? ` · ${s.cardioLabel}`
                      : s.maxWeight > 0
                        ? t('maxWeight', {
                            weight: formatWeight(s.maxWeight, unit, {
                              decimals: 2,
                              group: false,
                              locale,
                            }),
                          })
                        : ''}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <Label htmlFor="session-notes">{t('note')}</Label>
          <Textarea
            id="session-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('notePlaceholder')}
          />
        </div>

        <Button
          onClick={handleClose}
          disabled={finishing}
          className="h-16 w-full text-base font-semibold"
        >
          {finishing ? t('finishing') : t('finish')}
        </Button>
      </div>
    </main>
  );
}

// Cardio recap line for a session's totals: "30:00 · 5 km · 6:00 /km · 10 km/h".
// Pace and speed (issue #177) are appended only when the session covered a
// distance; a duration-only cardio session shows just the duration.
function cardioRecap(durationSec: number, distanceM: number, unit: WeightUnit): string {
  const base = formatCardioSet(durationSec, distanceM);
  const pace = formatPace(durationSec, distanceM, unit);
  const speed = formatSpeed(durationSec, distanceM, unit);
  return [base, pace, speed].filter(Boolean).join(' · ');
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
