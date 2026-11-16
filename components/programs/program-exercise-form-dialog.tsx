'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type {
  Exercise,
  MuscleGroup,
  ProgramExercise,
  SetAutoregulationMode,
} from '@/lib/prisma-client';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EffortInput } from '@/components/shared/effort-input';
import { useEffortScale } from '@/components/shared/effort-scale-provider';
import { effortRange } from '@/lib/effort';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  programExerciseInputSchema,
  type ProgramExerciseInput,
} from '@/lib/schemas/program-exercise';
import { muscleGroupMessageKeys } from '@/i18n/enum-keys';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { addedExerciseTargets } from '@/lib/freestyle';
import {
  distanceMToKmInput,
  durationSecToMinutesInput,
  isCardioExercise,
  kmInputToDistanceM,
  minutesInputToDurationSec,
} from '@/lib/cardio-target';

interface CreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create';
  workoutId: string;
  catalog: Exercise[];
}

interface EditProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'edit';
  programExercise: ProgramExercise & { exercise: Exercise };
  catalog: Exercise[];
}

type Props = CreateProps | EditProps;

const DEFAULT_VALUES: ProgramExerciseInput = {
  exerciseId: '',
  targetSets: 4,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetRIR: 2,
  restSec: 90,
  autoregulationMode: 'PRESERVE_RIR',
  fatigueRate: null,
  loadAdjustmentPct: null,
  tempo: '',
  notes: '',
};

// Value of an optional number field ("Auto" when empty). react-hook-form also
// runs setValueAs on the default value, so a null default must stay null:
// Number(null) is 0, which the schema refuses, and the form then failed to
// save without showing an error on a row whose two overrides were never set
// (every new row, and every cardio row, whose override fields are hidden).
function optionalNumber(value: unknown): number | null {
  return value === '' || value == null ? null : Number(value);
}

export function ProgramExerciseFormDialog(props: Props) {
  const t = useTranslations('programs.exercise');
  const exerciseT = useTranslations('exercises');
  const common = useTranslations('common');
  const exerciseName = useExerciseName();
  const router = useRouter();

  const initial: ProgramExerciseInput = useMemo(() => {
    if (props.mode === 'edit') {
      const pe = props.programExercise;
      return {
        exerciseId: pe.exerciseId,
        targetSets: pe.targetSets,
        targetRepsMin: pe.targetRepsMin,
        targetRepsMax: pe.targetRepsMax,
        targetRIR: pe.targetRIR,
        restSec: pe.restSec,
        autoregulationMode: pe.autoregulationMode,
        fatigueRate: pe.fatigueRate,
        loadAdjustmentPct: pe.loadAdjustmentPct,
        tempo: pe.tempo ?? '',
        notes: pe.notes ?? '',
      };
    }
    return DEFAULT_VALUES;
  }, [props]);

  // Cardio target (issue #558): typed as minutes and kilometers, like the set
  // logger types its distance, and kept as raw strings while typing. They are
  // converted to the stored seconds and meters on submit.
  const initialDurationMin =
    props.mode === 'edit' ? durationSecToMinutesInput(props.programExercise.targetDurationSec) : '';
  const initialDistanceKm =
    props.mode === 'edit' ? distanceMToKmInput(props.programExercise.targetDistanceM) : '';
  const [durationMin, setDurationMin] = useState(initialDurationMin);
  const [distanceKm, setDistanceKm] = useState(initialDistanceKm);
  const [cardioSubmitted, setCardioSubmitted] = useState(false);

  const form = useForm<ProgramExerciseInput>({
    resolver: zodResolver(programExerciseInputSchema),
    defaultValues: initial,
  });

  // The effort target is typed on the user's scale (issue #390) and written
  // to the form as the stored RIR.
  const effortScale = useEffortScale();
  const watchedRir = form.watch('targetRIR');

  // The target is required. An emptied or invalid field holds NaN, which the
  // schema refuses, so the form cannot save a target the field does not show
  // (an empty string would be coerced to RIR 0, a maximal effort).
  function setTargetRir(rir: number | null) {
    form.setValue('targetRIR', rir ?? Number.NaN, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
  }

  useEffect(() => {
    if (props.open) {
      form.reset(initial);
      setDurationMin(initialDurationMin);
      setDistanceKm(initialDistanceKm);
      setCardioSubmitted(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, initial]);

  function findExercise(exerciseId: string): Exercise | undefined {
    const fromCatalog = props.catalog.find((e) => e.id === exerciseId);
    if (fromCatalog) return fromCatalog;
    return props.mode === 'edit' && props.programExercise.exerciseId === exerciseId
      ? props.programExercise.exercise
      : undefined;
  }

  // A cardio exercise is prescribed by duration and distance (issue #558):
  // the strength fields are hidden for it and the two cardio fields shown.
  const watchedExerciseId = form.watch('exerciseId');
  const selectedExercise = findExercise(watchedExerciseId);
  const isCardio = selectedExercise ? isCardioExercise(selectedExercise) : false;
  const durationSec = minutesInputToDurationSec(durationMin);
  const distanceM = kmInputToDistanceM(distanceKm);
  const durationInvalid = cardioSubmitted && durationSec === null;
  const distanceInvalid = cardioSubmitted && distanceM === undefined;

  // When an exercise is selected from the catalog, we pre-fill restSec
  // with its defaultRestSec (only in create mode).
  function handleExerciseChange(exerciseId: string) {
    const previous = findExercise(form.getValues('exerciseId'));
    form.setValue('exerciseId', exerciseId, { shouldValidate: true });
    const exo = findExercise(exerciseId);
    if (!exo) return;
    if (props.mode === 'create') form.setValue('restSec', exo.defaultRestSec);
    // Switching between a cardio and a strength exercise: the strength fields
    // hidden for cardio must still hold values the schema accepts, and the
    // ones shown again must not be the cardio placeholders. Cardio takes the
    // repo rule (one continuous effort is one set, lib/freestyle), strength
    // the defaults of a new row.
    const wasCardio = previous ? isCardioExercise(previous) : false;
    const nowCardio = isCardioExercise(exo);
    if (nowCardio && !wasCardio) {
      const targets = addedExerciseTargets(exo);
      form.setValue('targetSets', targets.targetSets);
      form.setValue('targetRepsMin', targets.targetRepsMin);
      form.setValue('targetRepsMax', targets.targetRepsMax);
      form.setValue('targetRIR', targets.targetRIR);
      form.setValue('tempo', '');
    } else if (!nowCardio && wasCardio) {
      form.setValue('targetSets', DEFAULT_VALUES.targetSets);
      form.setValue('targetRepsMin', DEFAULT_VALUES.targetRepsMin);
      form.setValue('targetRepsMax', DEFAULT_VALUES.targetRepsMax);
      form.setValue('targetRIR', DEFAULT_VALUES.targetRIR);
    }
  }

  async function onSubmit(values: ProgramExerciseInput) {
    // The cardio target is validated here, not by the form schema: its two
    // fields are typed in minutes and kilometers and only exist for a cardio
    // exercise. Duration is required, distance optional.
    let cardioTarget: { targetDurationSec?: number; targetDistanceM?: number | null } = {};
    if (isCardio) {
      setCardioSubmitted(true);
      if (durationSec === null || distanceM === undefined) return;
      cardioTarget = { targetDurationSec: durationSec, targetDistanceM: distanceM };
    }
    const url =
      props.mode === 'edit'
        ? `/api/program-exercises/${props.programExercise.id}`
        : `/api/workouts/${props.workoutId}/program-exercises`;
    const method = props.mode === 'edit' ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        ...cardioTarget,
        tempo: values.tempo || null,
        notes: values.notes || null,
      }),
    });
    if (!res.ok) {
      toast.error(res.status === 409 ? t('duplicate') : t('saveError'));
      return;
    }
    toast.success(props.mode === 'edit' ? t('updated') : t('added'));
    props.onOpenChange(false);
    router.refresh();
  }

  // Group the catalog by muscleGroup for the dropdown list.
  const grouped = useMemo(() => {
    const out = new Map<string, Exercise[]>();
    for (const ex of props.catalog) {
      const key = ex.muscleGroup;
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(ex);
    }
    return Array.from(out.entries());
  }, [props.catalog]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.mode === 'edit' ? t('edit') : t('add')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="exerciseId">{t('add')}</Label>
            <Select value={form.watch('exerciseId')} onValueChange={handleExerciseChange}>
              <SelectTrigger id="exerciseId">
                <SelectValue placeholder={t('choose')} />
              </SelectTrigger>
              <SelectContent>
                {grouped.map(([group, list]) => (
                  <SelectGroup key={group}>
                    <SelectLabel>
                      {exerciseT(`muscleGroups.${muscleGroupMessageKeys[group as MuscleGroup]}`)}
                    </SelectLabel>
                    {list.map((ex) => (
                      <SelectItem key={ex.id} value={ex.id}>
                        {exerciseName(ex.name)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.exerciseId && (
              <p className="text-sm text-destructive">{form.formState.errors.exerciseId.message}</p>
            )}
          </div>

          {isCardio ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="targetDurationMin">{t('cardioDuration')}</Label>
                <Input
                  id="targetDurationMin"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="1440"
                  step="1"
                  value={durationMin}
                  onChange={(e) => setDurationMin(e.target.value)}
                  aria-invalid={durationInvalid ? true : undefined}
                />
                {durationInvalid && (
                  <p className="text-sm text-destructive">{t('cardioDurationError')}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetDistanceKm">{t('cardioDistance')}</Label>
                <Input
                  id="targetDistanceKm"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="1000"
                  step="0.01"
                  value={distanceKm}
                  onChange={(e) => setDistanceKm(e.target.value)}
                  aria-invalid={distanceInvalid ? true : undefined}
                />
                {distanceInvalid && (
                  <p className="text-sm text-destructive">{t('cardioDistanceError')}</p>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="targetSets">{t('sets')}</Label>
                  <Input
                    id="targetSets"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={20}
                    {...form.register('targetSets')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="targetRIR">{effortScale}</Label>
                  <EffortInput
                    id="targetRIR"
                    rir={
                      typeof watchedRir === 'number' && Number.isFinite(watchedRir)
                        ? watchedRir
                        : null
                    }
                    aria-invalid={form.formState.errors.targetRIR ? true : undefined}
                    onRirChange={(rir) => setTargetRir(rir)}
                    onInvalidEntry={() => setTargetRir(null)}
                  />
                  {form.formState.errors.targetRIR && (
                    <p className="text-sm text-destructive">
                      {t('effortRange', effortRange(effortScale))}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="targetRepsMin">{t('repsMin')}</Label>
                  <Input
                    id="targetRepsMin"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={50}
                    {...form.register('targetRepsMin')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="targetRepsMax">{t('repsMax')}</Label>
                  <Input
                    id="targetRepsMax"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={50}
                    {...form.register('targetRepsMax')}
                  />
                  {form.formState.errors.targetRepsMax && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.targetRepsMax.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="restSec">{t('rest')}</Label>
                  <Input
                    id="restSec"
                    type="number"
                    inputMode="numeric"
                    min={15}
                    max={600}
                    {...form.register('restSec')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tempo">{t('tempo')}</Label>
                  <Input id="tempo" placeholder="3-1-1-0" {...form.register('tempo')} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="autoregulationMode">{t('autoregulationMode')}</Label>
                <Select
                  value={form.watch('autoregulationMode') ?? 'PRESERVE_RIR'}
                  onValueChange={(value) =>
                    form.setValue('autoregulationMode', value as SetAutoregulationMode)
                  }
                >
                  <SelectTrigger id="autoregulationMode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRESERVE_RIR">{t('preserveRir')}</SelectItem>
                    <SelectItem value="PRESERVE_REPS">{t('preserveReps')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {form.watch('autoregulationMode') === 'PRESERVE_REPS'
                    ? t('preserveRepsHelp')
                    : t('preserveRirHelp')}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="fatigueRate">{t('fatigueRate')}</Label>
                  <Input
                    id="fatigueRate"
                    type="number"
                    inputMode="decimal"
                    min="0.25"
                    max="2"
                    step="0.05"
                    placeholder={t('automatic')}
                    {...form.register('fatigueRate', {
                      setValueAs: optionalNumber,
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="loadAdjustmentPct">{t('loadAdjustment')}</Label>
                  <Input
                    id="loadAdjustmentPct"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    max="5"
                    step="0.1"
                    placeholder={t('automatic')}
                    {...form.register('loadAdjustmentPct', {
                      setValueAs: optionalNumber,
                    })}
                  />
                </div>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">{t('notes')}</Label>
            <Textarea id="notes" rows={2} {...form.register('notes')} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={form.formState.isSubmitting}
            >
              {common('actions.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? common('actions.saving')
                : props.mode === 'edit'
                  ? common('actions.save')
                  : common('actions.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
