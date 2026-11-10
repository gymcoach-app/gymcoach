import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { SetInput } from './set-input';
import { EffortScaleProvider } from '@/components/shared/effort-scale-provider';

const exo: Exercise = {
  id: 'e1',
  userId: 'u',
  name: 'Squat',
  muscleGroup: 'QUADS',
  category: 'COMPOUND',
  defaultRestSec: 120,
  notes: null,
  usesBodyweight: false,
  equipmentType: 'BARBELL',
  isFavorite: false,
  createdAt: new Date(),
};

const pe: ProgramExercise & { exercise: Exercise } = {
  id: 'pe',
  workoutId: 'w',
  exerciseId: 'e1',
  order: 1,
  targetSets: 3,
  targetRepsMin: 6,
  targetRepsMax: 10,
  targetRIR: 2,
  restSec: 120,
  tempo: null,
  notes: null,
  supersetGroup: null,
  autoregulationMode: 'PRESERVE_RIR',
  fatigueRate: null,
  loadAdjustmentPct: null,
  exercise: exo,
};

function renderSetInput(unit: 'KG' | 'LB' = 'KG') {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <SetInput
      programExercise={pe}
      existingSets={[]}
      lastPerformance={undefined}
      readiness={null}
      deloadActive={false}
      unit={unit}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

describe('SetInput first working set', () => {
  const lastPerformance = {
    sessionStartedAt: '2026-06-01T12:00:00.000Z',
    sets: [{ weight: 100, reps: 8, rir: 2 }],
    maxWeight: 100,
    repsAtMaxWeight: 8,
    cardio: null,
  };

  it('keeps the existing upstream first-set progression when no return calibration is active', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SetInput
        programExercise={pe}
        existingSets={[]}
        lastPerformance={lastPerformance}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ weight: 100, reps: 8, rir: 2, isDropSet: false }),
    );
  });

  it('uses the conservative return start and RIR instead of ordinary progression after a long break', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const returnPe = { ...pe, targetSets: 2, targetRIR: 3 };
    render(
      <SetInput
        programExercise={returnPe}
        existingSets={[]}
        lastPerformance={lastPerformance}
        readiness={null}
        deloadActive={false}
        unit="KG"
        returnRecommendation={{
          mode: 'exercise-reintro',
          exerciseGapDays: 60,
          returnGapDays: 60,
          muscleGapDays: 5,
          muscleMaintained: true,
          recentMuscleSets: 12,
          baselineMuscleSetsPer28Days: 12,
          recentVolumeRatio: 1,
          targetSets: 2,
          targetRIR: 3,
          weightCeiling: 90,
          suggestedWeight: 80,
          startFraction: 0.85,
          calibrationRequired: true,
          historySessionCount: 3,
          recentHistorySessionCount: 0,
          longTermHistorySessionCount: 3,
          historyBasis: 'long-term-exact',
          confidence: 'medium',
        }}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ weight: 80, reps: 6, rir: 3, isDropSet: false }),
    );
    expect(screen.getByRole('switch', { name: /drop set/i })).toBeDisabled();
  });
});

describe('SetInput quick entry', () => {
  it('prefills the deterministic next-set recommendation after a completed set', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const previousSet = {
      localId: 'l1',
      sessionId: 's1',
      exerciseId: 'e1',
      setNumber: 1,
      weight: 100,
      reps: 12,
      rir: 2,
      notes: null,
      isWarmup: false,
      isDropSet: false,
      createdAt: Date.now() - 120_000,
      status: 'synced' as const,
      serverId: 'set1',
      syncedAt: Date.now(),
      attempts: 0,
      lastError: null,
    };

    render(
      <SetInput
        programExercise={pe}
        existingSets={[previousSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        recommendation={{
          mode: 'PRESERVE_RIR',
          weight: 100,
          reps: 11,
          rir: 2,
          reason: 'adjust-reps',
          predictedRepsAtSameLoad: 11,
          fatigueLoss: 1,
          confidence: 'medium',
        }}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText(/100 KG × 11 · RIR 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ weight: 100, reps: 11, rir: 2 }),
    );
  });

  it('fills weight, reps, and RIR from a valid shorthand', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText('Quick entry'), '100x8@9');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ weight: 100, reps: 8, rir: 1 }),
    );
  });

  it('keeps the RIR untouched when the shorthand has no RPE', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText('Quick entry'), '62.5x8');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      // targetRIR (2) comes from the default pre-fill and must survive.
      expect.objectContaining({ weight: 62.5, reps: 8, rir: 2 }),
    );
  });

  it('converts the shorthand weight from the display unit (lb) to kg', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSetInput('LB');

    await user.type(screen.getByLabelText('Quick entry'), '225x5');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    const submitted = onSubmit.mock.calls[0]?.[0] as { weight: number };
    // 225 lb = 102.06 kg.
    expect(submitted.weight).toBeCloseTo(102.06, 1);
  });

  it('shows an inline format hint on invalid non-empty input', async () => {
    const user = userEvent.setup();
    renderSetInput('KG');

    expect(screen.queryByText(/expected format/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Quick entry'), 'squat');
    expect(screen.getByText(/expected format/i)).toBeInTheDocument();
  });

  it('does not touch the form values on an invalid entry', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText('Quick entry'), 'nonsense');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    // Defaults still submit: mid rep range (8), target RIR (2), weight 0.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ weight: 0, reps: 8, rir: 2 }));
  });
});

// Cardio mode (issue #133): the logger swaps weight/reps for duration and
// optional distance and submits the normalized cardio payload.
const cardioExo: Exercise = {
  ...exo,
  id: 'e2',
  name: 'Running',
  muscleGroup: 'OTHER',
  category: 'CARDIO',
};

const cardioPE: ProgramExercise & { exercise: Exercise } = {
  ...pe,
  id: 'pe2',
  exerciseId: 'e2',
  targetSets: 1,
  exercise: cardioExo,
};

function renderCardioInput() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <SetInput
      programExercise={cardioPE}
      existingSets={[]}
      lastPerformance={undefined}
      readiness={null}
      deloadActive={false}
      unit="KG"
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

describe('SetInput cardio mode', () => {
  it('shows duration/distance inputs instead of load/reps', () => {
    renderCardioInput();
    expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/distance/i)).toBeInTheDocument();
    expect(screen.queryByText(/load \(/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Quick entry')).not.toBeInTheDocument();
    expect(screen.queryByText(/reps in reserve/i)).not.toBeInTheDocument();
  });

  it('submits duration in seconds and distance in meters with weight 0 / reps 1', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCardioInput();

    await user.type(screen.getByLabelText(/duration/i), '12:30');
    await user.type(screen.getByLabelText(/distance/i), '2.5');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        weight: 0,
        reps: 1,
        rir: null,
        durationSec: 750,
        distanceM: 2500,
        isWarmup: false,
        isDropSet: false,
      }),
    );
  });

  it('keeps the log button disabled until the duration is valid', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCardioInput();

    const button = screen.getByRole('button', { name: /log the set/i });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText(/duration/i), '12:30');
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ durationSec: 750, distanceM: null }),
    );
  });

  it('strength submissions carry null cardio fields (pinned)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText('Quick entry'), '100x8');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ weight: 100, reps: 8, durationSec: null, distanceM: null }),
    );
  });
});

// Opt-in AI free-text parse (issue #210): a deliberate action that fills the
// form from a validated parse, never auto-logs, and degrades gracefully when
// the (untrusted) model output cannot be used.
describe('SetInput AI parse', () => {
  function stubFetch(parsed: unknown, ok = true) {
    const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => ({ parsed }) });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('fills weight, reps and RIR from a strength parse, then logs on confirm', async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ kind: 'strength', weight: 100, reps: 8, rir: 2 });
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText(/describe the set/i), '100 for 8, 2 left');
    await user.click(screen.getByRole('button', { name: /parse with ai/i }));

    // The request targets the parse route with the exercise id and text.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sets/parse');
    expect(JSON.parse(init.body as string)).toEqual({
      exerciseId: 'e1',
      text: '100 for 8, 2 left',
    });

    // Nothing logged yet - the user must confirm.
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ weight: 100, reps: 8, rir: 2 }),
    );
  });

  it('converts the parsed display-unit weight to kg (lb user)', async () => {
    const user = userEvent.setup();
    stubFetch({ kind: 'strength', weight: 225, reps: 5 });
    const { onSubmit } = renderSetInput('LB');

    await user.type(screen.getByLabelText(/describe the set/i), '225 for 5');
    await user.click(screen.getByRole('button', { name: /parse with ai/i }));
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    const submitted = onSubmit.mock.calls[0]?.[0] as { weight: number };
    expect(submitted.weight).toBeCloseTo(102.06, 1); // 225 lb
  });

  it('fills nothing and shows a hint on a null parse (never logs garbage)', async () => {
    const user = userEvent.setup();
    stubFetch(null);
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText(/describe the set/i), 'how do I squat?');
    await user.click(screen.getByRole('button', { name: /parse with ai/i }));

    expect(screen.getByText(/could not parse that/i)).toBeInTheDocument();

    // The defaults survive untouched: nothing was filled from the bad parse.
    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ weight: 0, reps: 8, rir: 2 }));
  });

  it('submits the selected physical gym equipment', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SetInput
        programExercise={pe}
        existingSets={[]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        equipmentOptions={[{ id: 'machine-1', name: 'Hammer Strength Squat' }]}
        onSubmit={onSubmit}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox'), 'machine-1');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ gymEquipmentId: 'machine-1' }));
  });

  it('keeps the most recently used physical equipment selected for the next set', () => {
    const previousSet = {
      localId: 'l-equipment',
      sessionId: 's1',
      exerciseId: 'e1',
      gymEquipmentId: 'machine-1',
      setNumber: 1,
      weight: 100,
      reps: 8,
      rir: 2,
      notes: null,
      isWarmup: false,
      isDropSet: false,
      createdAt: Date.now(),
      status: 'synced' as const,
      serverId: 'set-equipment',
      syncedAt: Date.now(),
      attempts: 0,
      lastError: null,
    };

    render(
      <SetInput
        programExercise={pe}
        existingSets={[previousSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        equipmentOptions={[{ id: 'machine-1', name: 'Hammer Strength Squat' }]}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveValue('machine-1');
  });

  it('re-seeds the form when the same program row is replaced by another exercise', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const perf = (weight: number) => ({
      sessionStartedAt: '2026-06-01T12:00:00.000Z',
      sets: [{ weight, reps: 8, rir: 2 }],
      maxWeight: weight,
      repsAtMaxWeight: 8,
      cardio: null,
    });
    const props = {
      existingSets: [],
      readiness: null,
      deloadActive: false,
      unit: 'KG' as const,
      onSubmit,
    };
    const { rerender } = render(
      <SetInput {...props} programExercise={pe} lastPerformance={perf(100)} />,
    );
    // An in-session replace keeps the row id and swaps the exercise.
    rerender(
      <SetInput
        {...props}
        programExercise={{
          ...pe,
          exerciseId: 'e2',
          exercise: { ...exo, id: 'e2', name: 'Goblet Squat', equipmentType: 'DUMBBELL' },
        }}
        lastPerformance={perf(30)}
      />,
    );

    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ weight: 30, reps: 8 }));
  });

  it('clears a selected machine the gym no longer offers (issue #326)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const props = {
      programExercise: pe,
      existingSets: [],
      lastPerformance: undefined,
      readiness: null,
      deloadActive: false,
      unit: 'KG' as const,
      onSubmit,
    };
    const { rerender } = render(
      <SetInput
        {...props}
        equipmentOptions={[
          { id: 'machine-1', name: 'Hammer Strength Squat' },
          { id: 'machine-2', name: 'Plate-loaded Squat' },
        ]}
      />,
    );
    await user.selectOptions(screen.getByRole('combobox'), 'machine-1');
    expect(screen.getByRole('combobox')).toHaveValue('machine-1');

    // The runner withdraws the item once the server dropped it from a set.
    rerender(
      <SetInput {...props} equipmentOptions={[{ id: 'machine-2', name: 'Plate-loaded Squat' }]} />,
    );

    expect(screen.getByRole('combobox')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ gymEquipmentId: null }));
  });

  it('ignores a cardio parse on a strength exercise (wrong shape)', async () => {
    const user = userEvent.setup();
    stubFetch({ kind: 'cardio', durationSec: 1500 });
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText(/describe the set/i), 'ran 5k');
    await user.click(screen.getByRole('button', { name: /parse with ai/i }));

    expect(screen.getByText(/could not parse that/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ weight: 0, reps: 8 }));
  });
});

describe('SetInput effort scale (issue #390)', () => {
  function renderWithScale(scale: 'RIR' | 'RPE') {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EffortScaleProvider scale={scale}>
        <SetInput
          programExercise={pe}
          existingSets={[]}
          lastPerformance={undefined}
          readiness={null}
          deloadActive={false}
          unit="KG"
          onSubmit={onSubmit}
        />
      </EffortScaleProvider>,
    );
    return { onSubmit };
  }

  function chipLabels() {
    return Array.from(screen.getByTestId('effort-chips').querySelectorAll('button')).map(
      (chip) => chip.textContent,
    );
  }

  it('shows RIR chips with a plain-language label by default', () => {
    renderSetInput('KG');
    expect(screen.getByText('RIR (reps in reserve)')).toBeInTheDocument();
    expect(chipLabels()).toEqual(['0', '1', '2', '3']);
    // The pre-fill is the target RIR (2).
    expect(screen.getByTestId('effort-level-label')).toHaveTextContent('RIR 2: 2 reps left');
  });

  it('shows RPE chips, and RPE 8 is the pre-selected target RIR 2', () => {
    renderWithScale('RPE');
    expect(screen.getByText('RPE (perceived exertion)')).toBeInTheDocument();
    expect(screen.queryByText('RIR (reps in reserve)')).not.toBeInTheDocument();
    expect(chipLabels()).toEqual(['7', '8', '9', '10']);
    const chips = screen.getByTestId('effort-chips');
    expect(within(chips).getByRole('button', { name: '8' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('effort-level-label')).toHaveTextContent('RPE 8: 2 reps left');
  });

  it('stores the RIR behind the RPE chip the lifter picks', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderWithScale('RPE');
    const chips = screen.getByTestId('effort-chips');

    await user.click(within(chips).getByRole('button', { name: '9' }));
    expect(screen.getByTestId('effort-level-label')).toHaveTextContent('RPE 9: 1 rep left');
    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ rir: 1 }));

    await user.click(within(chips).getByRole('button', { name: '10' }));
    expect(screen.getByTestId('effort-level-label')).toHaveTextContent('RPE 10: No reps left');
    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ rir: 0 }));
  });
});
