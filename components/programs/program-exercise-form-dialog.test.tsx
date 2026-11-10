import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProgramExerciseFormDialog } from './program-exercise-form-dialog';
import { EffortScaleProvider } from '@/components/shared/effort-scale-provider';

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
  // Explicit overrides: jsdom reads the two empty optional number fields as
  // 0, which the schema refuses, so the fixture fills them.
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
