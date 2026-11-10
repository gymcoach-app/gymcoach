import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { SessionExerciseMenu } from './session-exercise-menu';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

vi.mock('@/components/shared/use-exercise-name', () => ({
  useExerciseName: () => (name: string) => name,
}));

const bench = {
  id: 'bench',
  name: 'Bench Press',
  muscleGroup: 'CHEST',
  category: 'COMPOUND',
  equipmentType: 'BARBELL',
  defaultRestSec: 120,
} as Exercise;
const incline = {
  ...bench,
  id: 'incline',
  name: 'Incline Press',
  equipmentType: 'DUMBBELL',
} as Exercise;
const row = {
  ...bench,
  id: 'row',
  name: 'Cable Row',
  muscleGroup: 'BACK_THICKNESS',
  equipmentType: 'CABLE',
  defaultRestSec: 90,
} as Exercise;
const decline = {
  ...bench,
  id: 'decline',
  name: 'Decline Press',
} as Exercise;

const programExercise = {
  id: 'pe-bench',
  workoutId: 'workout-1',
  exerciseId: 'bench',
  order: 1,
  targetSets: 4,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetRIR: 2,
  restSec: 120,
  autoregulationMode: 'PRESERVE_RIR',
  fatigueRate: null,
  loadAdjustmentPct: null,
  tempo: null,
  notes: null,
  supersetGroup: null,
  exercise: bench,
} as ProgramExercise & { exercise: Exercise };
const nextProgramExercise = {
  ...programExercise,
  id: 'pe-row',
  exerciseId: 'row',
  order: 2,
  exercise: row,
} as ProgramExercise & { exercise: Exercise };

function renderMenu(loggedSetCount = 0, onChanged = vi.fn()) {
  return render(
    <SessionExerciseMenu
      open
      onOpenChange={vi.fn()}
      programExercise={programExercise}
      programExercises={[programExercise, nextProgramExercise]}
      catalog={[bench, incline, row]}
      loggedSetCount={loggedSetCount}
      onChanged={onChanged}
    />,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response));
});

describe('SessionExerciseMenu', () => {
  it('says on every view that the saved program changes, not only this session', () => {
    renderMenu();
    expect(screen.getAllByText(/saved program/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    expect(screen.getAllByText(/saved program/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add exercise' }));
    expect(screen.getAllByText(/saved.*program/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove exercise' }));
    expect(screen.getAllByText(/saved program/i).length).toBeGreaterThan(0);
  });

  it('offers replacements only from the current primary muscle group', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    expect(screen.getByRole('button', { name: 'Incline Press' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cable Row' })).not.toBeInTheDocument();
  });

  it('does not offer a replacement already assigned elsewhere in the workout', () => {
    const declineProgramExercise = {
      ...programExercise,
      id: 'pe-decline',
      exerciseId: 'decline',
      order: 2,
      exercise: decline,
    } as ProgramExercise & { exercise: Exercise };
    render(
      <SessionExerciseMenu
        open
        onOpenChange={vi.fn()}
        programExercise={programExercise}
        programExercises={[programExercise, declineProgramExercise, nextProgramExercise]}
        catalog={[bench, incline, decline, row]}
        loggedSetCount={0}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    expect(screen.getByRole('button', { name: 'Incline Press' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline Press' })).not.toBeInTheDocument();
  });

  it('replaces through the existing owned program-exercise route', async () => {
    const onChanged = vi.fn();
    renderMenu(0, onChanged);
    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Incline Press' }));
    fireEvent.click(screen.getByRole('button', { name: /replace with incline press/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/program-exercises/pe-bench');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      exerciseId: 'incline',
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 10,
    });
    expect(onChanged).toHaveBeenCalledOnce();
    // The menu goes back to its action list, so reopening it does not land on
    // the replacement picker of the exercise that was just swapped in.
    expect(await screen.findByRole('button', { name: 'Add exercise' })).toBeInTheDocument();
  });

  it('requires confirmation when replacement would leave logged sets on the original exercise', async () => {
    renderMenu(2);
    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Incline Press' }));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/already logged/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /replace with incline press/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  });

  it('asks for confirmation before replacing even when nothing is logged yet', async () => {
    renderMenu(0);
    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Incline Press' }));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/already logged/i)).not.toBeInTheDocument();
    expect(screen.getByText(/future sessions change too/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Incline Press' })).toBeInTheDocument();
  });

  it('adds only exercises that are not already in the workout', async () => {
    const onChanged = vi.fn();
    renderMenu(0, onChanged);
    fireEvent.click(screen.getByRole('button', { name: 'Add exercise' }));
    expect(screen.queryByRole('button', { name: 'Cable Row' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Incline Press' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/workouts/workout-1/program-exercises');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      exerciseId: 'incline',
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      restSec: 120,
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('adds a cardio exercise as one continuous set, not as a strength prescription', async () => {
    const bike = {
      ...bench,
      id: 'bike',
      name: 'Stationary Bike',
      muscleGroup: 'OTHER',
      category: 'CARDIO',
      equipmentType: 'CARDIO',
      defaultRestSec: 60,
    } as Exercise;
    render(
      <SessionExerciseMenu
        open
        onOpenChange={vi.fn()}
        programExercise={programExercise}
        programExercises={[programExercise, nextProgramExercise]}
        catalog={[bench, bike, row]}
        loggedSetCount={0}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stationary Bike' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string)).toEqual({
      exerciseId: 'bike',
      targetSets: 1,
      targetRepsMin: 1,
      targetRepsMax: 1,
      targetRIR: 0,
      restSec: 60,
    });
  });

  it('sends one request when the same choice is tapped twice', async () => {
    let release: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise<Response>((resolve) => (release = resolve))),
    );
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Add exercise' }));
    const choice = screen.getByRole('button', { name: 'Incline Press' });
    fireEvent.click(choice);
    fireEvent.click(choice);
    expect(fetch).toHaveBeenCalledOnce();
    release({ ok: true } as Response);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add exercise' })).toBeEnabled());
  });

  it('does not carry the old exercise autoregulation tuning onto the replacement', async () => {
    const tuned = {
      ...programExercise,
      fatigueRate: 1.4,
      loadAdjustmentPct: 5,
    } as ProgramExercise & { exercise: Exercise };
    render(
      <SessionExerciseMenu
        open
        onOpenChange={vi.fn()}
        programExercise={tuned}
        programExercises={[tuned, nextProgramExercise]}
        catalog={[bench, incline, row]}
        loggedSetCount={0}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Incline Press' }));
    fireEvent.click(screen.getByRole('button', { name: /replace with incline press/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    // Same values the POST route stores for a new upper-body compound row.
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string)).toMatchObject({
      exerciseId: 'incline',
      fatigueRate: 0.75,
      loadAdjustmentPct: 2.5,
    });
  });

  it('keeps every menu control at the repo tap-target height', () => {
    renderMenu();
    for (const name of ['Replace exercise', 'Add exercise', 'Remove exercise']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-tap');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    expect(screen.getByRole('button', { name: 'Incline Press' })).toHaveClass('min-h-tap');
    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('min-h-tap');
    fireEvent.click(screen.getByRole('button', { name: 'Incline Press' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('min-h-tap');
    expect(screen.getByRole('button', { name: /replace with incline press/i })).toHaveClass(
      'min-h-tap',
    );
  });

  it('starts from the new exercise targets when a replace crosses the cardio line', async () => {
    const chestCardio = {
      ...bench,
      id: 'ski-erg',
      name: 'Ski Erg',
      category: 'CARDIO',
      equipmentType: 'CARDIO',
      defaultRestSec: 60,
    } as Exercise;
    render(
      <SessionExerciseMenu
        open
        onOpenChange={vi.fn()}
        programExercise={programExercise}
        programExercises={[programExercise, nextProgramExercise]}
        catalog={[bench, chestCardio, row]}
        loggedSetCount={0}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ski Erg' }));
    fireEvent.click(screen.getByRole('button', { name: /replace with ski erg/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string)).toMatchObject({
      exerciseId: 'ski-erg',
      targetSets: 1,
      targetRepsMin: 1,
      targetRepsMax: 1,
      targetRIR: 0,
      restSec: 60,
    });
  });

  it('does not offer to remove the only exercise of the workout', () => {
    render(
      <SessionExerciseMenu
        open
        onOpenChange={vi.fn()}
        programExercise={programExercise}
        programExercises={[programExercise]}
        catalog={[bench, incline, row]}
        loggedSetCount={0}
        onChanged={vi.fn()}
      />,
    );
    const remove = screen.getByRole('button', { name: 'Remove exercise' });
    expect(remove).toBeDisabled();
    expect(screen.getByText(/only exercise in the workout/i)).toBeInTheDocument();
    // The reason is announced with the disabled button, not only shown near it.
    expect(remove).toHaveAccessibleDescription(/only exercise in the workout/i);
    expect(screen.getByRole('button', { name: 'Replace exercise' })).toBeEnabled();
  });

  it('requires removal confirmation and selects the neighboring exercise after delete', async () => {
    const onChanged = vi.fn();
    renderMenu(2, onChanged);
    fireEvent.click(screen.getByRole('button', { name: 'Remove exercise' }));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/remain in history/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove exercise' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/program-exercises/pe-bench');
    expect(init?.method).toBe('DELETE');
    expect(onChanged).toHaveBeenCalledWith({
      selectProgramExerciseId: 'pe-row',
      removedProgramExerciseId: 'pe-bench',
    });
  });

  it('names the duplicate when the server refuses an exercise already in the workout (#426)', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 409 } as Response);
    const onChanged = vi.fn();
    renderMenu(0, onChanged);
    fireEvent.click(screen.getByRole('button', { name: 'Add exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Incline Press' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('That exercise is already in this workout.'),
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('keeps the generic error for any other failed add', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Add exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Incline Press' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not add the exercise.'));
  });

  it('lists favourite exercises first in the add and replace pickers (#404)', () => {
    const favoriteDecline = { ...decline, isFavorite: true } as Exercise;
    render(
      <SessionExerciseMenu
        open
        onOpenChange={vi.fn()}
        programExercise={programExercise}
        programExercises={[programExercise, nextProgramExercise]}
        catalog={[bench, incline, favoriteDecline, row]}
        loggedSetCount={0}
        onChanged={vi.fn()}
      />,
    );
    const pressChoices = () =>
      screen
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '')
        .filter((name) => name.includes('Press'));

    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    expect(pressChoices()).toEqual(['favourite: Decline Press', 'Incline Press']);
    // The star is announced, not only drawn.
    expect(screen.getByRole('button', { name: 'favourite: Decline Press' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add exercise' }));
    expect(pressChoices()).toEqual(['favourite: Decline Press', 'Incline Press']);

    // Favourites stay first among search results too.
    fireEvent.change(screen.getByLabelText('Search exercises'), { target: { value: 'line' } });
    expect(pressChoices()).toEqual(['favourite: Decline Press', 'Incline Press']);
  });
});

// Freestyle session (issue #388): the list belongs to the session, so every
// action goes to the session's routes and the copy stops naming the program.
describe('SessionExerciseMenu in a freestyle session', () => {
  const freestyleRow = { ...programExercise, id: 'se-bench', workoutId: '' } as ProgramExercise & {
    exercise: Exercise;
  };

  function renderFreestyle(loggedSetCount = 0, onChanged = vi.fn()) {
    return render(
      <SessionExerciseMenu
        open
        onOpenChange={vi.fn()}
        programExercise={freestyleRow}
        programExercises={[freestyleRow]}
        catalog={[bench, incline, row]}
        loggedSetCount={loggedSetCount}
        freestyleSessionId="session 1"
        onChanged={onChanged}
      />,
    );
  }

  it('says the change stays in this session, on every view', () => {
    renderFreestyle();
    expect(screen.getByText(/only changes the current session/i)).toBeInTheDocument();
    for (const [view, back] of [
      ['Replace exercise', 'Back'],
      ['Add exercise', 'Back'],
      ['Remove exercise', 'Cancel'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: view }));
      expect(screen.getByText(/only changes the current session/i)).toBeInTheDocument();
      expect(screen.queryByText(/future sessions/i)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: back }));
    }
  });

  it('adds through the session route, never a workout route', async () => {
    const onChanged = vi.fn();
    renderFreestyle(0, onChanged);
    fireEvent.click(screen.getByRole('button', { name: 'Add exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cable Row' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/sessions/session%201/exercises');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      exerciseId: 'row',
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      restSec: 90,
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  });

  it('replaces through the session row route with targets only', async () => {
    renderFreestyle();
    fireEvent.click(screen.getByRole('button', { name: 'Replace exercise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Incline Press' }));
    expect(screen.getByText('Replace this exercise in the current session?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /replace with incline press/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/sessions/session%201/exercises/se-bench');
    expect(init?.method).toBe('PUT');
    // The row's own targets carry over; no program-only field is sent.
    expect(JSON.parse(init?.body as string)).toEqual({
      exerciseId: 'incline',
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetRIR: 2,
      restSec: 120,
    });
  });

  it('removes the only exercise through the session row route', async () => {
    const onChanged = vi.fn();
    renderFreestyle(2, onChanged);
    // Not blocked: a freestyle session has an empty state to return to.
    const remove = screen.getByRole('button', { name: 'Remove exercise' });
    expect(remove).toBeEnabled();
    fireEvent.click(remove);
    expect(screen.getByText(/remain in history.*remove the exercise\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove exercise' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/sessions/session%201/exercises/se-bench');
    expect(init?.method).toBe('DELETE');
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith({
        selectProgramExerciseId: undefined,
        removedProgramExerciseId: 'se-bench',
      }),
    );
  });
});
