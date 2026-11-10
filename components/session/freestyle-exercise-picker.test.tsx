import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionCatalogExercise } from './session-exercise-menu';
import { FreestyleExercisePicker } from './freestyle-exercise-picker';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

vi.mock('@/components/shared/use-exercise-name', () => ({
  useExerciseName: () => (name: string) => name,
}));

const bench: SessionCatalogExercise = {
  id: 'bench',
  name: 'Bench Press',
  muscleGroup: 'CHEST',
  category: 'COMPOUND',
  usesBodyweight: false,
  defaultRestSec: 150,
  isFavorite: false,
};
const bike: SessionCatalogExercise = {
  ...bench,
  id: 'bike',
  name: 'Stationary Bike',
  muscleGroup: 'OTHER',
  category: 'CARDIO',
  defaultRestSec: 60,
  isFavorite: true,
};

function renderPicker(onAdded = vi.fn()) {
  render(<FreestyleExercisePicker sessionId="s1" catalog={[bench, bike]} onAdded={onAdded} />);
  return onAdded;
}

beforeEach(() => {
  vi.restoreAllMocks();
  toast.error.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 201 } as Response));
});

describe('FreestyleExercisePicker (issue #388)', () => {
  it('lists the catalog, favourites first, and filters by search', () => {
    renderPicker();
    expect(screen.getByText('Add your first exercise')).toBeInTheDocument();
    const names = screen.getAllByRole('button').map((button) => button.textContent);
    expect(names).toEqual(['Stationary Bike', 'Bench Press']);

    fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: 'bench' } });
    expect(screen.getByRole('button', { name: 'Bench Press' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stationary Bike/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matching exercises.')).toBeInTheDocument();
  });

  it('adds a strength exercise to the session with default targets', async () => {
    const onAdded = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Bench Press' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/sessions/s1/exercises');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      exerciseId: 'bench',
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      restSec: 150,
    });
  });

  it('adds a cardio exercise as one continuous set', async () => {
    const onAdded = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /Stationary Bike/ }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledOnce());
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string)).toMatchObject({
      exerciseId: 'bike',
      targetSets: 1,
      targetRepsMin: 1,
      targetRepsMax: 1,
      targetRIR: 0,
    });
  });

  it('sends one request when the same exercise is tapped twice', async () => {
    let release: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise<Response>((resolve) => (release = resolve))),
    );
    const onAdded = renderPicker();
    const choice = screen.getByRole('button', { name: 'Bench Press' });
    fireEvent.click(choice);
    fireEvent.click(choice);
    expect(fetch).toHaveBeenCalledOnce();
    release({ ok: true, status: 201 } as Response);
    await waitFor(() => expect(onAdded).toHaveBeenCalledOnce());
  });

  it('treats "already on the list" as added and refreshes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 } as Response));
    const onAdded = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Bench Press' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledOnce());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports a failure and does not refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    const onAdded = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Bench Press' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not add the exercise.'));
    expect(onAdded).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Bench Press' })).toBeEnabled();
  });
});
