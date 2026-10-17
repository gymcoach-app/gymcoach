import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ComponentProps, type ReactElement, type ReactNode } from 'react';
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
type CardProps = { onOpenMenu?: () => void; menuDisabled?: boolean };
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
  onEquipmentWeightsUpdated?: (equipment: EquipmentOption) => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
};

const harness = vi.hoisted(() => ({
  liveSets: [] as unknown[],
  card: null as unknown,
  menu: null as unknown,
  table: null as unknown,
  tableUnmounts: 0,
  refresh: vi.fn(),
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
vi.mock('@/lib/sync-hydration', () => ({ hydrateFromServerSets: async () => undefined }));
vi.mock('@/lib/wake-lock', () => ({
  acquireWakeLock: async () => undefined,
  bindWakeLockToVisibility: () => () => undefined,
  releaseWakeLock: async () => undefined,
}));
vi.mock('@/lib/vibrate', () => ({
  vibrate: () => undefined,
  VIBRATION_PATTERNS: { validate: [], restEnd: [] },
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
  SessionExerciseStrip: () => null,
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
  RestTimer: ({ onSkip }: { onSkip: () => void }) => (
    <button type="button" onClick={onSkip}>
      skip rest
    </button>
  ),
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
  harness.menu = null;
  harness.table = null;
  harness.tableUnmounts = 0;
  harness.refresh.mockClear();
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

  it('keeps the actions button on the card during a rest, disabled', async () => {
    await renderRunner(runner([row('bench', 1), row('fly', 2)]));
    expect(card().onOpenMenu).toBeTypeOf('function');
    expect(card().menuDisabled).toBe(false);

    await act(async () => {
      await table().onSubmit({ ...loggedSet, isWarmup: false, isDropSet: false, notes: null });
    });

    // Resting: the button keeps its box (so the header does not jump) but
    // cannot open the menu.
    expect(await screen.findByRole('button', { name: 'skip rest' })).toBeInTheDocument();
    expect(card().onOpenMenu).toBeTypeOf('function');
    expect(card().menuDisabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'skip rest' }));
    await waitFor(() => expect(card().menuDisabled).toBe(false));
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

describe('SessionRunner superset transition', () => {
  it('navigates to the next member once: skipping the transition rest does not navigate again', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    await renderRunner(runner([row('a1', 1, 1), row('a2', 2, 1), row('a3', 3, 1)]));
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-a1');

    await act(async () => {
      await table().onSubmit({ ...loggedSet, isWarmup: false, isDropSet: false, notes: null });
    });

    // The next member is shown right away, while the transition rest runs.
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-a2');
    expect(replaceState).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByRole('button', { name: 'skip rest' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'skip rest' })).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('sets-table')).toHaveTextContent('pe-a2');
    expect(replaceState).toHaveBeenCalledTimes(1);
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
      table().onEquipmentWeightsUpdated?.({
        id: 'm1',
        name: 'Chest Press',
        equipmentType: 'MACHINE',
        weightOptions: [25, 50],
        exerciseLinks: [{ exerciseId: 'bench' }],
      });
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
});
