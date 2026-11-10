'use client';

import { useTranslations } from 'next-intl';
import { Check, Circle, CircleDot, CloudOff, Loader2, Trash2, Trophy } from 'lucide-react';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PendingSet } from '@/lib/indexeddb';
import { detectPRs, type PRType } from '@/lib/records';
import { formatCardioSet } from '@/lib/cardio';
import { formatEffort } from '@/lib/effort';
import { useEffortScale } from '@/components/shared/effort-scale-provider';

interface Props {
  programExercise: ProgramExercise & { exercise: Exercise };
  sets: PendingSet[];
  isInputActive: boolean;
  onDeleteSet: (set: PendingSet) => void;
  // Prior (previous-session) non-warmup sets for this exercise, used as the
  // baseline for PR detection. Optional: absent on the very first session.
  // This is the most recent session's data (from getLastPerformances), so a
  // badge means "beats your last session" rather than an all-time record - an
  // all-time baseline would need a separate query and is out of scope here.
  priorSets?: { weight: number; reps: number }[];
}

const PR_LABEL_KEYS = { weight: 'weightPr', e1rm: 'oneRmPr' } as const;
const PR_TITLE_KEYS = { weight: 'weightPrTitle', e1rm: 'oneRmPrTitle' } as const;

export function SetsList({ programExercise, sets, isInputActive, onDeleteSet, priorSets }: Props) {
  const t = useTranslations('session.setsList');
  const completedNonWarmup = sets.filter((s) => !s.isWarmup);
  const totalRows = Math.max(programExercise.targetSets, completedNonWarmup.length + 1);
  const currentSetNumber = completedNonWarmup.length + 1;

  // PR detection runs on read against a baseline of the previous session plus
  // any earlier sets already logged in this session, so a second set only
  // counts as a PR if it beats the first one too.
  const baseline = (priorSets ?? []).map((s) => ({ ...s, isWarmup: false }));

  function prsFor(set: PendingSet, index: number): PRType[] {
    if (set.isWarmup) return [];
    const earlierThisSession = sets
      .slice(0, index)
      .filter((s) => !s.isWarmup)
      .map((s) => ({ weight: s.weight, reps: s.reps, isWarmup: false }));
    return detectPRs(set, [...baseline, ...earlierThisSession]);
  }

  return (
    <div className="rounded-lg border border-border">
      {sets.map((s, i) => (
        <RowDone key={s.localId} set={s} prs={prsFor(s, i)} onDelete={() => onDeleteSet(s)} />
      ))}

      {Array.from({ length: totalRows - sets.length }, (_, i) => {
        const setNum = completedNonWarmup.length + 1 + i;
        const isCurrent = i === 0 && isInputActive;
        return <RowUpcoming key={`upcoming-${setNum}`} setNumber={setNum} isCurrent={isCurrent} />;
      })}

      {!isInputActive && completedNonWarmup.length === 0 && sets.length === 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {t('noneDuringRest', { number: currentSetNumber })}
        </div>
      )}
    </div>
  );
}

function RowDone({
  set,
  prs,
  onDelete,
}: {
  set: PendingSet;
  prs: PRType[];
  onDelete: () => void;
}) {
  const t = useTranslations('session.setsList');
  const effortScale = useEffortScale();
  const weightLabel = set.weight === 0 ? t('bodyweight') : `${set.weight} kg`;
  // Cardio sets (issue #133) render as duration/distance, never weight x reps.
  const isCardio = set.durationSec != null;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <SyncIcon status={set.status} />
        <span className="text-sm font-medium">
          {t('set', { number: set.setNumber })}
          {set.isWarmup ? t('warmup') : ''}
          {set.isDropSet ? t('drop') : ''}
        </span>
        <span className="truncate text-sm text-muted-foreground">
          {isCardio ? (
            formatCardioSet(set.durationSec!, set.distanceM)
          ) : (
            <>
              {weightLabel} × {set.reps}
              {set.rir != null && ` · ${formatEffort(effortScale, set.rir)}`}
            </>
          )}
        </span>
        {prs.map((pr) => (
          <Badge key={pr} className="gap-1 text-xs" title={t(PR_TITLE_KEYS[pr])}>
            <Trophy className="size-3" />
            {t(PR_LABEL_KEYS[pr])}
          </Badge>
        ))}
        {set.notes && (
          <Badge variant="secondary" className="text-xs">
            {t('note')}
          </Badge>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        aria-label={t('delete')}
        className="size-8 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

function SyncIcon({ status }: { status: PendingSet['status'] }) {
  if (status === 'synced') return <Check className="size-4 flex-shrink-0 text-primary" />;
  if (status === 'syncing')
    return <Loader2 className="size-4 flex-shrink-0 animate-spin text-muted-foreground" />;
  if (status === 'failed')
    return <CloudOff className="size-4 flex-shrink-0 text-amber-500" />;
  // 'pending'
  return <CloudOff className="size-4 flex-shrink-0 text-muted-foreground" />;
}

function RowUpcoming({ setNumber, isCurrent }: { setNumber: number; isCurrent: boolean }) {
  const t = useTranslations('session.setsList');

  return (
    <div
      className={`flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0 ${
        isCurrent ? 'bg-primary/5' : ''
      }`}
    >
      {isCurrent ? (
        <CircleDot className="size-4 flex-shrink-0 text-primary" />
      ) : (
        <Circle className="size-4 flex-shrink-0 text-muted-foreground" />
      )}
      <span className={`text-sm ${isCurrent ? 'font-medium' : 'text-muted-foreground'}`}>
        {isCurrent ? t('current', { number: setNumber }) : t('upcoming', { number: setNumber })}
      </span>
    </div>
  );
}
