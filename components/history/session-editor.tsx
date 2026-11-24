'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { parseTimingEdit, timingInputsOf, type TimingInputs } from '@/lib/session-edit';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  // In the order the page read them: set number, then time. Sets that share
  // a number (an import may do that) keep that order here.
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
// that is already synced. `position` is what the row shows as its number:
// stored numbers are never rewritten (a set deleted from the middle leaves a
// gap, an import may repeat one), so the editor counts the rows instead.
function toTableSet(sessionId: string, set: EditorSet, position: number): PendingSet {
  return {
    localId: set.id,
    sessionId,
    exerciseId: set.exerciseId,
    gymEquipmentId: set.gymEquipmentId,
    setNumber: position,
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

// The set routes bound a set number at 50. The server picks the stored number
// of an added set itself; this is only a valid value to send along.
const MAX_SENT_SET_NUMBER = 50;

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
  const common = useTranslations('common');
  const exerciseName = useExerciseName();
  const locale = useLocale();
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [sets, setSets] = useState(initialSets);
  // The session's window as stored: what the timing form is compared with.
  const [stored, setStored] = useState(() => ({
    startedAt: new Date(startedAt),
    finishedAt: new Date(finishedAt),
  }));
  const [timing, setTiming] = useState<TimingInputs>({ date: '', time: '', duration: '' });
  const [savingTiming, setSavingTiming] = useState(false);
  const timingInFlight = useRef(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [emptyPrompt, setEmptyPrompt] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  // The wall-clock values are the browser's, so they are filled after mount
  // (the server renders this component in its own zone).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setTiming(timingInputsOf(stored.startedAt, stored.finishedAt));
    setMounted(true);
  }, [stored]);

  const timingDirty = useMemo(() => {
    if (!mounted) return false;
    const base = timingInputsOf(stored.startedAt, stored.finishedAt);
    return (
      timing.date !== base.date ||
      timing.time !== base.time ||
      timing.duration.trim() !== base.duration
    );
  }, [mounted, stored, timing]);

  const setsByGroup = useMemo(() => {
    const map = new Map<string, EditorSet[]>();
    for (const set of sets) {
      const key = setGroupKey(set);
      const list = map.get(key);
      if (list) list.push(set);
      else map.set(key, [set]);
    }
    // Stable: sets that share a number keep the order they came in.
    for (const list of map.values()) list.sort((a, b) => a.setNumber - b.setNumber);
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

  // Saves what changed in the timing form. Resolves to false when the form
  // is invalid or the server refused, true when there is nothing left unsaved.
  async function saveTiming(): Promise<boolean> {
    if (timingInFlight.current) return false;
    const edit = parseTimingEdit({ ...stored, inputs: timing, now: new Date() });
    if (!edit.ok) {
      toast.error(t(edit.reason === 'future' ? 'future' : 'invalidTiming'));
      return false;
    }
    const body: { startedAt?: string; durationMin?: number } = {};
    if (edit.changes.startedAt) body.startedAt = edit.changes.startedAt.toISOString();
    if (edit.changes.durationMin != null) body.durationMin = edit.changes.durationMin;
    // Only what the lifter changed is sent; an untouched form writes nothing.
    if (body.startedAt === undefined && body.durationMin === undefined) return true;

    timingInFlight.current = true;
    setSavingTiming(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!res?.ok) {
        toast.error(t('timingError'));
        return false;
      }
      const saved = (await res.json()) as { startedAt: string; finishedAt: string };
      setStored({ startedAt: new Date(saved.startedAt), finishedAt: new Date(saved.finishedAt) });
      toast.success(t('timingSaved'));
      return true;
    } finally {
      timingInFlight.current = false;
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
      setNumber: Math.min(MAX_SENT_SET_NUMBER, existing.length + 1),
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
    setSets((current) => current.filter((set) => set.id !== id));
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

  function leave() {
    router.push(`/history/${encodeURIComponent(sessionId)}`);
    router.refresh();
  }

  // Done never drops what was typed in the timing form: it is saved first,
  // and a refused save keeps the lifter here with the message. A session left
  // without any set (a past workout created, then abandoned) is offered for
  // removal instead of staying in the history unnoticed.
  async function finish() {
    if (timingDirty && !(await saveTiming())) return;
    if (sets.length === 0) {
      setEmptyPrompt(true);
      return;
    }
    leave();
  }

  async function discardEmpty() {
    setDiscarding(true);
    try {
      // `discardEmpty` makes the server refuse a session that holds sets,
      // whatever this screen believes.
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}?discardEmpty=1`, {
        method: 'DELETE',
      }).catch(() => null);
      if (!res || (!res.ok && res.status !== 404)) {
        toast.error(t('discardError'));
        return;
      }
      setEmptyPrompt(false);
      router.push('/history');
      router.refresh();
    } finally {
      setDiscarding(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('title')}</p>
          <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        </div>
        <Button type="button" onClick={() => void finish()} disabled={savingTiming}>
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
            disabled={savingTiming || !timingDirty}
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
                  {/* No set write while the session is being moved: a set
                      added then would be dated in the window it is leaving. */}
                  {isCardio ? (
                    <CardioSetsEditor
                      disabled={savingTiming}
                      sets={groupSets.map(
                        (set, position): CardioEditorSet => ({
                          id: set.id,
                          setNumber: position + 1,
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
                      disabled={savingTiming}
                      programExercise={tableRow(sessionId, group, index + 1)}
                      sets={groupSets.map((set, position) =>
                        toTableSet(sessionId, set, position + 1),
                      )}
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

      <AlertDialog open={emptyPrompt} onOpenChange={setEmptyPrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('emptyLeaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('emptyLeaveDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discarding}>{common('actions.cancel')}</AlertDialogCancel>
            <Button type="button" variant="outline" disabled={discarding} onClick={leave}>
              {t('keepEmpty')}
            </Button>
            <AlertDialogAction
              disabled={discarding}
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={(event) => {
                // Stay open until the server answered.
                event.preventDefault();
                void discardEmpty();
              }}
            >
              {t('discardEmpty')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
