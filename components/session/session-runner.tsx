'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Flag, MessageSquare, X } from 'lucide-react';
import type {
  Exercise,
  Program,
  ProgramExercise,
  Session,
  Set as PrismaSet,
  WeightUnit,
  Workout,
  Gym,
  GymExerciseConfig,
  EquipmentType,
} from '@/lib/prisma-client';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { acquireWakeLock, bindWakeLockToVisibility, releaseWakeLock } from '@/lib/wake-lock';
import { vibrate, VIBRATION_PATTERNS } from '@/lib/vibrate';
import { generateLocalId, getDB, type PendingSet } from '@/lib/indexeddb';
import {
  READINESS_HOLD_AT_OR_BELOW,
  READINESS_RECENCY_HOURS,
  SORENESS_HOLD_AT_OR_ABOVE,
  readinessForSuggestion,
  type ReadinessSignal,
} from '@/lib/progression';
import { recommendNextIntraSet, type IntraSetRecommendation } from '@/lib/intra-set-autoregulation';
import {
  buildSupersetView,
  isSupersetTransitionRest,
  nextAutoAdvanceIndex,
  nextNavIndex,
  SUPERSET_TRANSITION_REST_SEC,
} from '@/lib/supersets';
import { isReadinessAutoRegulationEnabled, isRestEndFlashEnabled } from '@/lib/preferences';
import { adjustRest, pauseRest, resumeRest } from '@/lib/rest-timer';
import {
  bindAutoSync,
  drainDroppedEquipment,
  flushPendingSets,
  onEquipmentDropped,
  pendingSetUpdateState,
  queueSet,
} from '@/lib/sync';
import { hydrateFromServerSets } from '@/lib/sync-hydration';
import { ExerciseCard } from '@/components/session/exercise-card';
import {
  SessionExerciseMenu,
  type SessionCatalogExercise,
} from '@/components/session/session-exercise-menu';
import { SetsList } from '@/components/session/sets-list';
import { EditableSetsTable } from '@/components/session/editable-sets-table';
import type { LiveEquipmentOption } from '@/components/session/live-equipment-weight-editor';
import { SetInput } from '@/components/session/set-input';
import { RestTimer } from '@/components/session/rest-timer';
import { RestEndFlash } from '@/components/session/rest-end-flash';
import { SessionSummary } from '@/components/session/session-summary';
import { ReturnToTrainingNotice } from '@/components/session/return-to-training-notice';
import { SessionExerciseStrip } from '@/components/session/session-exercise-strip';
import { useExerciseName } from '@/components/shared/use-exercise-name';
import { useTrainingName } from '@/components/shared/use-training-name';
import type { GymLoadConstraints } from '@/lib/gym-loads';
import { blockIndexByRow, occurrenceCounts, rowBlockKey, setBlockKey } from '@/lib/exercise-blocks';
import type { ReturnRecommendation } from '@/lib/return-to-training';
import { browserTimeZone, lastDoneDaysByExercise, msUntilNextLocalMidnight } from '@/lib/last-done';
import {
  exerciseDetailPath,
  selectedExerciseIndex,
  sessionExercisePath,
} from '@/lib/session-exercise-navigation';

export interface SerializedLastPerformance {
  sessionStartedAt: string;
  sets: { weight: number; reps: number; rir: number | null }[];
  maxWeight: number;
  repsAtMaxWeight: number;
  // Cardio totals for the last session (issue #176): null for strength
  // exercises. Carried so the exercise card can show a cardio "Last session"
  // reference (duration / distance / avgHr).
  cardio: { durationSec: number; distanceM: number; avgHr: number | null } | null;
}

type ProgramExerciseWithExercise = ProgramExercise & { exercise: Exercise };
type SessionGymEquipment = {
  id: string;
  name: string;
  equipmentType: EquipmentType;
  weightOptions: number[];
  exerciseLinks: { exerciseId: string }[];
};

// In-session weight edits, valid for one server snapshot of the gym equipment.
type LiveEquipmentEdits = {
  base: SessionGymEquipment[] | undefined;
  equipment: Record<string, LiveEquipmentOption>;
  weightOptions: Record<string, number[]>;
};

type SessionRunnerProps = {
  session: Session & {
    workout:
      | (Workout & {
          program: Pick<Program, 'id' | 'name'> | null;
          exercises: ProgramExerciseWithExercise[];
        })
      | null;
    sets: PrismaSet[];
    gym: (Gym & { exerciseConfigs: GymExerciseConfig[]; equipment: SessionGymEquipment[] }) | null;
  };
  lastPerformances: Record<string, SerializedLastPerformance>;
  // When each exercise was last done (issue #459), ISO timestamps keyed by
  // exercise id; a missing key means never done. Omitted, the card shows no
  // "last done" line at all.
  lastDoneAt?: Record<string, string>;
  returnRecommendations: Record<string, ReturnRecommendation>;
  // Latest in-window readiness check-in (or null). Drives whether the load
  // suggestion is held/reduced and the matching explainer in the UI.
  readiness: ReadinessSignal | null;
  // True while the user runs a planned deload week (issue #112): suggestions
  // step down and the runner shows a "Deload week" badge.
  deloadActive: boolean;
  unit: WeightUnit;
  initialProgramExerciseId?: string;
  catalog: SessionCatalogExercise[];
};

type Mode =
  | { kind: 'input' }
  | {
      kind: 'rest';
      endsAt: number;
      // Set while the rest is paused (issue #393); see lib/rest-timer.ts.
      pausedRemainingMs: number | null;
      totalSec: number;
      nextExerciseIdx: number | null;
      navigatedImmediately: boolean;
    }
  | { kind: 'summary' };

export function SessionRunner({
  session,
  lastPerformances,
  lastDoneAt,
  returnRecommendations,
  readiness,
  deloadActive,
  unit,
  initialProgramExerciseId,
  catalog,
}: SessionRunnerProps) {
  const t = useTranslations('session');
  const exerciseName = useExerciseName();
  const trainingName = useTrainingName();
  const router = useRouter();
  const workout = session.workout!;
  // Weight edits made from this screen show at once, layered on the equipment
  // the server sent. They are tied to that server snapshot: once a refresh
  // delivers new props (the exercise menu triggers one), the server data, which
  // by then includes the saved edit, is the source again.
  const serverEquipment = session.gym?.equipment;
  const [liveEquipmentEdits, setLiveEquipmentEdits] = useState<LiveEquipmentEdits>({
    base: serverEquipment,
    equipment: {},
    weightOptions: {},
  });
  const activeEquipmentEdits =
    liveEquipmentEdits.base === serverEquipment ? liveEquipmentEdits : null;
  const sessionEquipment = useMemo<SessionGymEquipment[]>(
    () =>
      (serverEquipment ?? []).map((item) => {
        const edited = activeEquipmentEdits?.equipment[item.id];
        return edited ? { ...item, ...edited } : item;
      }),
    [serverEquipment, activeEquipmentEdits],
  );
  const liveWeightOptions = activeEquipmentEdits?.weightOptions;
  // Supersets (issue #146, slice 1): run the workout in presentation order -
  // members of a superset group come consecutively with A1/A2 labels. For a
  // workout without supersets this is exactly the stored order.
  const supersetView = useMemo(() => buildSupersetView(workout.exercises), [workout.exercises]);
  const programExercises = supersetView.ordered;

  const effectiveProgramExercises = useMemo<ProgramExerciseWithExercise[]>(
    () =>
      programExercises.map((pe) => {
        const recommendation = returnRecommendations[pe.id];
        if (!recommendation || recommendation.mode === 'normal') return pe;
        return {
          ...pe,
          targetSets: recommendation.targetSets,
          targetRIR: recommendation.targetRIR,
        };
      }),
    [programExercises, returnRecommendations],
  );
  const effectiveProgramExerciseById = useMemo(
    () => new Map(effectiveProgramExercises.map((pe) => [pe.id, pe])),
    [effectiveProgramExercises],
  );

  const initialExerciseIndex = selectedExerciseIndex(programExercises, initialProgramExerciseId);
  const [hydrated, setHydrated] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(initialExerciseIndex);
  // Removing an exercise shortens the list one render before the pending
  // selection below lands. Clamp instead of showing the empty state for that
  // pass: it would unmount the sets table and drop its parked drafts.
  const currentIdx = Math.min(selectedIdx, Math.max(programExercises.length - 1, 0));
  const [pendingExerciseSelection, setPendingExerciseSelection] = useState<{
    selectProgramExerciseId: string;
    removedProgramExerciseId?: string;
  } | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'input' });
  // Bumped each time a rest runs out with the flash preference on (issue #393).
  const [restFlashCount, setRestFlashCount] = useState(0);
  const [closing, setClosing] = useState(false);
  const [exerciseMenuOpen, setExerciseMenuOpen] = useState(false);
  // Readiness auto-regulation can be turned off in settings (issue #61). The
  // preference lives in localStorage, so it is read after mount; until then we
  // assume the default (on) so the first render matches the server output.
  const [autoRegulate, setAutoRegulate] = useState(true);

  // "Last done" days (issue #459) are counted here, after mount, in the
  // browser's zone and against the device clock (review of #476): the server
  // zone is not the lifter's, and a page served from the offline cache the
  // next day must not still say "today". Null until then, so the first render
  // matches the server output; the card keeps the line's height meanwhile. The
  // count is redone at each local midnight for a page left open overnight.
  // The same zone dates the "Last session" box once mounted (issue #480).
  const [lastDoneDays, setLastDoneDays] = useState<Record<string, number> | null>(null);
  const [clientTimeZone, setClientTimeZone] = useState<string | null>(null);
  useEffect(() => {
    setClientTimeZone(browserTimeZone());
    if (!lastDoneAt) {
      setLastDoneDays(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const recount = () => {
      const now = new Date();
      setLastDoneDays(lastDoneDaysByExercise(lastDoneAt, now, browserTimeZone()));
      timer = setTimeout(recount, msUntilNextLocalMidnight(now));
    };
    recount();
    return () => clearTimeout(timer);
  }, [lastDoneAt]);

  const currentPE = programExercises[currentIdx];
  const currentTarget = effectiveProgramExercises[currentIdx];

  // Write the clamp back. If a pending selection never lands (failed refresh,
  // target row gone), an index left past the end would make a later add jump
  // the view to the new row.
  useEffect(() => {
    if (selectedIdx !== currentIdx) setSelectedIdx(currentIdx);
  }, [selectedIdx, currentIdx]);

  useEffect(() => {
    if (!pendingExerciseSelection) return;
    if (
      pendingExerciseSelection.removedProgramExerciseId &&
      programExercises.some((item) => item.id === pendingExerciseSelection.removedProgramExerciseId)
    ) {
      return;
    }
    const refreshedIndex = programExercises.findIndex(
      (item) => item.id === pendingExerciseSelection.selectProgramExerciseId,
    );
    const target = programExercises[refreshedIndex];
    if (!target) return;
    // Same two steps as selectExercise: the URL keeps naming the selected
    // row, so a reload does not fall back to the first exercise.
    setSelectedIdx(refreshedIndex);
    window.history.replaceState(
      window.history.state,
      '',
      sessionExercisePath(session.id, target.id),
    );
    setPendingExerciseSelection(null);
  }, [pendingExerciseSelection, programExercises, session.id]);

  // When auto-regulation is off, the readiness signal is dropped entirely, so
  // the suggestion falls back to pure programmed progression (pre-#55 behavior).
  const effectiveReadiness = readinessForSuggestion(readiness, autoRegulate);

  // Equipment ids the server refused to attach during this session (issue
  // #326): the item was deleted, unlinked or moved. They are withdrawn from the
  // picker so the next set does not resend a reference that will be dropped.
  const [droppedEquipmentIds, setDroppedEquipmentIds] = useState<string[]>([]);

  // Hydrate IndexedDB with the server sets, then enable auto-sync.
  useEffect(() => {
    setAutoRegulate(isReadinessAutoRegulationEnabled());
    void (async () => {
      await hydrateFromServerSets(session.id, session.sets);
      setHydrated(true);
    })();
    void acquireWakeLock();
    const cleanupVisibility = bindWakeLockToVisibility();
    const cleanupSync = bindAutoSync();
    // The flush runs in the background, so a dropped equipment reference is
    // reported here rather than returned to handleValidate. The set itself is
    // saved; the user only learns that the machine was not recorded.
    //
    // Read from IndexedDB rather than from the broadcast payload, so a drop
    // discovered while this component was not mounted is still shown (#337).
    // Draining clears, so the mount call and the signal below cannot both
    // report the same set.
    const showDropped = async () => {
      const mine = await drainDroppedEquipment(session.id);
      if (mine.length === 0) return;
      setDroppedEquipmentIds((prev) => [
        ...new Set([...prev, ...mine.map((entry) => entry.gymEquipmentId)]),
      ]);
      toast.warning(t('equipmentDropped'));
    };
    // On mount: whatever a flush found while nobody was listening.
    void showDropped();
    const cleanupDropped = onEquipmentDropped(() => {
      void showDropped();
    });
    return () => {
      void releaseWakeLock();
      cleanupVisibility();
      cleanupSync();
      cleanupDropped();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live query: all sets of this session, from IndexedDB.
  const liveSets = useLiveQuery(
    async () => {
      const db = getDB();
      const items = await db.pendingSets.where('sessionId').equals(session.id).toArray();
      items.sort((a, b) => a.exerciseId.localeCompare(b.exerciseId) || a.setNumber - b.setNumber);
      return items;
    },
    [session.id],
    [] as PendingSet[],
  );

  // Sets are pooled per block (issue #429): the bare exerciseId for an
  // exercise the workout holds once (unchanged), one pool per occurrence for
  // a deliberately repeated one (5/3/1 BBB), so each row has its own sets.
  const rowBlocks = useMemo(() => blockIndexByRow(workout.exercises), [workout.exercises]);
  const exerciseOccurrences = useMemo(
    () => occurrenceCounts(workout.exercises),
    [workout.exercises],
  );
  const keyOf = useCallback(
    (pe: { id: string; exerciseId: string }) => rowBlockKey(pe, rowBlocks),
    [rowBlocks],
  );

  const setsByExercise = useMemo(() => {
    const out = new Map<string, PendingSet[]>();
    for (const s of liveSets) {
      const key = setBlockKey(s, exerciseOccurrences);
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(s);
    }
    for (const arr of out.values()) {
      arr.sort((a, b) => a.setNumber - b.setNumber);
    }
    return out;
  }, [liveSets, exerciseOccurrences]);

  const programExerciseByBlockKey = useMemo(
    () => new Map(effectiveProgramExercises.map((pe) => [rowBlockKey(pe, rowBlocks), pe])),
    [effectiveProgramExercises, rowBlocks],
  );

  function recommendationFor(
    pe: ProgramExerciseWithExercise,
    atMs: number,
  ): IntraSetRecommendation | null {
    const completedSets = setsByExercise.get(keyOf(pe)) ?? [];
    const lastWorkingSet = completedSets.filter((set) => !set.isWarmup && !set.isDropSet).at(-1);
    if (!lastWorkingSet) return null;

    const interveningSet = liveSets
      .filter(
        (set) =>
          !set.isWarmup &&
          !set.isDropSet &&
          setBlockKey(set, exerciseOccurrences) !== keyOf(pe) &&
          set.createdAt > lastWorkingSet.createdAt,
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const interveningPe = interveningSet
      ? programExerciseByBlockKey.get(setBlockKey(interveningSet, exerciseOccurrences))
      : undefined;
    const sameMuscleSuperset = Boolean(
      interveningPe &&
      pe.supersetGroup != null &&
      interveningPe.supersetGroup === pe.supersetGroup &&
      interveningPe.exercise.muscleGroup === pe.exercise.muscleGroup,
    );

    const freshReadiness =
      effectiveReadiness != null && effectiveReadiness.ageHours <= READINESS_RECENCY_HOURS;
    const groupSoreness = effectiveReadiness?.soreness?.[pe.exercise.muscleGroup];
    const recoveryBlocksIncrease =
      freshReadiness &&
      (effectiveReadiness.readiness <= READINESS_HOLD_AT_OR_BELOW ||
        (typeof groupSoreness === 'number' && groupSoreness >= SORENESS_HOLD_AT_OR_ABOVE));
    const allowLoadIncrease = !deloadActive && !recoveryBlocksIncrease;

    return recommendNextIntraSet({
      programExercise: pe,
      completedSets,
      recoverySec: Math.max(0, (atMs - lastWorkingSet.createdAt) / 1000),
      sameMuscleSuperset,
      allowLoadIncrease,
      maxWeight: returnRecommendations[pe.id]?.weightCeiling ?? null,
      loadConstraints: loadConstraintsFor(pe),
    });
  }

  function loadConstraintsFor(pe: ProgramExerciseWithExercise): GymLoadConstraints | null {
    if (!session.gym) return null;
    const config = session.gym.exerciseConfigs.find((item) => item.exerciseId === pe.exerciseId);
    return {
      equipmentType: pe.exercise.equipmentType,
      isAvailable: config?.isAvailable ?? true,
      dumbbellWeights: session.gym.dumbbellWeights,
      plateWeights: session.gym.plateWeights,
      barWeights: session.gym.barWeights,
      weightOptions: liveWeightOptions?.[pe.exerciseId] ?? config?.weightOptions ?? [],
    };
  }

  // Only the exercises whose configs the server updated take the new weights,
  // so the screen matches a reload (#471).
  function handleEquipmentWeightsUpdated(
    equipment: LiveEquipmentOption,
    updatedExerciseIds: string[],
  ) {
    setLiveEquipmentEdits((current) => {
      const edits =
        current.base === serverEquipment
          ? current
          : { base: serverEquipment, equipment: {}, weightOptions: {} };
      return {
        base: serverEquipment,
        equipment: { ...edits.equipment, [equipment.id]: equipment },
        weightOptions: {
          ...edits.weightOptions,
          ...Object.fromEntries(
            updatedExerciseIds.map((exerciseId) => [exerciseId, equipment.weightOptions]),
          ),
        },
      };
    });
  }

  // Prior-session sets per exercise, the PR baseline for the post-session
  // summary (same source as the in-session badge: getLastPerformances).
  const priorSetsByExercise = useMemo(() => {
    const out: Record<string, { weight: number; reps: number }[]> = {};
    for (const [exerciseId, perf] of Object.entries(lastPerformances)) {
      out[exerciseId] = perf.sets.map((s) => ({ weight: s.weight, reps: s.reps }));
    }
    return out;
  }, [lastPerformances]);

  const completedExerciseCount = useMemo(() => {
    let count = 0;
    for (const pe of effectiveProgramExercises) {
      const done = setsByExercise.get(keyOf(pe))?.filter((s) => !s.isWarmup).length ?? 0;
      if (done >= pe.targetSets) count += 1;
    }
    return count;
  }, [effectiveProgramExercises, setsByExercise, keyOf]);

  // Keyed by ProgramExercise row: a workout that programs the same exercise
  // twice has one set pool per block (issue #429), so each row is complete
  // once its own block covers its target.
  const completedProgramExerciseIds = useMemo(() => {
    const completed = new Set<string>();
    for (const pe of effectiveProgramExercises) {
      const done = setsByExercise.get(keyOf(pe))?.filter((s) => !s.isWarmup).length ?? 0;
      if (done >= pe.targetSets) completed.add(pe.id);
    }
    return completed;
  }, [effectiveProgramExercises, setsByExercise, keyOf]);

  const progressPct =
    programExercises.length === 0
      ? 0
      : Math.round((completedExerciseCount / programExercises.length) * 100);

  async function handleValidate(values: {
    weight: number;
    reps: number;
    rir: number | null;
    durationSec: number | null;
    distanceM: number | null;
    isWarmup: boolean;
    isDropSet: boolean;
    notes: string | null;
    gymEquipmentId?: string | null;
  }) {
    if (!currentPE || !currentTarget) return;
    const existing = setsByExercise.get(keyOf(currentPE)) ?? [];
    const setNumber = (existing.at(-1)?.setNumber ?? 0) + 1;

    // Optimistic write: immediate insert into IndexedDB (status pending),
    // instant display via useLiveQuery, and a background POST attempt.
    await queueSet({
      localId: generateLocalId(),
      sessionId: session.id,
      exerciseId: currentPE.exerciseId,
      gymEquipmentId: values.gymEquipmentId ?? null,
      setNumber,
      weight: values.weight,
      reps: values.reps,
      rir: values.rir,
      durationSec: values.durationSec,
      distanceM: values.distanceM,
      notes: values.notes,
      isWarmup: values.isWarmup,
      isDropSet: values.isDropSet,
      block: rowBlocks.get(currentPE.id) ?? null,
    });

    vibrate(VIBRATION_PATTERNS.validate);

    // Start the rest, preparing the auto-advance at the end of the timer.
    // Standalone exercise (unchanged behavior): advance once the set
    // completes the target. Superset member (issue #146): alternate to the
    // next member of the group that still has sets, the A1/A2 flow.
    const remainingAfterThisSet = (pe: ProgramExerciseWithExercise) => {
      const target = effectiveProgramExerciseById.get(pe.id) ?? pe;
      const logged = setsByExercise.get(keyOf(pe))?.filter((s) => !s.isWarmup).length ?? 0;
      const justLogged = keyOf(pe) === keyOf(currentPE) ? 1 : 0;
      return target.targetSets - logged - justLogged;
    };
    const nextIdx = values.isWarmup
      ? null
      : nextAutoAdvanceIndex(supersetView, currentIdx, remainingAfterThisSet);

    // Superset-aware rest (issue #189): a short transition rest when the
    // auto-advance moves to another member of the same group (A1 -> A2); the
    // full per-exercise rest after the last member and for standalone work.
    const transition = isSupersetTransitionRest(supersetView, currentIdx, nextIdx);
    const restSec = transition ? SUPERSET_TRANSITION_REST_SEC : currentTarget.restSec;

    // For a same-superset transition, show the next exercise immediately so
    // the lifter can get into position while the short transition rest runs.
    // The timer still keeps input locked until it ends or is skipped.
    const navigatedImmediately = transition && nextIdx != null;
    if (navigatedImmediately) selectExercise(nextIdx);

    setMode({
      kind: 'rest',
      endsAt: Date.now() + restSec * 1000,
      pausedRemainingMs: null,
      totalSec: restSec,
      nextExerciseIdx: nextIdx,
      navigatedImmediately,
    });
  }

  async function handleUpdateSet(
    set: PendingSet,
    values: { weight: number; reps: number; rir: number | null },
  ) {
    const db = getDB();
    try {
      let current = (await db.pendingSets.get(set.localId)) ?? set;
      if (current.status === 'syncing') {
        await flushPendingSets();
        current = (await db.pendingSets.get(set.localId)) ?? current;
      }
      const original = {
        weight: current.weight,
        reps: current.reps,
        rir: current.rir,
        status: current.status,
        attempts: current.attempts,
        lastError: current.lastError,
        serverId: current.serverId,
      };
      await db.pendingSets.update(set.localId, {
        weight: values.weight,
        reps: values.reps,
        rir: values.rir,
        status: 'pending',
        attempts: 0,
        lastError: null,
      });
      await flushPendingSets();
      const persisted = await db.pendingSets.get(set.localId);
      const updateState = pendingSetUpdateState(persisted);
      if (updateState === 'missing') {
        throw new Error('set disappeared after update');
      }
      if (updateState === 'failed') {
        await db.pendingSets.update(set.localId, original);
        throw new Error(persisted?.lastError ?? 'set update rejected');
      }
      if (updateState === 'synced') {
        toast.success(t('setUpdated'));
      } else {
        // A transient HTTP/network failure deliberately leaves the edit in the
        // local retry queue. Do not claim remote persistence until it syncs.
        toast.warning(t('setUpdateQueued'));
      }
    } catch (error) {
      toast.error(t('setUpdateError'));
      throw error;
    }
  }

  async function handleDeleteSet(set: PendingSet): Promise<boolean> {
    const db = getDB();
    try {
      let current = (await db.pendingSets.get(set.localId)) ?? set;
      if (!current.serverId && (current.status === 'pending' || current.status === 'syncing')) {
        await flushPendingSets();
        current = (await db.pendingSets.get(set.localId)) ?? current;
      }

      // Once a server id exists, delete the persisted row first. A failed
      // request leaves the local row intact so undo never loses data silently.
      if (current.serverId) {
        const res = await fetch(`/api/sets/${encodeURIComponent(current.serverId)}`, {
          method: 'DELETE',
        });
        if (!res.ok && res.status !== 404) {
          toast.error(t('setDeleteError'));
          return false;
        }
      }
      await db.pendingSets.delete(current.localId);
      toast.success(t('setDeleted'));
      return true;
    } catch {
      toast.error(t('setDeleteError'));
      return false;
    }
  }

  async function handleFinishSession() {
    setClosing(true);
    try {
      // Attempt one last flush before closing, to minimize the residual queue.
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        await flushPendingSets();
      }
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finish: true }),
      });
      if (!res.ok) {
        toast.error(t('finishError'));
        return;
      }
      toast.success(t('finished'));
      router.replace('/');
      router.refresh();
    } finally {
      setClosing(false);
    }
  }

  function selectExercise(index: number) {
    const next = programExercises[index];
    if (!next) return;
    setSelectedIdx(index);
    window.history.replaceState(window.history.state, '', sessionExercisePath(session.id, next.id));
  }

  function handleRestEnd() {
    vibrate(VIBRATION_PATTERNS.restEnd);
    if (isRestEndFlashEnabled()) setRestFlashCount((count) => count + 1);
    if (mode.kind === 'rest' && !mode.navigatedImmediately && mode.nextExerciseIdx != null) {
      selectExercise(mode.nextExerciseIdx);
    }
    setMode({ kind: 'input' });
  }

  function handleSkipRest() {
    if (mode.kind === 'rest' && !mode.navigatedImmediately && mode.nextExerciseIdx != null) {
      selectExercise(mode.nextExerciseIdx);
    }
    setMode({ kind: 'input' });
  }

  function handlePauseRest() {
    if (mode.kind !== 'rest') return;
    setMode(pauseRest(mode, Date.now()));
  }

  function handleResumeRest() {
    if (mode.kind !== 'rest') return;
    setMode(resumeRest(mode, Date.now()));
  }

  function handleAdjustRest(deltaMs: number) {
    if (mode.kind !== 'rest') return;
    setMode(adjustRest(mode, deltaMs, Date.now()));
  }

  function goPrev() {
    selectExercise(Math.max(0, currentIdx - 1));
    setMode({ kind: 'input' });
  }
  // Next is linear for standalone exercises (unchanged) and cycles within a
  // superset group before advancing past it (issue #146).
  const remainingNow = (pe: ProgramExerciseWithExercise) => {
    const target = effectiveProgramExerciseById.get(pe.id) ?? pe;
    return (
      target.targetSets - (setsByExercise.get(keyOf(pe))?.filter((s) => !s.isWarmup).length ?? 0)
    );
  };
  const navNextIdx = nextNavIndex(supersetView, currentIdx, remainingNow);
  function goNext() {
    if (navNextIdx == null) return;
    selectExercise(navNextIdx);
    setMode({ kind: 'input' });
  }

  if (mode.kind === 'summary') {
    return (
      <SessionSummary
        session={session}
        sets={liveSets}
        programExercises={effectiveProgramExercises}
        unit={unit}
        priorSets={priorSetsByExercise}
        onBack={() => setMode({ kind: 'input' })}
        onFinish={handleFinishSession}
        finishing={closing}
      />
    );
  }

  if (!currentPE || !currentTarget) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-6">
        <p className="text-muted-foreground">{t('noExercises')}</p>
      </main>
    );
  }

  // Per block for a repeated exercise (issue #429), else per exercise.
  const lastPerf = lastPerformances[keyOf(currentPE)];
  const currentSets = setsByExercise.get(keyOf(currentPE)) ?? [];
  const currentReturnRecommendation = returnRecommendations[currentPE.id];
  const currentRecommendation = recommendationFor(currentTarget, Date.now());
  const restNextPe =
    mode.kind === 'rest'
      ? mode.nextExerciseIdx != null
        ? (effectiveProgramExercises[mode.nextExerciseIdx] ?? null)
        : currentSets.filter((set) => !set.isWarmup).length < currentTarget.targetSets
          ? currentTarget
          : null
      : null;
  const restNextLabel =
    mode.kind === 'rest' && !mode.navigatedImmediately && restNextPe
      ? exerciseName(restNextPe.exercise.name)
      : null;
  const restRecommendation =
    mode.kind === 'rest' && restNextPe
      ? // A paused rest has not used its remaining time yet, so the recovery the
        // recommendation assumes runs until now plus what is left.
        recommendationFor(
          restNextPe,
          mode.pausedRemainingMs != null ? Date.now() + mode.pausedRemainingMs : mode.endsAt,
        )
      : null;

  return (
    <main className="flex flex-1 flex-col">
      <RestEndFlash count={restFlashCount} />
      {/* Sticky header with progress and exit button */}
      <div className="sticky top-[97px] z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">{trainingName(workout.name)}</p>
            <p className="text-sm font-medium">
              {t('exerciseProgress', {
                current: currentIdx + 1,
                total: programExercises.length,
                name: exerciseName(currentPE.exercise.name),
              })}
            </p>
            {supersetView.labels.has(currentPE.id) && (
              <Badge variant="secondary" className="mt-1">
                {t('superset', { label: supersetView.labels.get(currentPE.id) ?? '' })}
              </Badge>
            )}
            {deloadActive && (
              <Badge variant="secondary" className="mt-1 text-emerald-700 dark:text-emerald-400">
                {t('deloadWeek')}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-muted-foreground"
            aria-label={t('quit')}
          >
            <Link href="/">
              <X className="size-4" />
            </Link>
          </Button>
        </div>
        <Progress value={progressPct} className="mt-2 h-1.5" />
        <SessionExerciseStrip
          exercises={programExercises}
          currentIndex={currentIdx}
          completedProgramExerciseIds={completedProgramExerciseIds}
          disabled={mode.kind !== 'input'}
          onSelect={(index) => {
            selectExercise(index);
            setMode({ kind: 'input' });
          }}
          onOpen={(index) => {
            const pe = programExercises[index];
            if (!pe) return;
            const returnTo = sessionExercisePath(session.id, pe.id);
            router.push(exerciseDetailPath(pe.exerciseId, returnTo));
          }}
        />
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">
        <ExerciseCard
          programExercise={currentPE}
          lastPerformance={lastPerf}
          lastDoneDaysAgo={lastDoneDays ? (lastDoneDays[currentPE.exerciseId] ?? null) : undefined}
          lastDonePending={lastDoneAt !== undefined && lastDoneDays === null}
          timeZone={clientTimeZone}
          readiness={effectiveReadiness}
          deloadActive={deloadActive}
          unit={unit}
          gymName={session.gym?.name ?? null}
          loadConstraints={loadConstraintsFor(currentPE)}
          onOpenMenu={() => setExerciseMenuOpen(true)}
          menuDisabled={mode.kind !== 'input'}
        />
        <SessionExerciseMenu
          open={exerciseMenuOpen}
          onOpenChange={setExerciseMenuOpen}
          programExercise={currentPE}
          programExercises={programExercises}
          catalog={catalog}
          loggedSetCount={currentSets.length}
          onChanged={(options) => {
            setExerciseMenuOpen(false);
            if (options?.selectProgramExerciseId) {
              setPendingExerciseSelection({
                selectProgramExerciseId: options.selectProgramExerciseId,
                removedProgramExerciseId: options.removedProgramExerciseId,
              });
            }
            router.refresh();
          }}
        />
        <ReturnToTrainingNotice
          recommendation={currentReturnRecommendation}
          unit={unit}
          usesBodyweight={currentTarget.exercise.usesBodyweight}
        />

        {currentPE.exercise.category === 'CARDIO' ? (
          <SetsList
            programExercise={currentTarget}
            sets={currentSets}
            isInputActive={mode.kind === 'input'}
            onDeleteSet={handleDeleteSet}
            priorSets={lastPerf?.sets}
          />
        ) : (
          <EditableSetsTable
            programExercise={currentTarget}
            sets={currentSets}
            lastPerformance={lastPerf}
            readiness={effectiveReadiness}
            deloadActive={deloadActive}
            unit={unit}
            recommendation={currentRecommendation}
            loadConstraints={loadConstraintsFor(currentTarget)}
            priorSets={lastPerf?.sets}
            gymId={session.gym?.id ?? null}
            equipmentOptions={sessionEquipment.filter(
              (item) =>
                !droppedEquipmentIds.includes(item.id) &&
                item.exerciseLinks.some((link) => link.exerciseId === currentPE.exerciseId),
            )}
            disabled={!hydrated || mode.kind !== 'input'}
            onEquipmentWeightsUpdated={handleEquipmentWeightsUpdated}
            onSubmit={handleValidate}
            onDeleteSet={handleDeleteSet}
            onUpdateSet={handleUpdateSet}
          />
        )}

        {/* Keep the full logger available while the inline table is introduced:
            strength users still retain warmup/drop-set, notes, AI parsing and
            equipment selection; cardio continues to use this as its only input. */}
        {!hydrated ? null : mode.kind === 'input' ? (
          <SetInput
            programExercise={currentTarget}
            existingSets={currentSets}
            lastPerformance={lastPerf}
            readiness={effectiveReadiness}
            deloadActive={deloadActive}
            unit={unit}
            returnRecommendation={currentReturnRecommendation}
            loadConstraints={loadConstraintsFor(currentTarget)}
            equipmentOptions={sessionEquipment.filter(
              (item) =>
                !droppedEquipmentIds.includes(item.id) &&
                item.exerciseLinks.some((link) => link.exerciseId === currentPE.exerciseId),
            )}
            onSubmit={handleValidate}
          />
        ) : (
          <RestTimer
            endsAt={mode.endsAt}
            pausedRemainingMs={mode.pausedRemainingMs}
            totalSec={mode.totalSec}
            nextLabel={restNextLabel}
            recommendation={restRecommendation}
            unit={unit}
            onEnd={handleRestEnd}
            onSkip={handleSkipRest}
            onPause={handlePauseRest}
            onResume={handleResumeRest}
            onAdjust={handleAdjustRest}
          />
        )}

        {/* In-session coach access (issue #111): opens the chat with this
            session attached so the advice is grounded in the live workout.
            Always available, never auto-triggered. */}
        <Button variant="outline" size="sm" asChild className="min-h-tap">
          <Link href={`/chat?sessionId=${session.id}`}>
            <MessageSquare className="size-4" />
            <span className="ml-2">{t('askCoach')}</span>
          </Link>
        </Button>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={currentIdx === 0 || mode.kind !== 'input'}
            className="min-h-tap"
          >
            <ChevronLeft className="size-4" />
            <span className="ml-1">{t('previous')}</span>
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={() => setMode({ kind: 'summary' })}
            className="min-h-tap"
          >
            <Flag className="size-4" />
            <span className="ml-2">{t('finish')}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={goNext}
            disabled={navNextIdx == null || mode.kind !== 'input'}
            className="min-h-tap"
          >
            <span className="mr-1">{t('next')}</span>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </main>
  );
}
