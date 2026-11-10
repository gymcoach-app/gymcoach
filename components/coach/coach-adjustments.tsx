'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import type { Adjustment } from '@/lib/coach-adjustments';
import type { ProgramExerciseDefaults } from './coach-client';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { useEffortScale } from '@/components/shared/effort-scale-provider';
import { EffortInput } from '@/components/shared/effort-input';

interface Props {
  debriefId: string;
  initialAdjustments: Adjustment[];
  programDefaults: Record<string, ProgramExerciseDefaults>;
  alreadyApplied: boolean;
  onApplied: (appliedAt: string) => void;
}

interface Row {
  selected: boolean;
  data: Adjustment;
}

export function CoachAdjustments({
  debriefId,
  initialAdjustments,
  programDefaults,
  alreadyApplied,
  onApplied,
}: Props) {
  const t = useTranslations('coach.adjustments');
  const exerciseName = useExerciseName();
  // The effort target is shown and edited on the user's scale; the adjustment
  // keeps the stored RIR (issue #390).
  const effortScale = useEffortScale();
  const [rows, setRows] = useState<Row[]>(() =>
    initialAdjustments.map((a) => {
      const def = programDefaults[a.exerciseName];
      return {
        selected: !alreadyApplied,
        data: {
          ...a,
          suggestedRepsMin: a.suggestedRepsMin ?? def?.targetRepsMin ?? null,
          suggestedRepsMax: a.suggestedRepsMax ?? def?.targetRepsMax ?? null,
          suggestedSets: a.suggestedSets ?? def?.targetSets ?? null,
          suggestedRIR: a.suggestedRIR ?? def?.targetRIR ?? null,
          suggestedRestSec: a.suggestedRestSec ?? def?.restSec ?? null,
        },
      };
    }),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (initialAdjustments.length === 0) return null;

  function patchRow(index: number, patch: Partial<Adjustment>) {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, data: { ...r.data, ...patch } } : r)));
  }

  function toggleRow(index: number, selected: boolean) {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, selected } : r)));
  }

  async function applyAll() {
    const selected = rows.filter((r) => r.selected).map((r) => r.data);
    if (selected.length === 0) {
      setError('Select at least one adjustment.');
      return;
    }
    setPending(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/coach/${debriefId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustments: selected }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Error ${res.status}`);
      }
      const j = (await res.json()) as {
        appliedAt: string;
        applied: { exerciseName: string }[];
        skipped: { exerciseName: string; reason: string }[];
      };
      const skippedMsg =
        j.skipped.length > 0
          ? ` (${j.skipped.length} skipped: ${j.skipped
              .map((s) => exerciseName(s.exerciseName))
              .join(', ')})`
          : '';
      setFeedback(
        `${j.applied.length} adjustment${j.applied.length > 1 ? 's' : ''} applied${skippedMsg}.`,
      );
      onApplied(j.appliedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setPending(false);
    }
  }

  const selectedCount = rows.filter((r) => r.selected).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-5" />
            <h2 className="text-base font-semibold">{t('title')}</h2>
          </div>
          {alreadyApplied && <Badge variant="secondary">{t('applied')}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-3">
          {rows.map((row, i) => (
            <li
              key={i}
              className={`rounded-md border p-3 transition-colors ${
                row.selected ? 'border-primary/40 bg-primary/5' : 'border-border'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{exerciseName(row.data.exerciseName)}</p>
                  <p className="text-sm">{row.data.summary}</p>
                  {row.data.rationale && (
                    <p className="mt-1 text-xs text-muted-foreground">{row.data.rationale}</p>
                  )}
                </div>
                <Switch
                  checked={row.selected}
                  onCheckedChange={(v) => toggleRow(i, v)}
                  disabled={pending}
                  aria-label={t('aria', { exercise: exerciseName(row.data.exerciseName) })}
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <NumberField
                  label={t('repsMin')}
                  value={row.data.suggestedRepsMin ?? null}
                  onChange={(v) => patchRow(i, { suggestedRepsMin: v })}
                  disabled={!row.selected || pending}
                />
                <NumberField
                  label={t('repsMax')}
                  value={row.data.suggestedRepsMax ?? null}
                  onChange={(v) => patchRow(i, { suggestedRepsMax: v })}
                  disabled={!row.selected || pending}
                />
                <NumberField
                  label={t('sets')}
                  value={row.data.suggestedSets ?? null}
                  onChange={(v) => patchRow(i, { suggestedSets: v })}
                  disabled={!row.selected || pending}
                />
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {effortScale}
                  </span>
                  <EffortInput
                    aria-label={effortScale}
                    rir={row.data.suggestedRIR ?? null}
                    onRirChange={(rir) => patchRow(i, { suggestedRIR: rir })}
                    disabled={!row.selected || pending}
                    className="h-9 text-center text-sm"
                  />
                </div>
                <NumberField
                  label={t('rest')}
                  value={row.data.suggestedRestSec ?? null}
                  onChange={(v) => patchRow(i, { suggestedRestSec: v })}
                  disabled={!row.selected || pending}
                />
                {row.data.suggestedLoad != null && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t('targetLoad')}
                    </span>
                    <span className="text-sm font-medium">
                      {row.data.suggestedLoad} kg
                      {row.data.currentLoad != null && t('versus', { value: row.data.currentLoad })}
                    </span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 border-t border-border/40 pt-3">
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {feedback && <p className="text-sm text-emerald-600">{feedback}</p>}
          <Button
            type="button"
            onClick={applyAll}
            disabled={pending || selectedCount === 0}
            className="min-h-tap"
          >
            {pending ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                <span className="ml-2">{t('applying')}</span>
              </>
            ) : (
              <>
                <Check className="size-5" />
                <span className="ml-2">{t('apply', { count: selectedCount })}</span>
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <Input
        type="number"
        inputMode="numeric"
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') onChange(null);
          else {
            const n = parseInt(raw, 10);
            onChange(Number.isNaN(n) ? null : n);
          }
        }}
        disabled={disabled}
        className="h-9 text-center text-sm"
      />
    </div>
  );
}
