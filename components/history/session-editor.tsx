'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { Exercise, WeightUnit } from '@/lib/prisma-client';
import type { PendingSet } from '@/lib/indexeddb';
import { blockKey } from '@/lib/exercise-blocks';
import { favoritesFirst } from '@/lib/exercise-favorites';
import { addedExerciseTargets, toRunnerExercises, type RunnerExercise } from '@/lib/freestyle';
import { matchesSearch } from '@/lib/search-fold';
import {
  durationMinutes,
  parseTimingInputs,
  toLocalInputs,
  type TimingInputs,
} from '@/lib/session-edit';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EditableSetsTable, type SetType } from '@/components/session/editable-sets-table';
import {
  CardioSetsEditor,
  type CardioEditorSet,
  type CardioSetValues,
} from '@/components/history/cardio-sets-editor';
import { SessionTimingFields } from '@/components/history/session-timing-fields';

// One set of the edited session, as the set routes return it.
export interface EditorSet {
  id: string;
  exerciseId: string;
  gymEquipmentId: string | null;
  setNumber: number;
  weight: number;
  reps: number;
  rir: number | null;
  durationSec: number | null;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  notes: string | null;
  isWarmup: boolean;
  isDropSet: boolean;
  block: number | null;
}

// One card of the editor: an exercise, or one block of a deliberately
// repeated exercise (issue #429). `block` follows the history page: null for
// the first (or only) block, the block index for a later one.
export interface EditorGroup {
  exercise: Exercise;
  block: number | null;
}

interface Props {
  sessionId: string;
  title: string;
  // ISO instants; the fields show them in the browser's zone.
  startedAt: string;
  finishedAt: string;
  // The exercises of the session's workout (in workout order), then the ones
  // that only have sets.
  groups: EditorGroup[];
  sets: EditorSet[];
  // The trainee's exercises, for "Add an exercise".
  catalog: Exercise[];
  unit: WeightUnit;
}

function groupKey(group: EditorGroup): string {
  return blockKey(group.exercise.id, group.block);
}

// Same grouping as the history page: block 0 and no block are one group.
function setGroupKey(set: Pick<EditorSet, 'exerciseId' | 'block'>): string {
  return blockKey(set.exerciseId, set.block ? set.block : null);
}

// The live table reads a row of a workout. An edited session has none, so
// each card gets one in the shape a freestyle session uses (lib/freestyle).
function tableRow(sessionId: string, group: EditorGroup, order: number): RunnerExercise {
  const [row] = toRunnerExercises([
    {
      id: groupKey(group),
      sessionId,
      order,
      ...addedExerciseTargets(group.exercise),
      exercise: group.exercise,
    },
  ]);
  return row as RunnerExercise;
}

// The table lists the rows of the live offline queue; a stored set is one
// that is already synced.
function toTableSet(sessionId: string, set: EditorSet): PendingSet {
  return {
    localId: set.id,
    sessionId,
    exerciseId: set.exerciseId,
    gymEquipmentId: set.gymEquipmentId,
    setNumber: set.setNumber,
    weight: set.weight,
    reps: set.reps,
    rir: set.rir,
    durationSec: set.durationSec,
    distanceM: set.distanceM,
    notes: set.notes,
    isWarmup: set.isWarmup,
    isDropSet: set.isDropSet,
    block: set.block,
    createdAt: 0,
    status: 'synced',
    serverId: set.id,
    syncedAt: 0,
    attempts: 0,
    lastError: null,
  };
}

function bySetNumber(a: EditorSet, b: EditorSet): number {
  return a.setNumber - b.setNumber;
}

// Editor of a FINISHED session (issue #389): when it took place, and every
// set of it. Each change is saved as it is made, through the set routes with
// `amend: true`; nothing here touches a session in progress.
export function SessionEditor({
  sessionId,
  title,
  startedAt,
  finishedAt,
  groups: initialGroups,
  sets: initialSets,
  catalog,
  unit,
}: Props) {
  const t = useTranslations('history.edit');
  const menu = useTranslations('session.exerciseMenu');
  const exerciseName = useExerciseName();
  const locale = useLocale();
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [sets, setSets] = useState(initialSets);
  const [timing, setTiming] = useState<TimingInputs>({ date: '', time: '', duration: '' });
  const [savingTiming, setSavingTiming] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  // The wall-clock values are the browser's, so they are filled after mount
  // (the server renders this component in its own zone).
  useEffect(() => {
    const start = new Date(startedAt);
    setTiming({
      ...toLocalInputs(start),
      duration: String(Math.max(1, durationMinutes(start, new Date(finishedAt)))),
    });
  }, [startedAt, finishedAt]);

  const setsByGroup = useMemo(() => {
    const map = new Map<string, EditorSet[]>();
    for (const set of sets) {
      const key = setGroupKey(set);
      const list = map.get(key);
      if (list) list.push(set);
      else map.set(key, [set]);
    }
    for (const list of map.values()) list.sort(bySetNumber);
    return map;
  }, [sets]);

  const choices = useMemo(() => {
    const present = new Set(groups.map((group) => group.exercise.id));
    const available = catalog.filter((exercise) => !present.has(exercise.id));
    const needle = query.trim();
    if (!needle) return favoritesFirst(available);
    return favoritesFirst(
      available.filter(
        (exercise) =>
          matchesSearch(exercise.name, needle, locale) ||
          matchesSearch(exerciseName(exercise.name), needle, locale),
      ),
    );
  }, [catalog, exerciseName, groups, locale, query]);

  async function saveTiming() {
    if (savingTiming) return;
    const parsed = parseTimingInputs(timing, new Date());
    if (!parsed.ok) {
      toast.error(t(parsed.reason === 'future' ? 'future' : 'invalidTiming'));
      return;
    }
    setSavingTiming(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startedAt: parsed.startedAt.toISOString(),
          durationMin: parsed.durationMin,
        }),
      }).catch(() => null);
      if (!res?.ok) {
        toast.error(t('timingError'));
        return;
      }
      toast.success(t('timingSaved'));
      router.refresh();
    } finally {
      setSavingTiming(false);
    }
  }

  // Sends one set write; resolves to the stored set, or null after a toast.
  async function writeSet(
    url: string,
    method: 'POST' | 'PATCH',
    body: Record<string, unknown>,
  ): Promise<EditorSet | null> {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, amend: true }),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error(t('setError'));
      return null;
    }
    toast.success(t('setSaved'));
    return (await res.json()) as EditorSet;
  }

  async function addSet(group: EditorGroup, values: Record<string, unknown>): Promise<boolean> {
    const existing = setsByGroup.get(groupKey(group)) ?? [];
    const created = await writeSet(`/api/sessions/${encodeURIComponent(sessionId)}/sets`, 'POST', {
      exerciseId: group.exercise.id,
      setNumber: Math.max(0, ...existing.map((set) => set.setNumber)) + 1,
      block: group.block,
      ...values,
    });
    if (!created) return false;
    setSets((current) => [...current, created]);
    return true;
  }

  async function updateSet(id: string, values: Record<string, unknown>): Promise<boolean> {
    const updated = await writeSet(`/api/sets/${encodeURIComponent(id)}`, 'PATCH', values);
    if (!updated) return false;
    setSets((current) => current.map((set) => (set.id === id ? updated : set)));
    return true;
  }

  async function deleteSet(id: string): Promise<boolean> {
    const res = await fetch(`/api/sets/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(
      () => null,
    );
    // 404: already gone (another tab); the row leaves this screen either way.
    if (!res || (!res.ok && res.status !== 404)) {
      toast.error(t('deleteError'));
      return false;
    }
    toast.success(t('setDeleted'));
    setSets((current) => {
      const removed = current.find((set) => set.id === id);
      if (!removed) return current;
      // The server closes the gap in the set numbers; mirror it here.
      const key = setGroupKey(removed);
      const siblings = current
        .filter((set) => set.id !== id && setGroupKey(set) === key)
        .sort(bySetNumber);
      const renumbered = new Map(siblings.map((set, index) => [set.id, index + 1]));
      return current
        .filter((set) => set.id !== id)
        .map((set) =>
          renumbered.has(set.id) ? { ...set, setNumber: renumbered.get(set.id) as number } : set,
        );
    });
    return true;
  }

  function addExercise(exercise: Exercise) {
    setGroups((current) =>
      current.some((group) => group.exercise.id === exercise.id)
        ? current
        : [...current, { exercise, block: null }],
    );
    setPicking(false);
    setQuery('');
  }

  function finish() {
    router.push(`/history/${encodeURIComponent(sessionId)}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('title')}</p>
          <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        </div>
        <Button type="button" onClick={finish}>
          <Check className="size-4" />
          <span className="ml-1">{t('done')}</span>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <h2 className="text-base font-semibold">{t('timing')}</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <SessionTimingFields
            idPrefix="session-edit"
            value={timing}
            onChange={setTiming}
            disabled={savingTiming}
          />
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => void saveTiming()}
            disabled={savingTiming || timing.date === ''}
          >
            {savingTiming ? t('saving') : t('save')}
          </Button>
        </CardContent>
      </Card>

      {groups.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('empty')}
          </CardContent>
        </Card>
      )}

      <ul className="flex flex-col gap-3">
        {groups.map((group, index) => {
          const key = groupKey(group);
          const groupSets = setsByGroup.get(key) ?? [];
          const isCardio = group.exercise.category === 'CARDIO';
          return (
            <li key={key} data-testid="session-edit-exercise">
              <Card>
                <CardHeader className="pb-2">
                  <h2 className="text-base font-semibold">{exerciseName(group.exercise.name)}</h2>
                </CardHeader>
                <CardContent className="pt-0">
                  {isCardio ? (
                    <CardioSetsEditor
                      sets={groupSets.map(
                        (set): CardioEditorSet => ({
                          id: set.id,
                          setNumber: set.setNumber,
                          durationSec: set.durationSec ?? 0,
                          distanceM: set.distanceM,
                          avgHr: set.avgHr,
                          maxHr: set.maxHr,
                        }),
                      )}
                      onAdd={(values: CardioSetValues) =>
                        addSet(group, { weight: 0, reps: 1, ...values })
                      }
                      onSave={(set, values) => updateSet(set.id, { ...values })}
                      onDelete={(set) => deleteSet(set.id)}
                    />
                  ) : (
                    <EditableSetsTable
                      programExercise={tableRow(sessionId, group, index + 1)}
                      sets={groupSets.map((set) => toTableSet(sessionId, set))}
                      lastPerformance={undefined}
                      readiness={null}
                      deloadActive={false}
                      unit={unit}
                      onSubmit={async (values) => {
                        await addSet(group, {
                          weight: values.weight,
                          reps: values.reps,
                          rir: values.rir,
                        });
                      }}
                      onUpdateSet={async (set, values) => {
                        // A rejected edit throws, so the table drops its draft.
                        if (!(await updateSet(set.localId, { ...values }))) {
                          throw new Error('set update rejected');
                        }
                      }}
                      onDeleteSet={(set) => deleteSet(set.localId)}
                      amend={{
                        onSetTypeChange: async (set, type: SetType) => {
                          await updateSet(set.localId, {
                            weight: set.weight,
                            reps: set.reps,
                            rir: set.rir,
                            isWarmup: type === 'warmup',
                            isDropSet: type === 'drop',
                          });
                        },
                      }}
                    />
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {picking ? (
        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={menu('searchExercises')}
                className="pl-9"
                aria-label={menu('searchExercises')}
              />
            </div>
            <div className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto">
              {choices.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {menu('noExercises')}
                </p>
              ) : (
                choices.map((exercise) => (
                  <Button
                    key={exercise.id}
                    type="button"
                    variant="ghost"
                    className="min-h-tap justify-start"
                    onClick={() => addExercise(exercise)}
                  >
                    {exerciseName(exercise.name)}
                  </Button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setPicking(true)}
        >
          <Plus className="size-4" />
          <span className="ml-1">{t('addExercise')}</span>
        </Button>
      )}
    </div>
  );
}
