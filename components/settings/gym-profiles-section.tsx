'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, Check, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Exercise, Gym, GymExerciseConfig } from '@/lib/prisma-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { formatPlateList, parseWeightList } from '@/lib/plate-list';
import { matchesSearch } from '@/lib/search-fold';

type GymWithConfigs = Gym & { exerciseConfigs: GymExerciseConfig[] };

interface Props {
  initialGyms: GymWithConfigs[];
  activeGymId: string | null;
  exercises: Exercise[];
}

interface Draft {
  id: string | null;
  name: string;
  dumbbellWeights: number[];
  plateWeights: number[];
  barWeights: number[];
  configs: Map<string, { isAvailable: boolean; weightOptions: number[] }>;
}

export function GymProfilesSection({ initialGyms, activeGymId: initialActive, exercises }: Props) {
  const t = useTranslations('settings.gyms');
  const common = useTranslations('common');
  const exerciseName = useExerciseName();
  const locale = useLocale();
  const router = useRouter();
  const [gyms, setGyms] = useState(initialGyms);
  const [activeGymId, setActiveGymId] = useState(initialActive);
  const [selectedId, setSelectedId] = useState(initialActive ?? initialGyms[0]?.id ?? 'new');
  const [draft, setDraft] = useState<Draft>(() =>
    draftFromGym(initialGyms.find((g) => g.id === selectedId)),
  );
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredExercises = useMemo(() => {
    const query = search.trim();
    if (!query) return exercises;
    return exercises.filter((exercise) =>
      matchesSearch(exerciseName(exercise.name), query, locale),
    );
  }, [exerciseName, exercises, locale, search]);

  function selectGym(id: string) {
    setSelectedId(id);
    setDraft(draftFromGym(gyms.find((gym) => gym.id === id)));
  }

  function updateConfig(
    exerciseId: string,
    next: Partial<{ isAvailable: boolean; weightOptions: number[] }>,
  ) {
    setDraft((current) => {
      const configs = new Map(current.configs);
      const previous = configs.get(exerciseId) ?? { isAvailable: true, weightOptions: [] };
      configs.set(exerciseId, { ...previous, ...next });
      return { ...current, configs };
    });
  }

  async function save() {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    try {
      const body = {
        name: draft.name.trim(),
        dumbbellWeights: draft.dumbbellWeights,
        plateWeights: draft.plateWeights,
        barWeights: draft.barWeights,
        exerciseConfigs: [...draft.configs.entries()].flatMap(([exerciseId, config]) =>
          !config.isAvailable || config.weightOptions.length > 0 ? [{ exerciseId, ...config }] : [],
        ),
        ...(draft.id ? {} : { makeActive: true }),
      };
      const res = await fetch(draft.id ? `/api/gyms/${draft.id}` : '/api/gyms', {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const saved = (await res.json()) as GymWithConfigs;
      setGyms((current) => [...current.filter((gym) => gym.id !== saved.id), saved].sort(byName));
      setSelectedId(saved.id);
      setDraft(draftFromGym(saved));
      if (!draft.id) setActiveGymId(saved.id);
      toast.success(t('saved'));
      router.refresh();
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function activate() {
    if (!draft.id || draft.id === activeGymId) return;
    const res = await fetch(`/api/gyms/${draft.id}/activate`, { method: 'POST' });
    if (!res.ok) {
      toast.error(t('activateError'));
      return;
    }
    setActiveGymId(draft.id);
    toast.success(t('activated'));
    router.refresh();
  }

  async function remove() {
    if (!draft.id) return;
    const deletedId = draft.id;
    const res = await fetch(`/api/gyms/${deletedId}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error(t('deleteError'));
      return;
    }
    const remaining = gyms.filter((gym) => gym.id !== deletedId);
    const next = remaining[0];
    setGyms(remaining);
    setActiveGymId(activeGymId === deletedId ? (next?.id ?? null) : activeGymId);
    setSelectedId(next?.id ?? 'new');
    setDraft(draftFromGym(next));
    toast.success(t('deleted'));
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Building2 className="size-4" />
          {t('title')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label>{t('savedGyms')}</Label>
            <Select value={selectedId} onValueChange={selectGym}>
              <SelectTrigger>
                <SelectValue placeholder={t('newGym')} />
              </SelectTrigger>
              <SelectContent>
                {gyms.map((gym) => (
                  <SelectItem key={gym.id} value={gym.id}>
                    {gym.name}
                    {gym.id === activeGymId ? ` (${t('active')})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => selectGym('new')}
            title={t('newGym')}
          >
            <Plus className="size-4" />
          </Button>
        </div>

        <div className="space-y-1">
          <Label htmlFor="gym-name">{t('name')}</Label>
          <Input
            id="gym-name"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder={t('namePlaceholder')}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <WeightListField
            id="gym-dumbbells"
            label={t('dumbbells')}
            values={draft.dumbbellWeights}
            placeholder={[10, 12, 14, 15, 16, 19]}
            onChange={(values) => setDraft((current) => ({ ...current, dumbbellWeights: values }))}
          />
          <WeightListField
            id="gym-plates"
            label={t('plates')}
            values={draft.plateWeights}
            placeholder={[1.25, 2.5, 5, 10, 15, 20]}
            onChange={(values) => setDraft((current) => ({ ...current, plateWeights: values }))}
          />
          <WeightListField
            id="gym-bars"
            label={t('bars')}
            values={draft.barWeights}
            placeholder={[20]}
            onChange={(values) => setDraft((current) => ({ ...current, barWeights: values }))}
          />
        </div>

        <div className="space-y-3 border-t pt-4">
          <div>
            <h3 className="text-sm font-semibold">{t('exerciseAvailability')}</h3>
            <p className="text-xs text-muted-foreground">{t('exerciseAvailabilityDescription')}</p>
          </div>
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('searchExercises')}
          />
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {filteredExercises.map((exercise) => {
              const config = draft.configs.get(exercise.id) ?? {
                isAvailable: true,
                weightOptions: [],
              };
              const hasStack =
                exercise.equipmentType === 'MACHINE' || exercise.equipmentType === 'CABLE';
              return (
                <div key={exercise.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {exerciseName(exercise.name)}
                    </span>
                    <label className="flex shrink-0 items-center gap-2 text-xs">
                      {t('available')}
                      <Switch
                        checked={config.isAvailable}
                        onCheckedChange={(isAvailable) =>
                          updateConfig(exercise.id, { isAvailable })
                        }
                      />
                    </label>
                  </div>
                  {hasStack && config.isAvailable && (
                    <div className="mt-2">
                      <WeightListField
                        id={`weights-${exercise.id}`}
                        label={t('machineWeights')}
                        values={config.weightOptions}
                        placeholder={[5, 10, 15, 20, 25]}
                        onChange={(weightOptions) => updateConfig(exercise.id, { weightOptions })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap justify-between gap-2">
          <div>
            {draft.id && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" className="text-destructive">
                    <Trash2 className="size-4" />
                    <span className="ml-2">{common('actions.delete')}</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('deleteDescription', { name: draft.name })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{common('actions.cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={remove}>
                      {common('actions.delete')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <div className="flex gap-2">
            {draft.id && draft.id !== activeGymId && (
              <Button type="button" variant="outline" onClick={activate}>
                <Check className="size-4" />
                <span className="ml-2">{t('makeActive')}</span>
              </Button>
            )}
            <Button type="button" onClick={save} disabled={!draft.name.trim() || saving}>
              <Save className="size-4" />
              <span className="ml-2">
                {saving ? common('actions.saving') : common('actions.save')}
              </span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WeightListField({
  id,
  label,
  values,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  values: number[];
  placeholder: number[];
  onChange: (values: number[]) => void;
}) {
  // The list is written and read with the locale's decimal mark, so "2,5" is
  // one 2.5 kg weight in French (the same rules as the plate fallback, #514).
  const locale = useLocale();
  const text = formatPlateList(values, locale);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        key={`${id}-${text}`}
        id={id}
        defaultValue={text}
        placeholder={formatPlateList(placeholder, locale)}
        inputMode="decimal"
        onBlur={(event) => onChange(parseWeightList(event.target.value, locale))}
      />
    </div>
  );
}

function draftFromGym(gym?: GymWithConfigs): Draft {
  return {
    id: gym?.id ?? null,
    name: gym?.name ?? '',
    dumbbellWeights: gym?.dumbbellWeights ?? [],
    plateWeights: gym?.plateWeights ?? [],
    barWeights: gym?.barWeights ?? [],
    configs: new Map(
      gym?.exerciseConfigs.map((config) => [
        config.exerciseId,
        { isAvailable: config.isAvailable, weightOptions: config.weightOptions },
      ]) ?? [],
    ),
  };
}

function byName(a: GymWithConfigs, b: GymWithConfigs) {
  return a.name.localeCompare(b.name);
}
