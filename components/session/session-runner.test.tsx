import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingSet } from '@/lib/indexeddb';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { SessionRunner } from './session-runner';

// The runner is wired to IndexedDB, the sync queue and the router. These tests
// cover the wiring around the in-session exercise menu and the superset
// transition, so the storage layer and the leaf components are stubbed and the
// runner's own state machine runs for real.

type MenuProps = {
  loggedSetCount: number;
  onChanged: (options?: {
    selectProgramExerciseId?: string;
    removedProgramExerciseId?: string;
  }) => void;
};
type CardProps = {
  onOpenMenu?: () => void;
  menuDisabled?: boolean;
  lastDoneDaysAgo?: number | null;
  lastDonePending?: boolean;
  timeZone?: string | null;
};
type EquipmentOption = {
  id: string;
  name: string;
  equipmentType: string;
  weightOptions: number[];
  exerciseLinks: { exerciseId: string }[];
};
type TableProps = {
  programExercise: { id: string };
  equipmentOptions?: EquipmentOption[];
  loadConstraints?: { weightOptions?: number[] } | null;
  onEquipmentWeightsUpdated?: (equipment: EquipmentOption, updatedExerciseIds: string[]) => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
};

const harness = vi.hoisted(() => ({
  liveSets: [] as unknown[],
  card: null as unknown,
  cardRenders: [] as unknown[],
  menu: null as unknown,
  table: null as unknown,
  tableUnmounts: 0,
  refresh: vi.fn(),
  vibrate: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: harness.refresh, replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => harness.liveSets }));
vi.mock('@/lib/indexeddb', () => ({ generateLocalId: () => 'local-1', getDB: vi.fn() }));
vi.mock('@/lib/sync', () => ({
  bindAutoSync: () => () => undefined,
  drainDroppedEquipment: async () => [],
  flushPendingSets: vi.fn(),
  onEquipmentDropped: () => () => undefined,
  pendingSetUpdateState: vi.fn(),
  queueSet: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/sync-hydration', () => ({ hydrateFromServerSets: vi.fn(async () => undefined) }));
vi.mock('@/lib/wake-lock', () => ({
  acquireWakeLock: async () => undefined,
  bindWakeLockToVisibility: () => () => undefined,
  releaseWakeLock: async () => undefined,
}));
vi.mock('@/lib/vibrate', () => ({
  vibrate: (pattern: unknown) => harness.vibrate(pattern),
  VIBRATION_PATTERNS: { validate: 'validate', restEnd: 'rest-end' },
}));
vi.mock('@/components/shared/use-exercise-name', () => ({
  useExerciseName: () => (name: string) => name,
}));
vi.mock('@/components/shared/use-training-name', () => ({
  useTrainingName: () => (name: string) => name,
}));
vi.mock('@/components/session/exercise-card', () => ({
  ExerciseCard: (props: CardProps) => {
    harness.card = props;
    harness.cardRenders.push(props);
    return null;
  },
}));
vi.mock('@/components/session/sets-list', () => ({ SetsList: () => null }));
vi.mock('@/components/session/set-input', () => ({ SetInput: () => null }));
vi.mock('@/components/session/session-summary', () => ({ SessionSummary: () => null }));
vi.mock('@/components/session/return-to-training-notice', () => ({
  ReturnToTrainingNotice: () => null,
}));
vi.mock('@/components/session/session-exercise-strip', () => ({
  SessionExerciseStrip: ({
    onSelect,
    exercises,
  }: {
    onSelect: (index: number) => void;
    exercises: Array<{ id: string }>;
  }) => (
    <div data-testid="exercise-strip">
      {exercises.map((pe, idx) => (
        <button
          key={pe.id}
          data-testid={`strip-${pe.id}`}
          onClick={() => onSelect(idx)}
          type="button"
        >
          {pe.id}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@/components/session/session-exercise-menu', () => ({
  SessionExerciseMenu: (props: MenuProps) => {
    harness.menu = props;
    return null;
  },
}));
vi.mock('@/components/session/editable-sets-table', () => ({
  EditableSetsTable: function TableStub(props: TableProps) {
    harness.table = props;
    useEffect(
      () => () => {
        harness.tableUnmounts += 1;
      },
      [],
    );
    return <div data-testid="sets-table">{props.programExercise.id}</div>;
  },
}));
vi.mock('@/components/session/rest-timer', () => ({
  RestTimer: ({
    endsAt,
    pausedRemainingMs,
    onSkip,
  }: {
    endsAt: number;
    pausedRemainingMs?: number | null;
    onSkip: () => void;
  }) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), 100);
      return () => clearInterval(id);
    }, [endsAt]);
    const remainingMs = pausedRemainingMs != null ? pausedRemainingMs : Math.max(0, endsAt - now);
    const remainingSec = Math.ceil(remainingMs / 1000);
    return (
      <div>
        <button type="button" onClick={onSkip}>
          skip rest
        </button>
        <span data-testid="rest-remaining">{remainingSec}</span>
      </div>
    );
  },
}));

const card = () => harness.card as CardProps;
const menu = () => harness.menu as MenuProps;
const table = () => harness.table as TableProps;

function exercise(id: string, name: string): Exercise {
  return {
    id,
    userId: 'u',
    name,
    muscleGroup: 'CHEST',
    category: 'COMPOUND',
    defaultRestSec: 120,
    notes: null,
    usesBodyweight: false,
    equipmentType: 'BARBELL',
    isFavorite: false,
    createdAt: new Date(),
  };
}

function row(
  id: string,
  order: number,
  supersetGroup: number | null = null,
): ProgramExercise & { exercise: Exercise } {
  return {
    id: 'pe-' + id,
    workoutId: 'w',
    exerciseId: id,
    order,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetRIR: 2,
    restSec: 120,
    tempo: null,
    notes: null,
    supersetGroup,
    autoregulationMode: 'PRESERVE_RIR',
    fatigueRate: null,
    loadAdjustmentPct: null,
    exercise: exercise(id, id),
  };
}

type RunnerProps = ComponentProps<typeof SessionRunner>;

function runner(
  rows: Array<ProgramExercise & { exercise: Exercise }>,
  initial?: string,
  gym: unknown = null,
) {
  const session = {
    id: 's1',
    workout: { id: 'w', name: 'Push', program: null, exercises: rows },
    sets: [],
    gym,
  } as unknown as RunnerProps['session'];
  return (
    <SessionRunner
      session={session}
      lastPerformances={{}}
      returnRecommendations={{}}
      readiness={null}
      deloadActive={false}
      unit="KG"
      initialProgramExerciseId={initial}
      catalog={[]}
      userId="u1"
    />
  );
}

// Lets the mount effect (IndexedDB hydration) settle inside act.
async function renderRunner(element: ReactElement) {
  const view = render(element);
  await act(async () => undefined);
  return view;
}

const loggedSet = { weight: 60, reps: 8, rir: 2, durationSec: null, distanceM: null };

beforeEach(() => {
  harness.liveSets = [];
  harness.card = null;
  harness.cardRenders = [];
  harness.menu = null;
  harness.table = null;
  harness.tableUnmounts = 0;
  harness.refresh.mockClear();
  harness.vibrate.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SessionRunner exercise menu wiring', () => {
  it('counts every logged set of the exercise for the menu warning, warm-ups included', async () => {
    harness.liveSets = [
      { localId: 'l1', exerciseId: 'bench', setNumber: 1, isWarmup: true, isDropSet: false },
    ] as unknown as PendingSet[];
    await renderRunner(runner([row('bench', 1), row('fly', 2)]));
    expect(menu().loggedSetCount).toBe(1);
  });

  it('selects the neighbour after a removal, keeps the URL in step and keeps the sets table mounted', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const view = await renderRunner(runner([row('bench', 1), row('fly', 2)], 'pe-fly'));
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-fly');

    act(() => {
      menu().onChanged({ selectProgramExerciseId: 'pe-bench', removedProgramExerciseId: 'pe-fly' });
    });
    expect(harness.refresh).toHaveBeenCalledOnce();
    // Until the refreshed props arrive the removed row is still the current one.
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-fly');

    view.rerender(runner([row('bench', 1)], 'pe-fly'));

    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-bench');
    expect(screen.queryByText('No exercises in this session.')).not.toBeInTheDocument();
    // The list was one row shorter for a render; the table (and the drafts it
    // parks) must not have been torn down for it.
    expect(harness.tableUnmounts).toBe(0);
    expect(replaceState).toHaveBeenLastCalledWith(
      window.history.state,
      '',
      '/session/s1?programExerciseId=pe-bench',
    );
  });

  it('disables the exercise menu during rest (PR1: defer add/delete to PR2)', async () => {
    await renderRunner(runner([row('bench', 1), row('fly', 2)]));
    expect(card().onOpenMenu).toBeTypeOf('function');
    expect(card().menuDisabled).toBe(false);

    await act(async () => {
      await table().onSubmit({ ...loggedSet, isWarmup: false, isDropSet: false, notes: null });
    });

    // Resting: menu button stays rendered but disabled (maintainer review: prevents header jump).
    expect(await screen.findByRole('button', { name: 'skip rest' })).toBeInTheDocument();
    expect(card().onOpenMenu).toBeTypeOf('function');
    expect(card().menuDisabled).toBe(true);

    // Skip rest returns to input mode, menu enabled again
    fireEvent.click(screen.getByRole('button', { name: 'skip rest' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'skip rest' })).not.toBeInTheDocument(),
    );
    expect(card().onOpenMenu).toBeTypeOf('function');
    expect(card().menuDisabled).toBe(false);
  });

  it('does not jump to a newly added row after the list shrank under the selection', async () => {
    const view = await renderRunner(runner([row('bench', 1), row('fly', 2)], 'pe-fly'));
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-fly');

    // The selected row disappears without a pending selection to replace it
    // (removed elsewhere, or a selection whose target never arrives).
    view.rerender(runner([row('bench', 1)], 'pe-fly'));
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-bench');

    // A row added afterwards takes the old index; the view must stay put.
    view.rerender(runner([row('bench', 1), row('dips', 2)], 'pe-fly'));
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-bench');
  });
});

describe('SessionRunner rest timers and auto-advance', () => {
  // The tests below drive the clock; a failed assertion must not leave fake
  // timers on for the rest of the file.
  afterEach(() => {
    vi.useRealTimers();
  });

  const logSet = () =>
    act(async () => {
      await table().onSubmit({ ...loggedSet, isWarmup: false, isDropSet: false, notes: null });
    });
  const advance = (ms: number) =>
    act(async () => {
      vi.advanceTimersByTime(ms);
    });
  const selectInStrip = (id: string) =>
    act(async () => {
      fireEvent.click(screen.getByTestId(`strip-${id}`));
    });
  const skipRest = () => screen.queryByRole('button', { name: 'skip rest' });

  it('navigates to the next member once (issue #542, PR1: per-exercise rest)', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    await renderRunner(runner([row('a1', 1, 1), row('a2', 2, 1), row('a3', 3, 1)]));
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-a1');

    await act(async () => {
      await table().onSubmit({ ...loggedSet, isWarmup: false, isDropSet: false, notes: null });
    });

    // The next member is shown right away, while the transition rest runs on a1.
    // Since this is a superset transition, a2 shows a1's rest timer (#542 PR1).
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-a2');
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'skip rest' })).toBeInTheDocument();

    // Skipping the transition rest does not navigate a second time (already on a2).
    const skipButton = screen.getByRole('button', { name: 'skip rest' });
    await userEvent.click(skipButton);

    // Wait for skip button to disappear (rest ended)
    await waitFor(() => expect(skipButton).not.toBeInTheDocument());

    // Verify still on a2 (skip did not navigate again)
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-a2');
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it('background timer expires and flips state without auto-navigate', async () => {
    vi.useFakeTimers();
    const replaceState = vi.spyOn(window.history, 'replaceState');
    await renderRunner(runner([row('a', 1, 1), row('b', 2, 1)]));

    // Log set on A, auto-navigates to B (superset transition)
    await logSet();
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-b');
    expect(replaceState).toHaveBeenCalledTimes(1);

    // A's timer runs in background. Advance time past A's rest duration (120s + 1s)
    await advance(121000);

    // A's timer expired in background - no navigation (we're viewing B, not A)
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-b');
    expect(replaceState).toHaveBeenCalledTimes(1); // No additional navigation
  });

  it('runs two independent rest timers without interference', async () => {
    vi.useFakeTimers();
    await renderRunner(runner([row('a', 1), row('b', 2)]));
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-a');

    // A set on A starts A's 120 s rest.
    await logSet();
    expect(skipRest()).toBeInTheDocument();

    // 30 s later the lifter moves to B and logs a set there: B gets its own
    // 120 s rest while A's keeps running.
    await advance(30000);
    await selectInStrip('pe-b');
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-b');
    await logSet();
    expect(skipRest()).toBeInTheDocument();

    // Another 30 s: B has rested 30 s and A 60 s. One shared clock, or B's set
    // restarting A's rest, would show the same value on both.
    await advance(30000);
    expect(screen.getByTestId('rest-remaining')).toHaveTextContent(/^90$/);

    await selectInStrip('pe-a');
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-a');
    expect(skipRest()).toBeInTheDocument();
    expect(screen.getByTestId('rest-remaining')).toHaveTextContent(/^60$/);
  });

  it('stays on the viewed exercise when a rest ends on another one, and still fires the cue', async () => {
    vi.useFakeTimers();
    // A is complete after one set, so its rest carries B as the exercise to
    // advance to. That is the case the "only when viewing" guard exists for.
    await renderRunner(runner([{ ...row('a', 1), targetSets: 1 }, row('b', 2), row('c', 3)]));
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-a');

    await logSet();
    expect(skipRest()).toBeInTheDocument();

    // The lifter moves on to C while A rests.
    await selectInStrip('pe-c');
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-c');
    harness.vibrate.mockClear();

    // A's 120 s rest runs out in the background.
    await advance(121000);

    // No jump to B: the lifter is not looking at A.
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-c');
    // The rest-end cue fired once, for A's rest.
    expect(harness.vibrate).toHaveBeenCalledTimes(1);
    expect(harness.vibrate).toHaveBeenCalledWith('rest-end');

    // Back on A, the rest is over: input again, no timer.
    await selectInStrip('pe-a');
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-a');
    expect(skipRest()).not.toBeInTheDocument();
  });

  it('advances to the next exercise when the rest ends on the viewed, completed exercise', async () => {
    vi.useFakeTimers();
    const replaceState = vi.spyOn(window.history, 'replaceState');
    await renderRunner(runner([{ ...row('a', 1), targetSets: 1 }, row('b', 2)]));

    // The only target set of A: its rest carries B as the next exercise, and
    // the lifter stays on A while it runs.
    await logSet();
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-a');
    expect(skipRest()).toBeInTheDocument();
    expect(replaceState).not.toHaveBeenCalled();

    await advance(121000);

    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-b');
    expect(skipRest()).not.toBeInTheDocument();
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it('keeps a rest change made in the same instant as another rest running out', async () => {
    vi.useFakeTimers();
    await renderRunner(runner([row('a', 1), row('b', 2)]));

    // A rests from 0 s to 120 s, B (logged one minute later) from 60 s to 180 s.
    await logSet();
    await advance(60000);
    await selectInStrip('pe-b');
    await logSet();
    await advance(59000);
    expect(skipRest()).toBeInTheDocument();

    // The lifter skips B's rest and, before React has rendered that change,
    // the background tick finds A's rest over. The tick must flip A without
    // putting B's skipped rest back.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'skip rest' }));
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-b');
    expect(skipRest()).not.toBeInTheDocument();

    await selectInStrip('pe-a');
    expect(skipRest()).not.toBeInTheDocument();
  });
});

describe('SessionRunner live equipment weights', () => {
  // A gym whose one machine is linked to the bench row, as the session page sends it.
  function gym(weightOptions: number[], name = 'Chest Press') {
    return {
      id: 'g1',
      name: 'Home',
      dumbbellWeights: [],
      plateWeights: [],
      barWeights: [],
      exerciseConfigs: [{ exerciseId: 'bench', isAvailable: true, weightOptions }],
      equipment: [
        {
          id: 'm1',
          name,
          equipmentType: 'MACHINE',
          weightOptions,
          exerciseLinks: [{ exerciseId: 'bench' }],
        },
      ],
    };
  }

  it('shows a weight edit at once, keeps it across re-renders and follows the server after a refresh', async () => {
    const element = runner([row('bench', 1)], undefined, gym([20, 40]));
    const view = await renderRunner(element);
    expect(table().equipmentOptions).toEqual([
      expect.objectContaining({ id: 'm1', weightOptions: [20, 40] }),
    ]);
    expect(table().loadConstraints?.weightOptions).toEqual([20, 40]);

    act(() => {
      table().onEquipmentWeightsUpdated?.(
        {
          id: 'm1',
          name: 'Chest Press',
          equipmentType: 'MACHINE',
          weightOptions: [25, 50],
          exerciseLinks: [{ exerciseId: 'bench' }],
        },
        ['bench'],
      );
    });
    expect(table().equipmentOptions?.[0]?.weightOptions).toEqual([25, 50]);
    expect(table().loadConstraints?.weightOptions).toEqual([25, 50]);

    // Same props, new render: the edit is still shown.
    view.rerender(element);
    expect(table().equipmentOptions?.[0]?.weightOptions).toEqual([25, 50]);
    expect(table().loadConstraints?.weightOptions).toEqual([25, 50]);

    // router.refresh delivers a new server snapshot: it wins over the local copy.
    view.rerender(runner([row('bench', 1)], undefined, gym([30, 60], 'Chest Press v2')));
    expect(table().equipmentOptions).toEqual([
      expect.objectContaining({ id: 'm1', name: 'Chest Press v2', weightOptions: [30, 60] }),
    ]);
    expect(table().loadConstraints?.weightOptions).toEqual([30, 60]);
  });

  it('applies new weights only to the exercises the server updated (#471)', async () => {
    // The save renames the machine, but the server updated no exercise config:
    // the bench row keeps its own options, as a reload would show.
    const element = runner([row('bench', 1)], undefined, gym([20, 40]));
    await renderRunner(element);

    act(() => {
      table().onEquipmentWeightsUpdated?.(
        {
          id: 'm1',
          name: 'Chest Press v2',
          equipmentType: 'MACHINE',
          weightOptions: [25, 50],
          exerciseLinks: [{ exerciseId: 'bench' }],
        },
        [],
      );
    });
    expect(table().equipmentOptions).toEqual([
      expect.objectContaining({ id: 'm1', name: 'Chest Press v2', weightOptions: [25, 50] }),
    ]);
    expect(table().loadConstraints?.weightOptions).toEqual([20, 40]);
  });
});

describe('SessionRunner last done (issue #459)', () => {
  // A morning session in Auckland (UTC+13 in October): the last bench was the
  // previous evening there. Both instants fall on 2026-10-17 in every zone from
  // UTC-10 to UTC+12 (the server's zone in Docker, or this machine's), so only
  // the browser's zone gives "yesterday" (review of #476).
  const lastBench = '2026-10-17T10:30:00Z'; // 23:30 on the 17th in Auckland
  const now = new Date('2026-10-17T11:30:00Z'); // 00:30 on the 18th in Auckland

  function inAuckland() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
      this: Intl.DateTimeFormat,
    ) {
      return { ...resolved.call(this), timeZone: 'Pacific/Auckland' };
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts the days in the browser zone, not the server zone', async () => {
    inAuckland();
    harness.liveSets = [];
    await renderRunner(
      <SessionRunner {...runner([row('bench', 1)]).props} lastDoneAt={{ bench: lastBench }} />,
    );
    expect(card().lastDoneDaysAgo).toBe(1);
    expect(card().lastDonePending).toBe(false);
  });

  it('dates the last session box in the browser zone once mounted (issue #480)', async () => {
    inAuckland();
    harness.liveSets = [];
    await renderRunner(
      <SessionRunner {...runner([row('bench', 1)]).props} lastDoneAt={{ bench: lastBench }} />,
    );
    expect(card().timeZone).toBe('Pacific/Auckland');
  });

  it('renders the line as pending before mount, so the first render matches the server', async () => {
    inAuckland();
    harness.liveSets = [];
    await renderRunner(
      <SessionRunner {...runner([row('bench', 1)]).props} lastDoneAt={{ bench: lastBench }} />,
    );
    const first = harness.cardRenders[0] as CardProps;
    expect(first.lastDonePending).toBe(true);
    expect(first.lastDoneDaysAgo).toBeUndefined();
    expect(first.timeZone).toBeNull();
    expect(card().lastDonePending).toBe(false);
  });

  it('is not pending when the page sends no last-done data', async () => {
    harness.liveSets = [];
    await renderRunner(runner([row('bench', 1)]));
    expect((harness.cardRenders[0] as CardProps).lastDonePending).toBe(false);
  });

  it('clears the midnight timer on unmount (issue #480)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 9, 17, 23, 0, 0));
    harness.liveSets = [];
    const view = await renderRunner(
      <SessionRunner
        {...runner([row('bench', 1)]).props}
        lastDoneAt={{ bench: new Date(2026, 9, 17, 9, 0, 0).toISOString() }}
      />,
    );
    const pendingWithPage = vi.getTimerCount();
    expect(pendingWithPage).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(pendingWithPage - 1);
    const rendersAtUnmount = harness.cardRenders.length;
    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1000 + 1000);
    });
    expect(harness.cardRenders).toHaveLength(rendersAtUnmount);
  });

  it('recounts the days at local midnight for a page left open (issue #480)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 9, 17, 23, 0, 0));
    harness.liveSets = [];
    const doneThisMorning = new Date(2026, 9, 17, 9, 0, 0).toISOString();
    await renderRunner(
      <SessionRunner
        {...runner([row('bench', 1)]).props}
        lastDoneAt={{ bench: doneThisMorning }}
      />,
    );
    expect(card().lastDoneDaysAgo).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1000 + 1000);
    });
    expect(card().lastDoneDaysAgo).toBe(1);
  });

  it('passes null for an exercise never done and nothing when the page sends no data', async () => {
    inAuckland();
    harness.liveSets = [];
    const rows = [row('bench', 1), row('fly', 2)];
    const view = await renderRunner(
      <SessionRunner {...runner(rows, 'pe-fly').props} lastDoneAt={{ bench: lastBench }} />,
    );
    expect(card().lastDoneDaysAgo).toBeNull();
    view.unmount();
    await renderRunner(runner(rows, 'pe-bench'));
    expect(card().lastDoneDaysAgo).toBeUndefined();
  });
});

describe('SessionRunner repeated exercise blocks (issue #429)', () => {
  // 5/3/1 BBB: the same lift programmed twice. Each row must read its own
  // block of sets, and a set logged on the second row carries block 1.
  function bbbRows() {
    const main = row('bench', 1);
    const bbb = { ...row('bench', 2), id: 'pe-bench-bbb', targetSets: 5 };
    return [main, bbb];
  }
  const tableSets = () => (harness.table as { sets: unknown[] }).sets;

  it('gives each occurrence its own sets, reading a set without a block as the first', async () => {
    harness.liveSets = [
      { localId: 'l1', exerciseId: 'bench', setNumber: 1, isWarmup: false, block: null },
      { localId: 'l2', exerciseId: 'bench', setNumber: 2, isWarmup: false, block: 0 },
      { localId: 'l3', exerciseId: 'bench', setNumber: 1, isWarmup: false, block: 1 },
    ] as unknown as PendingSet[];
    const view = await renderRunner(runner(bbbRows()));
    expect(tableSets()).toHaveLength(2);
    expect(menu().loggedSetCount).toBe(2);
    view.unmount();

    await renderRunner(runner(bbbRows(), 'pe-bench-bbb'));
    expect(tableSets()).toHaveLength(1);
    expect(menu().loggedSetCount).toBe(1);
  });

  it('logs a set on the second occurrence as block 1, numbered within its block', async () => {
    const { queueSet } = await import('@/lib/sync');
    vi.mocked(queueSet).mockClear();
    harness.liveSets = [
      { localId: 'l1', exerciseId: 'bench', setNumber: 1, isWarmup: false, block: 0 },
      { localId: 'l2', exerciseId: 'bench', setNumber: 2, isWarmup: false, block: 0 },
    ] as unknown as PendingSet[];
    await renderRunner(runner(bbbRows(), 'pe-bench-bbb'));
    await act(async () => {
      await table().onSubmit({ ...loggedSet, isWarmup: false, isDropSet: false, notes: null });
    });
    expect(queueSet).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseId: 'bench', block: 1, setNumber: 1 }),
    );
  });

  it('shows the movement freshness per exercise on both occurrences (issue #459)', async () => {
    harness.liveSets = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
    const withDays = (initial?: string) => (
      <SessionRunner
        {...runner(bbbRows(), initial).props}
        lastDoneAt={{ bench: '2026-10-14T12:00:00Z' }}
      />
    );
    const view = await renderRunner(withDays());
    expect(card().lastDoneDaysAgo).toBe(3);
    view.unmount();
    await renderRunner(withDays('pe-bench-bbb'));
    expect(card().lastDoneDaysAgo).toBe(3);
    vi.useRealTimers();
  });

  it('logs a set of an exercise programmed once without a block, as before', async () => {
    const { queueSet } = await import('@/lib/sync');
    vi.mocked(queueSet).mockClear();
    await renderRunner(runner([row('bench', 1), row('fly', 2)]));
    await act(async () => {
      await table().onSubmit({ ...loggedSet, isWarmup: false, isDropSet: false, notes: null });
    });
    expect(queueSet).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseId: 'bench', block: null, setNumber: 1 }),
    );
  });

  it('tags queued sets and the hydration with the signed-in account (issue #490)', async () => {
    const { queueSet } = await import('@/lib/sync');
    const { flushPendingSets } = await import('@/lib/sync');
    const { hydrateFromServerSets } = await import('@/lib/sync-hydration');
    vi.mocked(queueSet).mockClear();
    vi.mocked(flushPendingSets).mockClear();
    vi.mocked(hydrateFromServerSets).mockClear();
    await renderRunner(runner([row('bench', 1)]));
    expect(hydrateFromServerSets).toHaveBeenCalledWith('s1', [], 'u1');
    // Legacy rows the hydration claimed are sent right away.
    expect(flushPendingSets).toHaveBeenCalledWith('u1');
    await act(async () => {
      await table().onSubmit({ ...loggedSet, isWarmup: false, isDropSet: false, notes: null });
    });
    expect(queueSet).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', userId: 'u1' }),
    );
  });
});

// Freestyle session (issue #388): no workout; the page hands the runner the
// session's own list in the shape of a workout and sets `freestyle`.
describe('SessionRunner freestyle session', () => {
  const catalog = [
    {
      id: 'bench',
      name: 'Bench Press',
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
      usesBodyweight: false,
      defaultRestSec: 120,
      isFavorite: false,
    },
  ] as RunnerProps['catalog'];

  function freestyleRunner(
    rows: Array<ProgramExercise & { exercise: Exercise }>,
    freestyle = true,
    serverSets: unknown[] = [],
  ) {
    const session = {
      id: 's1',
      workout: { id: '', name: '', program: null, exercises: rows },
      sets: serverSets,
      gym: null,
    } as unknown as RunnerProps['session'];
    return (
      <SessionRunner
        session={session}
        freestyle={freestyle}
        lastPerformances={{}}
        returnRecommendations={{}}
        readiness={null}
        deloadActive={false}
        unit="KG"
        catalog={catalog}
        userId="u1"
      />
    );
  }

  it('starts on the exercise picker and refreshes once the first exercise is added', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    await renderRunner(freestyleRunner([]));

    expect(screen.getByRole('heading', { name: 'Free session' })).toBeInTheDocument();
    expect(screen.getByText('Add your first exercise')).toBeInTheDocument();
    expect(screen.queryByText('No exercises in this session.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Bench Press' }));
    await waitFor(() => expect(harness.refresh).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/sessions/s1/exercises');
  });

  it('discards an empty session only after a confirmation, through the guarded route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    await renderRunner(freestyleRunner([]));

    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard this empty session' }));
    // First tap only asks.
    expect(screen.getByText('Discard this session? Nothing is logged in it.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // Cancel goes back without a request.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Discard this session? Nothing is logged in it.')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Discard this empty session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard this empty session' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    // The server refuses this form when the session holds sets.
    expect(fetchMock.mock.calls[0]).toEqual(['/api/sessions/s1?discardEmpty=1', { method: 'DELETE' }]);
  });

  it('does not offer to discard before the local sets are hydrated', () => {
    // Plain render, no awaited effects: the live query is still at its empty
    // default, which says nothing about what the session holds.
    render(freestyleRunner([]));
    expect(screen.getByText('Add your first exercise')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Discard this empty session' }),
    ).not.toBeInTheDocument();
  });

  it('never offers to discard when the server holds sets the local store does not show', async () => {
    // IndexedDB unavailable or behind: the live query is empty, the page
    // props are not. Offering a discard here would delete those sets.
    harness.liveSets = [];
    await renderRunner(
      freestyleRunner([], true, [
        { id: 'set-1', sessionId: 's1', exerciseId: 'bench', setNumber: 1, ...loggedSet },
        { id: 'set-2', sessionId: 's1', exerciseId: 'bench', setNumber: 2, ...loggedSet },
      ]),
    );

    expect(
      screen.queryByRole('button', { name: 'Discard this empty session' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
    // The sets are named, so an emptied list does not read as lost data.
    expect(screen.getByTestId('freestyle-logged-sets')).toHaveTextContent(
      '2 sets are already logged in this session.',
    );
  });

  it('offers to finish, not to discard, once a set is logged locally and the list is empty again', async () => {
    harness.liveSets = [
      { localId: 'l1', sessionId: 's1', exerciseId: 'bench', setNumber: 1, ...loggedSet },
    ];
    await renderRunner(freestyleRunner([]));

    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Discard this empty session' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('freestyle-logged-sets')).toHaveTextContent(
      '1 set is already logged in this session.',
    );
  });

  it('refreshes instead of leaving when the server refuses the discard', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    await renderRunner(freestyleRunner([]));

    fireEvent.click(screen.getByRole('button', { name: 'Discard this empty session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard this empty session' }));
    await waitFor(() => expect(harness.refresh).toHaveBeenCalledOnce());
    expect(screen.queryByText('Discard this session? Nothing is logged in it.')).not.toBeInTheDocument();
  });

  it('runs the list like a workout and points the menu at the session', async () => {
    await renderRunner(freestyleRunner([row('bench', 1)]));

    expect(screen.getByText('Free session')).toBeInTheDocument();
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-bench');
    expect((menu() as MenuProps & { freestyleSessionId?: string }).freestyleSessionId).toBe('s1');
  });

  it('keeps the plain empty state and the workout menu for a session with a workout', async () => {
    const empty = await renderRunner(freestyleRunner([], false));
    expect(screen.getByText('No exercises in this session.')).toBeInTheDocument();
    expect(screen.queryByText('Add your first exercise')).not.toBeInTheDocument();
    empty.unmount();

    await renderRunner(runner([row('bench', 1)]));
    expect(
      (menu() as MenuProps & { freestyleSessionId?: string }).freestyleSessionId,
    ).toBeUndefined();
    expect(screen.queryByText('Free session')).not.toBeInTheDocument();
  });
});
