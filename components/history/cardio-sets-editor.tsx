'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AVG_HR_MAX,
  AVG_HR_MIN,
  formatDuration,
  MAX_HR_MAX,
  MAX_HR_MIN,
  parseDurationToSec,
} from '@/lib/cardio';
import { distanceInputToM, distanceMToInput, distanceUnitLabel } from '@/lib/cardio-target';
import { useDistanceUnit } from '@/components/shared/distance-unit-provider';

export interface CardioSetValues {
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
}

export interface CardioEditorSet extends CardioSetValues {
  id: string;
  setNumber: number;
}

interface Props {
  sets: CardioEditorSet[];
  // True while the session itself is being saved: nothing can be changed.
  disabled?: boolean;
  // Each resolves to true once the server accepted the change.
  onAdd: (values: CardioSetValues) => Promise<boolean>;
  onSave: (set: CardioEditorSet, values: CardioSetValues) => Promise<boolean>;
  onDelete: (set: CardioEditorSet) => Promise<boolean>;
}

interface Draft {
  duration: string;
  distance: string;
  avgHr: string;
  maxHr: string;
}

const EMPTY_DRAFT: Draft = { duration: '', distance: '', avgHr: '', maxHr: '' };
const GRID = 'grid grid-cols-[2rem_minmax(4.5rem,1fr)_minmax(4rem,1fr)_4rem_4rem_5.5rem] items-center gap-1';

// An optional heart rate field: empty is null, anything out of range is
// undefined (invalid).
function parseHeartRate(input: string, min: number, max: number): number | null | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^\d{2,3}$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : undefined;
}

// The cardio sets of one exercise in the history editor (issue #389): the
// fields a cardio set is logged with (duration, distance, heart rate), edited
// in place, with a row to add a set. Strength sets use EditableSetsTable.
export function CardioSetsEditor({ sets, disabled = false, onAdd, onSave, onDelete }: Props) {
  const t = useTranslations('history.edit');
  const detail = useTranslations('history.detail');
  const locale = useLocale();
  const distanceUnit = useDistanceUnit();
  const unitLabel = distanceUnitLabel(distanceUnit, locale);
  // Drafts of the rows being typed in, by set id. A row without a draft shows
  // what is stored.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [activeId, setBusyId] = useState<string | null>(null);
  // One write at a time, and none while the caller says so.
  const busyId = activeId ?? (disabled ? 'disabled' : null);
  const nextNumber = Math.max(0, ...sets.map((set) => set.setNumber)) + 1;

  function storedDraft(set: CardioEditorSet): Draft {
    return {
      duration: formatDuration(set.durationSec),
      distance: distanceMToInput(set.distanceM, distanceUnit),
      avgHr: set.avgHr == null ? '' : String(set.avgHr),
      maxHr: set.maxHr == null ? '' : String(set.maxHr),
    };
  }

  function parse(draft: Draft, shownM: (number | null)[]): CardioSetValues | null {
    const durationSec = parseDurationToSec(draft.duration);
    const distanceM = distanceInputToM(draft.distance, distanceUnit, shownM);
    const avgHr = parseHeartRate(draft.avgHr, AVG_HR_MIN, AVG_HR_MAX);
    const maxHr = parseHeartRate(draft.maxHr, MAX_HR_MIN, MAX_HR_MAX);
    if (durationSec == null || distanceM === undefined || avgHr === undefined || maxHr === undefined) {
      return null;
    }
    return { durationSec, distanceM, avgHr, maxHr };
  }

  function dropDraft(id: string) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  async function save(set: CardioEditorSet) {
    const draft = drafts[set.id];
    if (!draft || busyId) return;
    const values = parse(draft, [set.distanceM]);
    if (!values) {
      toast.error(t('cardioInvalid'));
      return;
    }
    setBusyId(set.id);
    try {
      if (await onSave(set, values)) {
        dropDraft(set.id);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function remove(set: CardioEditorSet) {
    if (busyId) return;
    setBusyId(set.id);
    try {
      if (await onDelete(set)) {
        dropDraft(set.id);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function add() {
    if (busyId) return;
    const values = parse(newDraft, []);
    if (!values) {
      toast.error(t('cardioInvalid'));
      return;
    }
    setBusyId('new');
    try {
      if (await onAdd(values)) setNewDraft(EMPTY_DRAFT);
    } finally {
      setBusyId(null);
    }
  }

  function fields(
    number: number,
    draft: Draft,
    onDraft: (draft: Draft) => void,
    disabled: boolean,
  ) {
    return (
      <>
        <Input
          value={draft.duration}
          disabled={disabled}
          inputMode="decimal"
          placeholder="25:00"
          aria-label={t('cardioDuration', { number })}
          className="h-9 px-2 text-center"
          onChange={(event) => onDraft({ ...draft, duration: event.target.value })}
        />
        <Input
          value={draft.distance}
          disabled={disabled}
          inputMode="decimal"
          aria-label={t('cardioDistance', { number, unit: unitLabel })}
          className="h-9 px-2 text-center"
          onChange={(event) => onDraft({ ...draft, distance: event.target.value })}
        />
        <Input
          value={draft.avgHr}
          disabled={disabled}
          inputMode="numeric"
          aria-label={t('cardioAvgHr', { number })}
          className="h-9 px-2 text-center"
          onChange={(event) => onDraft({ ...draft, avgHr: event.target.value })}
        />
        <Input
          value={draft.maxHr}
          disabled={disabled}
          inputMode="numeric"
          aria-label={t('cardioMaxHr', { number })}
          className="h-9 px-2 text-center"
          onChange={(event) => onDraft({ ...draft, maxHr: event.target.value })}
        />
      </>
    );
  }

  return (
    <section className="overflow-hidden rounded-md border border-border">
      <div className="overflow-x-auto overscroll-x-contain">
        <div className="min-w-[27rem]">
          <div
            className={`${GRID} border-b border-border bg-muted/30 px-2 py-2 text-center text-[0.6875rem] font-medium uppercase text-muted-foreground`}
          >
            <span>#</span>
            <span>{detail('duration')}</span>
            <span>
              {detail('distance')} ({unitLabel})
            </span>
            <span>{detail('avgHr')}</span>
            <span>{detail('maxHr')}</span>
            <span />
          </div>
          {sets.map((set) => {
            const draft = drafts[set.id];
            const busy = busyId === set.id;
            return (
              <div
                key={set.id}
                data-testid={`cardio-set-row-${set.setNumber}`}
                className={`${GRID} border-b border-border px-2 py-2 text-sm tabular-nums`}
              >
                <span className="text-center text-muted-foreground">{set.setNumber}</span>
                {fields(
                  set.setNumber,
                  draft ?? storedDraft(set),
                  (next) => setDrafts((current) => ({ ...current, [set.id]: next })),
                  busyId != null,
                )}
                <span className="flex items-center justify-end">
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={!draft || busyId != null}
                        onClick={() => void save(set)}
                        aria-label={t('cardioSave', { number: set.setNumber })}
                        className="size-9"
                      >
                        <Check className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={busyId != null}
                        onClick={() => void remove(set)}
                        aria-label={t('cardioDelete', { number: set.setNumber })}
                        className="size-9 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
          <div className={`${GRID} bg-primary/5 px-2 py-2 text-sm tabular-nums`}>
            <span className="text-center font-semibold text-primary">{nextNumber}</span>
            {fields(nextNumber, newDraft, setNewDraft, busyId != null)}
            <span className="flex items-center justify-end">
              <Button
                type="button"
                size="icon"
                disabled={busyId != null || newDraft.duration.trim() === ''}
                onClick={() => void add()}
                aria-label={t('cardioAdd', { number: nextNumber })}
                className="size-9"
              >
                {busyId === 'new' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-5" />
                )}
              </Button>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
