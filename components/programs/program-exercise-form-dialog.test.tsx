import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProgramExerciseFormDialog } from './program-exercise-form-dialog';
import { EffortScaleProvider } from '@/components/shared/effort-scale-provider';
import { DistanceUnitProvider } from '@/components/shared/distance-unit-provider';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.unstubAllGlobals();
});

type DialogProps = Parameters<typeof ProgramExerciseFormDialog>[0];
type EditProps = Extract<DialogProps, { mode: 'edit' }>;

const programExercise = {
  id: 'pe1',
  workoutId: 'w1',
  exerciseId: 'ex1',
  order: 0,
  targetSets: 4,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetRIR: 3,
  restSec: 90,
  tempo: null,
  notes: null,
  supersetGroup: null,
  autoregulationMode: 'PRESERVE_RIR',
  // Explicit overrides, so the saved body carries two known values. The
  // untouched "Auto" case (null overrides) has its own test below.
  fatigueRate: 0.75,
  loadAdjustmentPct: 2.5,
  exercise: { id: 'ex1', name: 'Bench Press', muscleGroup: 'CHEST', defaultRestSec: 120 },
} as unknown as EditProps['programExercise'];

function renderDialog(scale: 'RIR' | 'RPE') {
  const fetchMock = vi.fn(async () => Response.json({}));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <EffortScaleProvider scale={scale}>
      <ProgramExerciseFormDialog
        open
        onOpenChange={vi.fn()}
        mode="edit"
        programExercise={programExercise}
        catalog={[programExercise.exercise]}
      />
    </EffortScaleProvider>,
  );
  return fetchMock;
}

async function savedRir(fetchMock: ReturnType<typeof vi.fn>): Promise<unknown> {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('/api/program-exercises/pe1');
  return (JSON.parse(String(init.body)) as { targetRIR: unknown }).targetRIR;
}

describe('ProgramExerciseFormDialog effort target', () => {
  it('shows the target as RPE and saves the RIR behind the RPE typed', async () => {
    const fetchMock = renderDialog('RPE');
    const field = screen.getByLabelText('RPE') as HTMLInputElement;
    expect(field.value).toBe('7');
    fireEvent.change(field, { target: { value: '8' } });
    expect(await savedRir(fetchMock)).toBe(2);
  });

  it('saves an untouched target with its stored RIR on the RPE scale', async () => {
    const fetchMock = renderDialog('RPE');
    expect(await savedRir(fetchMock)).toBe(3);
  });

  it('keeps the RIR field and value as they were on the RIR scale', async () => {
    const fetchMock = renderDialog('RIR');
    const field = screen.getByLabelText('RIR') as HTMLInputElement;
    expect(field.value).toBe('3');
    fireEvent.change(field, { target: { value: '1' } });
    expect(await savedRir(fetchMock)).toBe(1);
  });

  it.each([
    ['RIR', '7', 'Enter a whole number from 0 to 5.'],
    ['RPE', '4', 'Enter a whole number from 5 to 10.'],
    ['RPE', '11', 'Enter a whole number from 5 to 10.'],
    // An empty target used to be coerced to RIR 0, a maximal effort.
    ['RIR', '', 'Enter a whole number from 0 to 5.'],
    ['RPE', '', 'Enter a whole number from 5 to 10.'],
  ] as const)('refuses %s "%s" with a message and saves nothing', async (scale, typed, message) => {
    const fetchMock = renderDialog(scale);
    const field = screen.getByLabelText(scale);
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: typed } });
    // Submitted while the field still has the focus (Enter before blur).
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves again once the refused target is corrected', async () => {
    const fetchMock = renderDialog('RPE');
    const field = screen.getByLabelText('RPE');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Enter a whole number from 5 to 10.');
    fireEvent.change(field, { target: { value: '8' } });
    await waitFor(() =>
      expect(screen.queryByText('Enter a whole number from 5 to 10.')).not.toBeInTheDocument(),
    );
    expect(await savedRir(fetchMock)).toBe(2);
  });
});

// Cardio target (issue #558, slice 1): a cardio exercise is prescribed by a
// duration (required, minutes) and an optional distance (km); the strength
// fields are hidden for it.
describe('ProgramExerciseFormDialog cardio target', () => {
  type CreateProps = Extract<DialogProps, { mode: 'create' }>;

  const running = {
    id: 'run',
    name: 'Running',
    muscleGroup: 'OTHER',
    category: 'CARDIO',
    defaultRestSec: 120,
  } as unknown as EditProps['catalog'][number];

  const cardioRow = {
    ...programExercise,
    id: 'pe2',
    exerciseId: 'run',
    targetSets: 1,
    targetRepsMin: 1,
    targetRepsMax: 1,
    targetRIR: 1,
    restSec: 120,
    targetDurationSec: null,
    targetDistanceM: null,
    exercise: running,
  } as unknown as EditProps['programExercise'];

  function renderEdit(row: EditProps['programExercise']) {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <EffortScaleProvider scale="RIR">
        <ProgramExerciseFormDialog
          open
          onOpenChange={vi.fn()}
          mode="edit"
          programExercise={row}
          catalog={[row.exercise]}
        />
      </EffortScaleProvider>,
    );
    return fetchMock;
  }

  async function savedBody(fetchMock: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  it('shows duration and distance and hides sets, reps, RIR, rest and tempo', () => {
    renderEdit(cardioRow);
    expect(screen.getByLabelText('Duration (min)')).toBeInTheDocument();
    expect(screen.getByLabelText('Distance (km, optional)')).toBeInTheDocument();
    for (const label of ['Sets', 'RIR', 'Reps min', 'Reps max', 'Rest (s)', 'Tempo (optional)']) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
  });

  it('keeps the strength fields, and no cardio field, on a strength exercise', () => {
    renderEdit(programExercise);
    expect(screen.getByLabelText('Sets')).toBeInTheDocument();
    expect(screen.getByLabelText('Rest (s)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Duration (min)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Distance (km, optional)')).not.toBeInTheDocument();
  });

  it('saves the minutes and kilometers typed as seconds and meters', async () => {
    const fetchMock = renderEdit(cardioRow);
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Distance (km, optional)'), {
      target: { value: '5' },
    });
    const body = await savedBody(fetchMock);
    expect(body).toMatchObject({
      exerciseId: 'run',
      targetDurationSec: 1200,
      targetDistanceM: 5000,
      // The hidden strength columns keep the values the row already had.
      targetSets: 1,
      targetRepsMin: 1,
      targetRepsMax: 1,
      targetRIR: 1,
      restSec: 120,
    });
  });

  it('saves a duration-only target with a null distance', async () => {
    const fetchMock = renderEdit(cardioRow);
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '20' } });
    const body = await savedBody(fetchMock);
    expect(body.targetDurationSec).toBe(1200);
    expect(body.targetDistanceM).toBeNull();
  });

  it('shows the stored target when editing', () => {
    renderEdit({
      ...cardioRow,
      targetDurationSec: 1800,
      targetDistanceM: 2500,
    } as unknown as EditProps['programExercise']);
    expect((screen.getByLabelText('Duration (min)') as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText('Distance (km, optional)') as HTMLInputElement).value).toBe(
      '2.5',
    );
  });

  it('requires a duration once a target exists and saves nothing without one', async () => {
    const fetchMock = renderEdit({
      ...cardioRow,
      targetDurationSec: 1800,
    } as unknown as EditProps['programExercise']);
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a duration in minutes, up to 1440.')).toBeInTheDocument();
    expect(screen.getByLabelText('Duration (min)')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A cardio row saved before targets existed has none. It stays editable
  // with both fields empty, and the save sends no target (review of #568).
  it('saves a cardio row that never had a target without asking for one', async () => {
    const fetchMock = renderEdit(cardioRow);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect('targetDurationSec' in body).toBe(false);
    expect('targetDistanceM' in body).toBe(false);
    expect(screen.queryByText('Enter a duration in minutes, up to 1440.')).not.toBeInTheDocument();
  });

  it('still asks for a duration when only a distance is typed on such a row', async () => {
    const fetchMock = renderEdit(cardioRow);
    fireEvent.change(screen.getByLabelText('Distance (km, optional)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a duration in minutes, up to 1440.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['0', '1441'])('refuses a duration of %s minutes', async (typed) => {
    const fetchMock = renderEdit(cardioRow);
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: typed } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a duration in minutes, up to 1440.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a distance over 1000 km', async () => {
    const fetchMock = renderEdit(cardioRow);
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Distance (km, optional)'), {
      target: { value: '1001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Enter a distance up to 1000 km, or leave it empty.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Distance unit setting (issue #582).
  function renderEditInMiles(row: EditProps['programExercise']) {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <EffortScaleProvider scale="RIR">
        <DistanceUnitProvider unit="mi">
          <ProgramExerciseFormDialog
            open
            onOpenChange={vi.fn()}
            mode="edit"
            programExercise={row}
            catalog={[row.exercise]}
          />
        </DistanceUnitProvider>
      </EffortScaleProvider>,
    );
    return fetchMock;
  }

  it('types the distance in miles for a miles user and saves meters', async () => {
    const fetchMock = renderEditInMiles(cardioRow);
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Distance (mi, optional)'), {
      target: { value: '3' },
    });
    const body = await savedBody(fetchMock);
    expect(body).toMatchObject({ targetDurationSec: 1800, targetDistanceM: 4828 });
  });

  it('re-saves a kilometer target shown in miles without drift', async () => {
    const fetchMock = renderEditInMiles({
      ...cardioRow,
      targetDurationSec: 1800,
      targetDistanceM: 5000,
    } as unknown as EditProps['programExercise']);
    // 5000 m reads 3.11 mi, which converts back to 5005 m: the untouched
    // field must keep the stored 5000 m.
    expect((screen.getByLabelText('Distance (mi, optional)') as HTMLInputElement).value).toBe(
      '3.11',
    );
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '35' } });
    const body = await savedBody(fetchMock);
    expect(body).toMatchObject({ targetDurationSec: 2100, targetDistanceM: 5000 });
  });

  it('refuses a distance over the bound, quoted in miles', async () => {
    const fetchMock = renderEditInMiles(cardioRow);
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Distance (mi, optional)'), {
      target: { value: '622' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Enter a distance up to 621 mi, or leave it empty.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends no cardio target for a strength exercise', async () => {
    const fetchMock = renderEdit(programExercise);
    const body = await savedBody(fetchMock);
    expect(body).not.toHaveProperty('targetDurationSec');
    expect(body).not.toHaveProperty('targetDistanceM');
  });

  // Radix renders a native select next to its trigger inside a form; changing
  // it is how a test picks an exercise without a pointer.
  function choose(exerciseId: string) {
    const select = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: exerciseId } });
  }

  function renderCreate(catalog: CreateProps['catalog']) {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <EffortScaleProvider scale="RIR">
        <ProgramExerciseFormDialog
          open
          onOpenChange={vi.fn()}
          mode="create"
          workoutId="w1"
          catalog={catalog}
        />
      </EffortScaleProvider>,
    );
    return fetchMock;
  }

  async function addedBody(fetchMock: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/workouts/w1/program-exercises');
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  it('adds a cardio exercise with its target and one set of placeholders', async () => {
    const fetchMock = renderCreate([running]);
    choose('run');
    fireEvent.change(await screen.findByLabelText('Duration (min)'), { target: { value: '20' } });
    expect(await addedBody(fetchMock)).toMatchObject({
      exerciseId: 'run',
      targetDurationSec: 1200,
      targetDistanceM: null,
      // One continuous effort is one set (lib/freestyle); rest is the exercise's.
      targetSets: 1,
      targetRepsMin: 1,
      targetRepsMax: 1,
      restSec: 120,
      // The hidden autoregulation overrides stay "Auto".
      fatigueRate: null,
      loadAdjustmentPct: null,
    });
  });

  it('requires the duration when adding a cardio exercise', async () => {
    const fetchMock = renderCreate([running]);
    choose('run');
    await screen.findByLabelText('Duration (min)');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Enter a duration in minutes, up to 1440.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds a strength exercise with untouched "Auto" overrides', async () => {
    // The two optional overrides default to null; they used to reach the
    // schema as 0, so the form refused to save without showing why.
    const fetchMock = renderCreate([programExercise.exercise]);
    choose('ex1');
    const body = await addedBody(fetchMock);
    expect(body).toMatchObject({
      exerciseId: 'ex1',
      targetSets: 4,
      fatigueRate: null,
      loadAdjustmentPct: null,
    });
    expect(body).not.toHaveProperty('targetDurationSec');
  });

  it('puts the strength defaults back when a cardio choice is changed to a strength one', async () => {
    const fetchMock = renderCreate([running, programExercise.exercise]);
    choose('run');
    await screen.findByLabelText('Duration (min)');
    choose('ex1');
    expect(((await screen.findByLabelText('Sets')) as HTMLInputElement).value).toBe('4');
    expect(await addedBody(fetchMock)).toMatchObject({
      exerciseId: 'ex1',
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetRIR: 2,
    });
  });

  it('starts empty in create mode until an exercise is chosen', () => {
    const props: CreateProps = {
      open: true,
      onOpenChange: vi.fn(),
      mode: 'create',
      workoutId: 'w1',
      catalog: [running],
    };
    render(
      <EffortScaleProvider scale="RIR">
        <ProgramExerciseFormDialog {...props} />
      </EffortScaleProvider>,
    );
    // No exercise selected yet: the strength fields of a new row are shown.
    expect(screen.getByLabelText('Sets')).toBeInTheDocument();
    expect(screen.queryByLabelText('Duration (min)')).not.toBeInTheDocument();
  });
});
