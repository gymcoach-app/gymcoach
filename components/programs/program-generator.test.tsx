import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProgramGenerator } from './program-generator';
import { EffortScaleProvider } from '@/components/shared/effort-scale-provider';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const program = {
  name: 'Upper Lower',
  description: 'Four days',
  workouts: [
    {
      name: 'Upper A',
      exercises: [
        {
          name: 'Bench Press',
          muscleGroup: 'CHEST',
          targetSets: 3,
          targetRepsMin: 6,
          targetRepsMax: 10,
          targetRIR: 3,
          restSec: 120,
        },
      ],
    },
  ],
};

async function renderDraft(scale: 'RIR' | 'RPE') {
  const fetchMock = vi.fn(async (url: string) =>
    url === '/api/programs/generate' ? Response.json({ program }) : Response.json({ id: 'p1' }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <EffortScaleProvider scale={scale}>
      <ProgramGenerator />
    </EffortScaleProvider>,
  );
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Hypertrophy, four sessions a week' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await screen.findByText('Review and edit');
  return fetchMock;
}

async function savedRir(fetchMock: ReturnType<typeof vi.fn>): Promise<unknown> {
  fireEvent.click(screen.getByRole('button', { name: 'Create program' }));
  await waitFor(() =>
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/programs/build')).toBe(true),
  );
  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/programs/build')!;
  const body = JSON.parse(String((call[1] as RequestInit).body)) as typeof program;
  return body.workouts[0]!.exercises[0]!.targetRIR;
}

describe('ProgramGenerator effort target', () => {
  it('shows the draft target as RPE and saves the RIR behind the RPE typed', async () => {
    const fetchMock = await renderDraft('RPE');
    const field = screen.getByLabelText('RPE') as HTMLInputElement;
    expect(field.value).toBe('7');
    fireEvent.change(field, { target: { value: '8' } });
    expect(await savedRir(fetchMock)).toBe(2);
  });

  it('saves an untouched draft with its stored RIR on the RPE scale', async () => {
    const fetchMock = await renderDraft('RPE');
    expect(await savedRir(fetchMock)).toBe(3);
  });

  it('keeps the RIR field and value as they were on the RIR scale', async () => {
    const fetchMock = await renderDraft('RIR');
    const field = screen.getByLabelText('RIR') as HTMLInputElement;
    expect(field.value).toBe('3');
    fireEvent.change(field, { target: { value: '1' } });
    expect(await savedRir(fetchMock)).toBe(1);
  });
});
