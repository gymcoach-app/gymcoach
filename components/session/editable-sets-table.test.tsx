import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditableSetsTable } from './editable-sets-table';
import type { PendingSet } from '@/lib/indexeddb';
import type { IntraSetRecommendation } from '@/lib/intra-set-autoregulation';

const programExercise = {
  id: 'pe-1',
  exerciseId: 'exercise-1',
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 12,
  targetRIR: 2,
  exercise: { id: 'exercise-1', name: 'Squat', category: 'COMPOUND' },
} as never;

// The open weight picker renders about 88 option buttons, and a role + name
// query computes the accessible name of every one of them. The picker's Apply
// control is found by its accessible label instead, and still asserted to be a
// button, so the query stays as strict at a fraction of the cost (lesson L42).
function applyValueButton(): HTMLElement {
  const button = screen.getByLabelText(/apply value/i);
  expect(button).toHaveRole('button');
  return button;
}

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('EditableSetsTable', () => {
  it('switches calculated columns and persists the selection', async () => {
    const user = userEvent.setup();
    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[
          {
            localId: 'metric-set',
            sessionId: 'session-1',
            exerciseId: 'exercise-1',
            setNumber: 1,
            weight: 100,
            reps: 10,
            rir: 2,
            notes: null,
            isWarmup: false,
            isDropSet: false,
            status: 'synced',
            serverId: 'metric-server',
            syncedAt: 1,
            attempts: 0,
            lastError: null,
            createdAt: 1,
          } as PendingSet,
        ]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onDeleteSet={vi.fn()}
        onUpdateSet={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByTestId('set-metric-header-1RM')).toBeInTheDocument();
    const columnPicker = screen.getByRole('button', { name: 'Choose calculated columns' });
    // 44 px tap target, pulled into the header padding so the row keeps its height.
    expect(columnPicker).toHaveClass('size-11', '-my-2');
    await user.click(columnPicker);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Volume' }));

    expect(screen.getByTestId('set-metric-header-VOLUME')).toBeInTheDocument();
    expect(screen.getByTestId('completed-set-1-metric-VOLUME')).toHaveTextContent('1000');
    expect(window.localStorage.getItem('gymcoach.prefs.v1')).toContain('VOLUME');

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Estimated 10RM' }));
    expect(screen.queryByTestId('set-metric-header-1RM')).not.toBeInTheDocument();
    expect(screen.getByTestId('set-metric-header-10RM')).toBeInTheDocument();
    expect(screen.getByTestId('completed-set-1-metric-10RM')).toHaveTextContent('100');
  });
  it('edits and confirms the active set row through value pickers', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={onSubmit}
        onDeleteSet={vi.fn()}
        onUpdateSet={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /weight/i }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } });
    fireEvent.click(applyValueButton());

    fireEvent.click(screen.getByRole('button', { name: /repetitions/i }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '10' } });
    fireEvent.click(applyValueButton());
    await user.click(screen.getByRole('combobox', { name: /reps in reserve/i }));
    await user.click(screen.getByRole('option', { name: '1' }));

    expect(screen.getByTestId('active-set-metric-1RM')).toHaveTextContent(/^133\.3 kg$/);
    fireEvent.click(screen.getByRole('button', { name: /confirm set 1/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        weight: 100,
        reps: 10,
        rir: 1,
        durationSec: null,
        distanceM: null,
        isWarmup: false,
        isDropSet: false,
        notes: null,
        gymEquipmentId: null,
      }),
    );
  });

  it('submits the selected gym equipment and carries it to the next set', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const firstSet = {
      localId: 'local-equipment-1',
      sessionId: 'session-1',
      exerciseId: 'exercise-1',
      gymEquipmentId: 'machine-1',
      setNumber: 1,
      weight: 80,
      reps: 8,
      rir: 2,
      notes: null,
      isWarmup: false,
      isDropSet: false,
      status: 'synced',
      serverId: 'server-equipment-1',
      syncedAt: 1,
      attempts: 0,
      lastError: null,
      createdAt: 1,
    } as PendingSet;

    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[firstSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        gymId="gym-1"
        equipmentOptions={[
          {
            id: 'machine-1',
            name: 'Hack Squat',
            equipmentType: 'MACHINE',
            weightOptions: [20, 40, 60],
            exerciseLinks: [{ exerciseId: 'exercise-1' }],
          },
          {
            id: 'machine-2',
            name: 'Pendulum Squat',
            equipmentType: 'MACHINE',
            weightOptions: [25, 50, 75],
            exerciseLinks: [{ exerciseId: 'exercise-1' }],
          },
        ]}
        onSubmit={onSubmit}
        onDeleteSet={vi.fn()}
        onUpdateSet={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('combobox', { name: /equipment/i })).toHaveTextContent('Hack Squat');
    await user.click(screen.getByRole('combobox', { name: /equipment/i }));
    await user.click(screen.getByRole('option', { name: 'Pendulum Squat' }));
    expect(screen.getByRole('button', { name: 'Edit equipment weights' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /set 2 weight/i }));
    expect(screen.getByRole('button', { name: '25 kg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '50 kg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '75 kg' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '40 kg' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '50 kg' }));
    fireEvent.click(applyValueButton());
    fireEvent.click(screen.getByRole('button', { name: /confirm set 2/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ gymEquipmentId: 'machine-2', weight: 50 }),
      ),
    );
  });

  it('keeps a logged set on its own equipment when another item is selected for the next set', async () => {
    const user = userEvent.setup();
    const onUpdateSet = vi.fn().mockResolvedValue(undefined);
    const loggedSet = {
      localId: 'local-own-equipment',
      sessionId: 'session-1',
      exerciseId: 'exercise-1',
      gymEquipmentId: 'machine-1',
      setNumber: 1,
      weight: 40,
      reps: 8,
      rir: 2,
      notes: null,
      isWarmup: false,
      isDropSet: false,
      status: 'synced',
      serverId: 'server-own-equipment',
      syncedAt: 1,
      attempts: 0,
      lastError: null,
      createdAt: 1,
    } as PendingSet;

    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[loggedSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        gymId="gym-1"
        equipmentOptions={[
          {
            id: 'machine-1',
            name: 'Hack Squat',
            equipmentType: 'MACHINE',
            weightOptions: [20, 40, 60],
            exerciseLinks: [{ exerciseId: 'exercise-1' }],
          },
          {
            id: 'machine-2',
            name: 'Pendulum Squat',
            equipmentType: 'MACHINE',
            weightOptions: [25, 50, 75],
            exerciseLinks: [{ exerciseId: 'exercise-1' }],
          },
        ]}
        onSubmit={vi.fn()}
        onDeleteSet={vi.fn()}
        onUpdateSet={onUpdateSet}
      />,
    );

    // The next set moves to the other machine; set 1 stays a Hack Squat set.
    await user.click(screen.getByRole('combobox', { name: /equipment/i }));
    await user.click(screen.getByRole('option', { name: 'Pendulum Squat' }));

    // An RIR-only edit must not touch the stored weight: 40 is not a Pendulum
    // Squat load, and snapping to that machine would silently save 50.
    await user.click(screen.getAllByRole('combobox', { name: /set 1 reps in reserve/i })[0]!);
    await user.click(screen.getByRole('option', { name: '1' }));
    await waitFor(() =>
      expect(onUpdateSet).toHaveBeenCalledWith(loggedSet, { weight: 40, reps: 8, rir: 1 }),
    );
    expect(onUpdateSet.mock.calls[0]![0].gymEquipmentId).toBe('machine-1');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /set 1 weight/i })).not.toBeDisabled(),
    );

    // A weight edit offers and snaps to the loads of the set's own machine.
    fireEvent.click(screen.getByRole('button', { name: /set 1 weight/i }));
    expect(screen.getByRole('button', { name: '20 kg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '60 kg' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '25 kg' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '55' } });
    fireEvent.click(applyValueButton());
    await waitFor(() =>
      expect(onUpdateSet).toHaveBeenLastCalledWith(loggedSet, { weight: 60, reps: 8, rir: 2 }),
    );
  });

  it('follows the selected machine in the picker for a barbell exercise, without a plate preview', async () => {
    const user = userEvent.setup();
    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[]}
        lastPerformance={{
          sessionStartedAt: '2026-07-01T10:00:00.000Z',
          sets: [{ weight: 60, reps: 8, rir: 2 }],
          maxWeight: 60,
          repsAtMaxWeight: 8,
          cardio: null,
        }}
        readiness={null}
        deloadActive={false}
        unit="KG"
        gymId="gym-1"
        loadConstraints={{
          equipmentType: 'BARBELL',
          barWeights: [20],
          plateWeights: [20, 10, 5, 2.5, 1.25],
        }}
        equipmentOptions={[
          {
            id: 'machine-2',
            name: 'Pendulum Squat',
            equipmentType: 'MACHINE',
            weightOptions: [25, 50, 75],
            exerciseLinks: [{ exerciseId: 'exercise-1' }],
          },
        ]}
        onSubmit={vi.fn()}
        onDeleteSet={vi.fn()}
        onUpdateSet={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    // On the bar: the barbell loading preview is shown.
    fireEvent.click(screen.getByRole('button', { name: /set 1 weight/i }));
    expect(screen.getByTestId('barbell-side-diagram')).toBeInTheDocument();
    fireEvent.click(applyValueButton());

    // On the machine: its loads are offered and there are no plates to show.
    await user.click(screen.getByRole('combobox', { name: /equipment/i }));
    await user.click(screen.getByRole('option', { name: 'Pendulum Squat' }));
    fireEvent.click(screen.getByRole('button', { name: /set 1 weight/i }));
    expect(screen.getByRole('button', { name: '25 kg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '75 kg' })).toBeInTheDocument();
    expect(screen.queryByTestId('barbell-side-diagram')).not.toBeInTheDocument();
  });
  it('keeps canonical kg values when selecting a displayed lb option', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[]}
        lastPerformance={{
          sessionStartedAt: '2026-07-01T10:00:00.000Z',
          sets: [{ weight: 100, reps: 10, rir: 2 }],
          maxWeight: 100,
          repsAtMaxWeight: 10,
          cardio: null,
        }}
        readiness={null}
        deloadActive={false}
        unit="LB"
        onSubmit={onSubmit}
        onDeleteSet={vi.fn()}
        onUpdateSet={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    // The draft is prefilled with 100 kg (220.46 lb); pick a different option so
    // the assertion can only pass when the tap and Apply really went through.
    fireEvent.click(screen.getByRole('button', { name: /weight/i }));
    expect(screen.getByRole('button', { name: /220\.46 lb/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /225\.97 lb/i }));
    fireEvent.click(applyValueButton());
    expect(screen.getByRole('button', { name: /set 1 weight/i })).toHaveTextContent('225.97');
    fireEvent.click(screen.getByRole('button', { name: /confirm set 1/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ weight: 102.5, reps: 10, rir: 2 }),
      ),
    );
  });

  it.each([
    { label: 'above the option range', weight: 220 },
    { label: 'off the option grid', weight: 73 },
  ])(
    'opens a logged set $label on its exact weight and keeps it on a plain Apply',
    async ({ weight }) => {
      const loggedSet = {
        localId: 'local-exact',
        sessionId: 'session-1',
        exerciseId: 'exercise-1',
        setNumber: 1,
        weight,
        reps: 5,
        rir: 1,
        status: 'synced',
        serverId: 'server-exact',
        createdAt: 1,
      } as never;
      const onUpdateSet = vi.fn().mockResolvedValue(undefined);
      render(
        <EditableSetsTable
          programExercise={programExercise}
          sets={[loggedSet]}
          lastPerformance={undefined}
          readiness={null}
          deloadActive={false}
          unit="KG"
          onSubmit={vi.fn()}
          onDeleteSet={vi.fn()}
          onUpdateSet={onUpdateSet}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /set 1 weight/i }));
      expect(screen.getByRole('spinbutton')).toHaveValue(weight);
      fireEvent.click(applyValueButton());

      await waitFor(() =>
        expect(onUpdateSet).toHaveBeenCalledWith(loggedSet, { weight, reps: 5, rir: 1 }),
      );
    },
  );

  it('parks an unconfirmed draft per exercise and restores it when the lifter comes back', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const otherExercise = {
      ...(programExercise as Record<string, unknown>),
      id: 'pe-2',
      exerciseId: 'exercise-2',
      exercise: { id: 'exercise-2', name: 'Bench', category: 'COMPOUND' },
    } as never;
    const props = {
      sets: [],
      lastPerformance: undefined,
      readiness: null,
      deloadActive: false,
      unit: 'KG' as const,
      onSubmit,
      onDeleteSet: vi.fn(),
      onUpdateSet: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(<EditableSetsTable programExercise={programExercise} {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /weight/i }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } });
    fireEvent.click(applyValueButton());

    // Jump to another exercise via the strip, then come back.
    view.rerender(<EditableSetsTable programExercise={otherExercise} {...props} />);
    view.rerender(<EditableSetsTable programExercise={programExercise} {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /confirm set 1/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ weight: 100 })),
    );
  });

  it('re-seeds the draft when the same program row is replaced by another exercise', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const perf = (weight: number) => ({
      sessionStartedAt: '2026-06-01T12:00:00.000Z',
      sets: [{ weight, reps: 8, rir: 2 }],
      maxWeight: weight,
      repsAtMaxWeight: 8,
      cardio: null,
    });
    // An in-session replace keeps the row id and swaps the exercise.
    const replaced = {
      ...(programExercise as Record<string, unknown>),
      exerciseId: 'exercise-2',
      exercise: { id: 'exercise-2', name: 'Incline Dumbbell Press', category: 'COMPOUND' },
    } as never;
    const props = {
      sets: [],
      readiness: null,
      deloadActive: false,
      unit: 'KG' as const,
      onSubmit,
      onDeleteSet: vi.fn(),
      onUpdateSet: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(
      <EditableSetsTable
        programExercise={programExercise}
        lastPerformance={perf(100)}
        {...props}
      />,
    );
    view.rerender(
      <EditableSetsTable programExercise={replaced} lastPerformance={perf(30)} {...props} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /confirm set 1/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ weight: 30, reps: 8 })),
    );
  });

  it('drops a parked draft once a set was logged on that exercise in between', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const otherExercise = {
      ...(programExercise as Record<string, unknown>),
      id: 'pe-2',
      exerciseId: 'exercise-2',
      exercise: { id: 'exercise-2', name: 'Bench', category: 'COMPOUND' },
    } as never;
    const props = {
      lastPerformance: undefined,
      readiness: null,
      deloadActive: false,
      unit: 'KG' as const,
      onSubmit,
      onDeleteSet: vi.fn(),
      onUpdateSet: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(
      <EditableSetsTable programExercise={programExercise} sets={[]} {...props} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /weight/i }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } });
    fireEvent.click(applyValueButton());

    view.rerender(<EditableSetsTable programExercise={otherExercise} sets={[]} {...props} />);
    const logged = [
      {
        localId: 'local-1',
        exerciseId: 'exercise-1',
        setNumber: 1,
        weight: 60,
        reps: 8,
        rir: 2,
        isWarmup: false,
        status: 'synced',
      },
    ] as unknown as PendingSet[];
    view.rerender(<EditableSetsTable programExercise={programExercise} sets={logged} {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /confirm set 2/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).not.toMatchObject({ weight: 100 });
  });

  it('keeps the table horizontally scrollable at narrow widths with touch-sized active controls', () => {
    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onDeleteSet={vi.fn()}
        onUpdateSet={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByTestId('editable-sets-scroll')).toHaveClass(
      'overflow-x-auto',
      'overscroll-x-contain',
    );
    expect(screen.getByTestId('editable-sets-grid')).toHaveClass('min-w-[31rem]');
    expect(screen.getByRole('button', { name: /set 1 weight/i })).toHaveClass('h-11');
    expect(screen.getByRole('button', { name: /set 1 repetitions/i })).toHaveClass('h-11');
    expect(screen.getByRole('button', { name: /confirm set 1/i })).toHaveClass('size-11');
  });

  it('uses persisted set numbers and exposes undo only for the latest completed set', () => {
    const onDeleteSet = vi.fn().mockResolvedValue(true);
    const completedSet = {
      localId: 'local-1',
      sessionId: 'session-1',
      exerciseId: 'exercise-1',
      setNumber: 3,
      weight: 80,
      reps: 8,
      rir: 2,
      durationSec: null,
      distanceM: null,
      notes: null,
      isWarmup: false,
      isDropSet: false,
      status: 'synced',
      createdAt: 1,
    } as never;
    const latestSet = {
      ...(completedSet as PendingSet),
      localId: 'local-2',
      setNumber: 4,
      weight: 82.5,
      createdAt: 2,
    } as PendingSet;

    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[completedSet, latestSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onDeleteSet={onDeleteSet}
        onUpdateSet={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('button', { name: /delete set 3/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /undo set 3/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /undo set 4/i }));
    expect(onDeleteSet).toHaveBeenCalledWith(latestSet);
  });

  it('keeps live strength PR badges when the inline table replaces SetsList', () => {
    const completedSet = {
      localId: 'local-pr-1',
      sessionId: 'session-1',
      exerciseId: 'exercise-1',
      setNumber: 1,
      weight: 80,
      reps: 8,
      rir: 2,
      durationSec: null,
      distanceM: null,
      notes: null,
      isWarmup: false,
      isDropSet: false,
      status: 'synced',
      createdAt: 1,
    } as PendingSet;

    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[completedSet]}
        priorSets={[{ weight: 70, reps: 8 }]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onDeleteSet={vi.fn()}
        onUpdateSet={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('Weight PR')).toBeInTheDocument();
    expect(screen.getByText('e1RM PR')).toBeInTheDocument();
  });

  it('prefills active and upcoming rows from matching previous-session sets', () => {
    render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[]}
        lastPerformance={{
          sessionStartedAt: '2026-07-01T10:00:00.000Z',
          sets: [
            { weight: 27.25, reps: 12, rir: 2 },
            { weight: 27.25, reps: 10, rir: 1 },
            { weight: 25, reps: 9, rir: 0 },
          ],
          maxWeight: 27.25,
          repsAtMaxWeight: 12,
          cardio: null,
        }}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onDeleteSet={vi.fn()}
        onUpdateSet={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('button', { name: /weight/i })).toHaveTextContent('27.25');
    expect(screen.getByRole('button', { name: /repetitions/i })).toHaveTextContent('12');
    expect(screen.getAllByText('25').length).toBeGreaterThan(0);
  });

  it('applies the next-set recommendation on demand and restores it after manual changes', async () => {
    const completedSet: PendingSet = {
      localId: 'local-recommendation-1',
      sessionId: 'session-1',
      exerciseId: 'exercise-1',
      setNumber: 1,
      weight: 80,
      reps: 8,
      rir: 2,
      notes: null,
      isWarmup: false,
      isDropSet: false,
      status: 'synced',
      serverId: 'server-recommendation-1',
      syncedAt: 1,
      attempts: 0,
      lastError: null,
      createdAt: 1,
    };
    const recommendation: IntraSetRecommendation = {
      mode: 'PRESERVE_RIR',
      weight: 75,
      reps: 10,
      rir: 1,
      reason: 'reduce-load',
      predictedRepsAtSameLoad: 7,
      fatigueLoss: 1,
      confidence: 'medium',
    };

    const view = render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[completedSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        recommendation={recommendation}
        onSubmit={vi.fn()}
        onDeleteSet={vi.fn()}
        onUpdateSet={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const applyRecommendation = screen.getByRole('button', {
      name: /apply recommendation to set 2/i,
    });
    expect(screen.getByTestId('set-recommendation-dot')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set 2 weight/i })).toHaveTextContent('80');

    fireEvent.click(applyRecommendation);
    expect(screen.getByRole('button', { name: /set 2 weight/i })).toHaveTextContent('75');
    expect(screen.getByRole('button', { name: /set 2 repetitions/i })).toHaveTextContent('10');
    expect(screen.getByRole('combobox', { name: /set 2 reps in reserve/i })).toHaveTextContent('1');
    expect(screen.queryByTestId('set-recommendation-dot')).not.toBeInTheDocument();
    expect(applyRecommendation).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /set 2 weight/i }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '77.5' } });
    fireEvent.click(applyValueButton());
    expect(screen.getByTestId('set-recommendation-dot')).toBeInTheDocument();
    expect(applyRecommendation).toBeEnabled();

    const completedSet2 = {
      ...completedSet,
      localId: 'local-recommendation-2',
      setNumber: 2,
      weight: 77.5,
      reps: 9,
      rir: 1,
      createdAt: 2,
    } as never;
    view.rerender(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[completedSet, completedSet2]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        recommendation={{ ...recommendation, weight: 72.5, reps: 9, rir: 2 }}
        onSubmit={vi.fn()}
        onDeleteSet={vi.fn()}
        onUpdateSet={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /apply recommendation to set 3/i })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: /set 3 weight/i })).toHaveTextContent('77.5');
    expect(screen.getByTestId('set-recommendation-dot')).toBeInTheDocument();
  });

  it('autosaves edits to a completed set and keeps the row stable on failure', async () => {
    const user = userEvent.setup();
    const completedSet = {
      localId: 'local-edit',
      sessionId: 'session-1',
      exerciseId: 'exercise-1',
      setNumber: 2,
      weight: 80,
      reps: 8,
      rir: 2,
      status: 'synced',
      serverId: 'server-1',
      createdAt: 1,
    } as never;
    const onUpdateSet = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[completedSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onDeleteSet={vi.fn()}
        onUpdateSet={onUpdateSet}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /set 2 weight/i })[0]!);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '85' } });
    fireEvent.click(applyValueButton());
    await waitFor(() =>
      expect(onUpdateSet).toHaveBeenCalledWith(completedSet, { weight: 85, reps: 8, rir: 2 }),
    );

    const failedUpdate = vi.fn().mockRejectedValue(new Error('save failed'));
    rerender(
      <EditableSetsTable
        programExercise={programExercise}
        sets={[completedSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={vi.fn()}
        onDeleteSet={vi.fn()}
        onUpdateSet={failedUpdate}
      />,
    );
    await user.click(screen.getAllByRole('combobox', { name: /set 2 reps in reserve/i })[0]!);
    await user.click(screen.getByRole('option', { name: '1' }));
    await waitFor(() => expect(failedUpdate).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getAllByRole('combobox', { name: /set 2 reps in reserve/i })[0],
      ).toHaveTextContent('2'),
    );
  });
});
