'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Pencil, RotateCcw, Trash2, Trophy } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { Exercise, ProgramExercise, WeightUnit } from '@/lib/prisma-client';
import type { PendingSet } from '@/lib/indexeddb';
import type { SerializedLastPerformance } from '@/components/session/session-runner';
import {
  LiveEquipmentWeightEditor,
  type LiveEquipmentOption,
} from '@/components/session/live-equipment-weight-editor';
import type { IntraSetRecommendation } from '@/lib/intra-set-autoregulation';
import type { GymLoadConstraints } from '@/lib/gym-loads';
import { constrainGymWeight, gymWeightOptions } from '@/lib/gym-loads';
import { suggestNextWeight, type ReadinessSignal } from '@/lib/progression';
import { estimate1RM, estimateRepMax } from '@/lib/stats';
import {
  loadPreferences,
  savePreferences,
  SET_TABLE_METRICS,
  setTableMetricEnabled,
  type SetTableMetric,
} from '@/lib/preferences';
import { formatWeight, fromDisplayWeight, roundWeight, toDisplayWeight } from '@/lib/units';
import { detectPRs, type PRType } from '@/lib/records';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SetValuePicker } from '@/components/session/set-value-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  programExercise: ProgramExercise & { exercise: Exercise };
  sets: PendingSet[];
  lastPerformance: SerializedLastPerformance | undefined;
  readiness: ReadinessSignal | null;
  deloadActive: boolean;
  unit: WeightUnit;
  recommendation?: IntraSetRecommendation | null;
  loadConstraints?: GymLoadConstraints | null;
  gymId?: string | null;
  equipmentOptions?: LiveEquipmentOption[];
  priorSets?: { weight: number; reps: number }[];
  disabled?: boolean;
  onSubmit: (values: {
    weight: number;
    reps: number;
    rir: number | null;
    durationSec: null;
    distanceM: null;
    isWarmup: false;
    isDropSet: false;
    notes: null;
    gymEquipmentId?: string | null;
  }) => Promise<void>;
  onEquipmentWeightsUpdated?: (
    equipment: LiveEquipmentOption,
    updatedExerciseIds: string[],
  ) => void;
  onDeleteSet: (set: PendingSet) => Promise<boolean | void> | boolean | void;
  onUpdateSet: (set: PendingSet, values: DraftSet) => Promise<void>;
}

interface DraftSet {
  weight: number;
  reps: number;
  rir: number | null;
}

const SINGLE_METRIC_GRID_COLUMNS = 'grid-cols-[2.5rem_minmax(5rem,1fr)_4.5rem_4rem_5rem_3.25rem]';
const DUAL_METRIC_GRID_COLUMNS =
  'grid-cols-[2.25rem_minmax(4.5rem,1fr)_4rem_3.75rem_4.5rem_4.5rem_3rem]';

function metricValue(metric: SetTableMetric, draft: DraftSet): number {
  if (metric === 'VOLUME') return draft.weight * draft.reps;
  return metric === '10RM'
    ? estimateRepMax(draft.weight, draft.reps, 10)
    : estimate1RM(draft.weight, draft.reps);
}

// Machines, cables and "other" items carry their own discrete loads: on those
// the physical item, not the exercise's gym configuration, decides which
// weights exist. Free-weight items keep the exercise's own constraints.
function equipmentLoadConstraints(
  base: GymLoadConstraints | null,
  equipment: LiveEquipmentOption | undefined,
): GymLoadConstraints | null {
  if (!equipment || !['MACHINE', 'CABLE', 'OTHER'].includes(equipment.equipmentType)) return base;
  return {
    ...(base ?? {}),
    equipmentType: equipment.equipmentType,
    weightOptions: equipment.weightOptions,
  };
}

function initialDraft(
  pe: Props['programExercise'],
  sets: PendingSet[],
  lastPerformance: SerializedLastPerformance | undefined,
  readiness: ReadinessSignal | null,
  deloadActive: boolean,
  loadConstraints: GymLoadConstraints | null,
): DraftSet {
  const workingSets = sets.filter((set) => !set.isWarmup);
  const previousRow = lastPerformance?.sets[workingSets.length];
  if (previousRow) {
    return { weight: previousRow.weight, reps: previousRow.reps, rir: previousRow.rir };
  }

  const lastWorking = workingSets.at(-1);
  if (lastWorking) {
    return { weight: lastWorking.weight, reps: lastWorking.reps, rir: lastWorking.rir };
  }

  if (lastPerformance) {
    const suggestion = suggestNextWeight(
      pe,
      lastPerformance.sets,
      readiness,
      deloadActive,
      loadConstraints,
    );
    return {
      weight: suggestion.weight ?? lastPerformance.maxWeight,
      reps:
        suggestion.reason === 'progression'
          ? pe.targetRepsMin
          : Math.max(pe.targetRepsMin, lastPerformance.repsAtMaxWeight),
      rir: pe.targetRIR,
    };
  }

  return {
    weight: 0,
    reps: Math.round((pe.targetRepsMin + pe.targetRepsMax) / 2),
    rir: pe.targetRIR,
  };
}

export function EditableSetsTable({
  programExercise,
  sets,
  lastPerformance,
  readiness,
  deloadActive,
  unit,
  recommendation = null,
  loadConstraints = null,
  gymId = null,
  equipmentOptions = [],
  priorSets = [],
  disabled = false,
  onSubmit,
  onEquipmentWeightsUpdated,
  onDeleteSet,
  onUpdateSet,
}: Props) {
  const t = useTranslations('session.editableSets');
  const inputT = useTranslations('session.input');
  const locale = useLocale();
  const [metrics, setMetrics] = useState<SetTableMetric[]>(['1RM']);
  const [draft, setDraft] = useState<DraftSet>(() =>
    initialDraft(programExercise, sets, lastPerformance, readiness, deloadActive, loadConstraints),
  );
  const [submitting, setSubmitting] = useState(false);
  const [editingSet, setEditingSet] = useState<{ set: PendingSet; draft: DraftSet } | null>(null);
  const [updatingSetId, setUpdatingSetId] = useState<string | null>(null);
  const [picker, setPicker] = useState<'weight' | 'reps' | null>(null);
  const [appliedRecommendationKey, setAppliedRecommendationKey] = useState<string | null>(null);
  const [gymEquipmentId, setGymEquipmentId] = useState('');
  const [weightEditorOpen, setWeightEditorOpen] = useState(false);
  const workingSets = useMemo(() => sets.filter((set) => !set.isWarmup), [sets]);
  const latestWorkingSetId = workingSets.at(-1)?.localId ?? null;
  // The exercise strip lets the lifter jump between exercises mid-entry. An
  // unconfirmed draft is parked per program row when they leave and restored
  // when they come back, as long as no set was logged there in between.
  const parkedDrafts = useRef(new Map<string, { draft: DraftSet; setCount: number }>());
  const shownRow = useRef({ id: programExercise.id, setCount: workingSets.length });
  const prT = useTranslations('session.setsList');
  const prBaseline = useMemo(
    () => priorSets.map((set) => ({ ...set, isWarmup: false })),
    [priorSets],
  );

  useEffect(() => {
    setMetrics(loadPreferences().setTableMetrics);
  }, []);

  function metricLabel(metric: SetTableMetric, short = false) {
    if (metric === '1RM') return t(short ? 'metrics.oneRmShort' : 'metrics.oneRm');
    if (metric === '10RM') return t(short ? 'metrics.tenRmShort' : 'metrics.tenRm');
    return t(short ? 'metrics.volumeShort' : 'metrics.volume');
  }

  function updateMetric(metric: SetTableMetric, enabled: boolean) {
    const next = setTableMetricEnabled(metrics, metric, enabled);
    if (next.length === metrics.length && next.every((value, index) => value === metrics[index])) {
      return;
    }
    const prefs = loadPreferences();
    savePreferences({ ...prefs, setTableMetrics: next });
    setMetrics(next);
  }

  function formatMetric(metric: SetTableMetric, values: DraftSet): string {
    const value = metricValue(metric, values);
    if (value <= 0) return '-';
    return formatWeight(value, unit, {
      decimals: 1,
      group: false,
      locale,
      withUnit: metric !== 'VOLUME',
    });
  }

  function prsFor(set: PendingSet, index: number): PRType[] {
    const earlierThisSession = workingSets
      .slice(0, index)
      .map((row) => ({ weight: row.weight, reps: row.reps, isWarmup: false }));
    return detectPRs(set, [...prBaseline, ...earlierThisSession]);
  }

  useEffect(() => {
    const previous = shownRow.current;
    if (previous.id !== programExercise.id) {
      parkedDrafts.current.set(previous.id, { draft, setCount: previous.setCount });
    }
    shownRow.current = { id: programExercise.id, setCount: workingSets.length };
    const parked = parkedDrafts.current.get(programExercise.id);
    if (parked && previous.id !== programExercise.id && parked.setCount === workingSets.length) {
      parkedDrafts.current.delete(programExercise.id);
      setDraft(parked.draft);
    } else {
      parkedDrafts.current.delete(programExercise.id);
      setDraft(
        initialDraft(
          programExercise,
          sets,
          lastPerformance,
          readiness,
          deloadActive,
          loadConstraints,
        ),
      );
    }
    setEditingSet(null);
    setPicker(null);
    setAppliedRecommendationKey(null);
    const recentEquipmentId = workingSets.at(-1)?.gymEquipmentId ?? '';
    setGymEquipmentId(
      equipmentOptions.some((equipment) => equipment.id === recentEquipmentId)
        ? recentEquipmentId
        : '',
    );
    // Re-seed when the active exercise or logged working-set count changes.
    // exerciseId is part of the key because an in-session replace keeps the
    // program row id: the draft of the old exercise must not carry over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programExercise.id, programExercise.exerciseId, workingSets.length]);

  useEffect(() => {
    if (gymEquipmentId && !equipmentOptions.some((equipment) => equipment.id === gymEquipmentId)) {
      setGymEquipmentId('');
    }
  }, [equipmentOptions, gymEquipmentId]);

  const selectedEquipment = equipmentOptions.find((equipment) => equipment.id === gymEquipmentId);
  const usesSelectedEquipmentWeights =
    selectedEquipment != null &&
    ['MACHINE', 'CABLE', 'OTHER'].includes(selectedEquipment.equipmentType);
  const canEditSelectedEquipment = gymId != null && usesSelectedEquipmentWeights;
  const effectiveLoadConstraints = useMemo(
    () => equipmentLoadConstraints(loadConstraints, selectedEquipment),
    [loadConstraints, selectedEquipment],
  );
  // A logged set is constrained by the equipment it was logged on, which is
  // not necessarily the one currently selected for the next set.
  function loadConstraintsForSet(set: PendingSet): GymLoadConstraints | null {
    return equipmentLoadConstraints(
      loadConstraints,
      equipmentOptions.find((equipment) => equipment.id === set.gymEquipmentId),
    );
  }
  // The picker edits either a logged row or the next set: its options and its
  // plate preview follow the equipment of the row it was opened for.
  const editedSet = editingSet?.set ?? null;
  const pickerLoadConstraints = useMemo(
    () =>
      editedSet
        ? equipmentLoadConstraints(
            loadConstraints,
            equipmentOptions.find((equipment) => equipment.id === editedSet.gymEquipmentId),
          )
        : effectiveLoadConstraints,
    [editedSet, effectiveLoadConstraints, equipmentOptions, loadConstraints],
  );
  const pickerReferenceWeight = editingSet?.draft.weight ?? draft.weight;

  const currentNumber = workingSets.length + 1;
  const totalRows = Math.max(programExercise.targetSets, currentNumber);
  // Same formatting as the confirmed rows, so a picked value reads identically
  // before and after logging.
  const displayWeight = formatWeight(draft.weight, unit, {
    decimals: 2,
    group: false,
    locale,
    withUnit: false,
  });
  const gridColumns = metrics.length > 1 ? DUAL_METRIC_GRID_COLUMNS : SINGLE_METRIC_GRID_COLUMNS;
  const availableWeights = useMemo(() => {
    const constrained = gymWeightOptions(pickerLoadConstraints, pickerReferenceWeight);
    if (constrained.length > 0) return constrained;
    const step = programExercise.exercise.category === 'ISOLATION' ? 1 : 2.5;
    return Array.from({ length: 81 }, (_, index) => +(index * step).toFixed(2));
  }, [pickerLoadConstraints, pickerReferenceWeight, programExercise.exercise.category]);
  const repOptions = useMemo(() => Array.from({ length: 30 }, (_, index) => index + 1), []);
  const weightPickerOptions = useMemo(
    () =>
      availableWeights.map((weight) => ({
        value: unit === 'LB' ? roundWeight(toDisplayWeight(weight, unit), 2) : weight,
        canonicalValue: weight,
        label: formatWeight(weight, unit, {
          decimals: 2,
          group: false,
          locale,
          withUnit: false,
        }),
      })),
    [availableWeights, locale, unit],
  );
  const repPickerOptions = useMemo(() => repOptions.map((value) => ({ value })), [repOptions]);
  const recommendationKey = recommendation
    ? `${recommendation.weight}:${recommendation.reps}:${recommendation.rir}`
    : null;
  const canApplyRecommendation =
    recommendation != null && appliedRecommendationKey !== recommendationKey;

  function applyRecommendation() {
    if (!recommendation || disabled) return;
    setEditingSet(null);
    setPicker(null);
    setDraft({ weight: recommendation.weight, reps: recommendation.reps, rir: recommendation.rir });
    setAppliedRecommendationKey(recommendationKey);
  }

  function openPicker(kind: 'weight' | 'reps', set?: PendingSet) {
    if (set && editingSet?.set.localId !== set.localId) {
      setEditingSet({ set, draft: { weight: set.weight, reps: set.reps, rir: set.rir } });
    } else if (!set) {
      setEditingSet(null);
    }
    setPicker(kind);
  }

  function chooseValue(value: number, canonicalWeight?: number) {
    const updateDraft = (current: DraftSet): DraftSet =>
      picker === 'weight'
        ? { ...current, weight: canonicalWeight ?? fromDisplayWeight(value, unit) }
        : { ...current, reps: Math.max(1, Math.round(value)) };
    if (editingSet) {
      const nextDraft = updateDraft(editingSet.draft);
      setPicker(null);
      void persistEditedSet(editingSet.set, nextDraft);
      return;
    }
    setDraft(updateDraft);
    setAppliedRecommendationKey(null);
    setPicker(null);
  }

  async function persistEditedSet(set: PendingSet, nextDraft: DraftSet) {
    if (disabled || updatingSetId === set.localId || nextDraft.reps <= 0 || nextDraft.weight < 0)
      return;
    // Only a weight the lifter actually changed is snapped, and against the
    // set's own equipment. An edit of reps or RIR leaves the stored weight as is.
    const normalized =
      nextDraft.weight === set.weight
        ? nextDraft
        : {
            ...nextDraft,
            weight: constrainGymWeight(
              nextDraft.weight,
              nextDraft.weight,
              loadConstraintsForSet(set),
            ),
          };
    setEditingSet({ set, draft: normalized });
    setUpdatingSetId(set.localId);
    try {
      await onUpdateSet(set, normalized);
      setEditingSet(null);
    } catch {
      setEditingSet(null);
    } finally {
      setUpdatingSetId(null);
    }
  }

  function updateEditingRir(set: PendingSet, rir: number | null) {
    const current =
      editingSet?.set.localId === set.localId
        ? editingSet.draft
        : { weight: set.weight, reps: set.reps, rir: set.rir };
    void persistEditedSet(set, { ...current, rir });
  }

  async function confirmRow() {
    if (disabled || submitting || draft.reps <= 0 || draft.weight < 0) return;
    setSubmitting(true);
    try {
      await onSubmit({
        weight: constrainGymWeight(draft.weight, draft.weight, effectiveLoadConstraints),
        reps: draft.reps,
        rir: draft.rir,
        durationSec: null,
        distanceM: null,
        isWarmup: false,
        isDropSet: false,
        notes: null,
        gymEquipmentId: gymEquipmentId || null,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-md border border-border">
      {equipmentOptions.length > 0 && (
        <div className="border-b border-border px-3 py-2">
          <label
            htmlFor="inline-gym-equipment"
            className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground"
          >
            {inputT('equipment')}
          </label>
          <div className="flex gap-2">
            <Select
              value={gymEquipmentId || 'none'}
              disabled={disabled}
              onValueChange={(value) => setGymEquipmentId(value === 'none' ? '' : value)}
            >
              <SelectTrigger id="inline-gym-equipment" className="h-10 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{inputT('equipmentNone')}</SelectItem>
                {equipmentOptions.map((equipment) => (
                  <SelectItem key={equipment.id} value={equipment.id}>
                    {equipment.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canEditSelectedEquipment && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={disabled}
                onClick={() => setWeightEditorOpen(true)}
                aria-label={t('weightEditor.open')}
                title={t('weightEditor.open')}
                className="size-10 shrink-0"
              >
                <Pencil className="size-4" />
              </Button>
            )}
          </div>
        </div>
      )}
      {gymId && selectedEquipment && canEditSelectedEquipment && (
        <LiveEquipmentWeightEditor
          open={weightEditorOpen}
          equipment={selectedEquipment}
          unit={unit}
          onOpenChange={setWeightEditorOpen}
          onSaved={(equipment, updatedExerciseIds) =>
            onEquipmentWeightsUpdated?.(equipment, updatedExerciseIds)
          }
        />
      )}
      <div data-testid="editable-sets-scroll" className="overflow-x-auto overscroll-x-contain">
        <div data-testid="editable-sets-grid" className="min-w-[31rem]">
          <div
            data-testid="editable-sets-header"
            className={`grid ${gridColumns} items-center gap-1 border-b border-border bg-muted/30 px-2 py-2 text-center text-[0.6875rem] font-medium uppercase text-muted-foreground`}
          >
            <span>#</span>
            <span>{unit}</span>
            <span>{locale === 'zh-CN' ? inputT('reps') : 'REPS'}</span>
            <span>RIR</span>
            {metrics.map((metric) => (
              <span key={metric} data-testid={`set-metric-header-${metric}`}>
                {metricLabel(metric, true)}
              </span>
            ))}
            <span className="flex items-center justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('metrics.open')}
                    title={t('metrics.open')}
                    className="-my-2 size-11 text-muted-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t('metrics.label')}</DropdownMenuLabel>
                  {SET_TABLE_METRICS.map((metric) => (
                    <DropdownMenuCheckboxItem
                      key={metric}
                      checked={metrics.includes(metric)}
                      disabled={metrics.length === 1 && metrics[0] === metric}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={(checked) => updateMetric(metric, checked === true)}
                    >
                      {metricLabel(metric)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>

          {workingSets.map((set, setIndex) => {
            const isEditing = editingSet?.set.localId === set.localId;
            const rowDraft = isEditing
              ? editingSet.draft
              : { weight: set.weight, reps: set.reps, rir: set.rir };
            const isUpdating = updatingSetId === set.localId;
            return (
              <div
                key={set.localId}
                className={`grid ${gridColumns} items-center gap-1 border-b border-border px-2 py-2 text-center text-sm tabular-nums`}
              >
                <span className="text-muted-foreground">{set.setNumber}</span>
                <div className="flex min-w-0 flex-col items-center gap-1">
                  <button
                    type="button"
                    disabled={disabled || isUpdating}
                    onClick={() => openPicker('weight', set)}
                    aria-label={t('weight', { number: set.setNumber, unit })}
                    className="h-9 rounded-md border border-transparent bg-transparent font-medium hover:bg-muted/40"
                  >
                    {formatWeight(rowDraft.weight, unit, {
                      decimals: 2,
                      group: false,
                      locale,
                      withUnit: false,
                    })}
                  </button>
                  {prsFor(set, setIndex).map((pr) => (
                    <Badge
                      key={pr}
                      className="gap-1 px-1.5 text-[0.625rem]"
                      title={prT(pr === 'weight' ? 'weightPrTitle' : 'oneRmPrTitle')}
                    >
                      <Trophy className="size-2.5" />
                      {prT(pr === 'weight' ? 'weightPr' : 'oneRmPr')}
                    </Badge>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={disabled || isUpdating}
                  onClick={() => openPicker('reps', set)}
                  aria-label={t('reps', { number: set.setNumber })}
                  className="h-9 rounded-md border border-transparent bg-transparent font-medium hover:bg-muted/40"
                >
                  {rowDraft.reps}
                </button>
                <Select
                  value={rowDraft.rir == null ? 'none' : String(rowDraft.rir)}
                  disabled={disabled || isUpdating}
                  onValueChange={(value) =>
                    updateEditingRir(set, value === 'none' ? null : Number(value))
                  }
                >
                  <SelectTrigger
                    aria-label={t('rir', { number: set.setNumber })}
                    className="h-9 border-transparent bg-transparent px-2 text-center [&>svg]:hidden"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-</SelectItem>
                    {[0, 1, 2, 3, 4, 5].map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {metrics.map((metric) => (
                  <span
                    key={metric}
                    data-testid={`completed-set-${set.setNumber}-metric-${metric}`}
                    className="text-muted-foreground"
                  >
                    {formatMetric(metric, rowDraft)}
                  </span>
                ))}
                <span className="flex items-center justify-center">
                  {isUpdating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void onDeleteSet(set)}
                      aria-label={
                        set.localId === latestWorkingSetId
                          ? t('undo', { number: set.setNumber })
                          : t('delete', { number: set.setNumber })
                      }
                      className="size-9 text-muted-foreground hover:text-destructive"
                    >
                      {set.localId === latestWorkingSetId ? (
                        <RotateCcw className="size-4" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  )}
                </span>
              </div>
            );
          })}

          <div
            className={`grid ${gridColumns} items-center gap-1 border-b border-border bg-primary/5 px-2 py-2`}
          >
            {recommendation ? (
              <button
                type="button"
                onClick={applyRecommendation}
                disabled={disabled || !canApplyRecommendation}
                aria-label={t('applyRecommendation', { number: currentNumber })}
                title={t('applyRecommendation', { number: currentNumber })}
                className="relative mx-auto flex size-7 items-center justify-center rounded-md text-sm font-semibold text-primary hover:bg-primary/10 disabled:cursor-default disabled:opacity-100"
              >
                {currentNumber}
                {canApplyRecommendation && (
                  <span
                    data-testid="set-recommendation-dot"
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-background"
                  />
                )}
              </button>
            ) : (
              <span className="text-center text-sm font-semibold text-primary">
                {currentNumber}
              </span>
            )}
            <button
              type="button"
              onClick={() => openPicker('weight')}
              aria-label={t('weight', { number: currentNumber, unit })}
              className="h-11 rounded-md border border-input bg-background px-2 text-center text-base font-semibold tabular-nums"
            >
              {displayWeight}
            </button>
            <button
              type="button"
              onClick={() => openPicker('reps')}
              aria-label={t('reps', { number: currentNumber })}
              className="h-11 rounded-md border border-input bg-background px-1 text-center text-base font-semibold tabular-nums"
            >
              {draft.reps}
            </button>
            <Select
              value={draft.rir == null ? 'none' : String(draft.rir)}
              onValueChange={(value) => {
                setDraft((current) => ({
                  ...current,
                  rir: value === 'none' ? null : Number(value),
                }));
                setAppliedRecommendationKey(null);
              }}
            >
              <SelectTrigger
                aria-label={t('rir', { number: currentNumber })}
                className="h-11 px-2 text-center text-base font-semibold [&>svg]:hidden"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-</SelectItem>
                {[0, 1, 2, 3, 4, 5].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {metrics.map((metric) => (
              <span
                key={metric}
                data-testid={`active-set-metric-${metric}`}
                className="text-center text-sm font-medium tabular-nums text-muted-foreground"
              >
                {formatMetric(metric, draft)}
              </span>
            ))}
            <Button
              type="button"
              size="icon"
              onClick={confirmRow}
              disabled={disabled || submitting || draft.reps <= 0}
              aria-label={t('confirm', { number: currentNumber })}
              className="size-11"
            >
              {submitting ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Check className="size-6" />
              )}
            </Button>
          </div>

          {Array.from({ length: Math.max(0, totalRows - currentNumber) }, (_, index) => {
            const rowNumber = currentNumber + index + 1;
            const previous = lastPerformance?.sets[rowNumber - 1];
            return (
              <div
                key={`upcoming-${rowNumber}`}
                className={`grid ${gridColumns} items-center gap-1 border-b border-border px-2 py-3 text-center text-sm text-muted-foreground last:border-b-0`}
              >
                <span>{rowNumber}</span>
                <span>
                  {previous
                    ? formatWeight(previous.weight, unit, {
                        decimals: 2,
                        group: false,
                        locale,
                        withUnit: false,
                      })
                    : '-'}
                </span>
                <span>{previous?.reps ?? '-'}</span>
                <span>{previous?.rir ?? '-'}</span>
                {metrics.map((metric) => (
                  <span key={metric}>
                    {previous
                      ? formatMetric(metric, {
                          weight: previous.weight,
                          reps: previous.reps,
                          rir: previous.rir,
                        })
                      : '-'}
                  </span>
                ))}
                <span />
              </div>
            );
          })}
        </div>
      </div>

      <SetValuePicker
        open={picker != null}
        kind={picker ?? 'weight'}
        value={
          picker === 'reps'
            ? (editingSet?.draft.reps ?? draft.reps)
            : unit === 'LB'
              ? roundWeight(toDisplayWeight(editingSet?.draft.weight ?? draft.weight, unit), 1)
              : (editingSet?.draft.weight ?? draft.weight)
        }
        canonicalValue={picker === 'reps' ? undefined : (editingSet?.draft.weight ?? draft.weight)}
        options={picker === 'reps' ? repPickerOptions : weightPickerOptions}
        unit={unit}
        loadConstraints={pickerLoadConstraints}
        onClose={() => setPicker(null)}
        onChoose={chooseValue}
      />
    </section>
  );
}
