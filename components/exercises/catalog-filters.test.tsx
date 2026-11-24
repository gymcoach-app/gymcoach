import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Exercise } from '@/lib/prisma-client';
import { buildGymInventory, type GymInventory } from '@/lib/exercise-filters';
import { ExercisesView } from './exercises-view';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.clearAllMocks();
});

function exercise(over: Partial<Exercise>): Exercise {
  return {
    id: 'e1',
    userId: 'u',
    name: 'Exercise',
    muscleGroup: 'CHEST',
    category: 'COMPOUND',
    defaultRestSec: 120,
    notes: null,
    usesBodyweight: false,
    equipmentType: 'OTHER',
    isFavorite: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

const exercises: Exercise[] = [
  exercise({ id: 'bench', name: 'Barbell Bench Press', equipmentType: 'BARBELL' }),
  exercise({ id: 'fly', name: 'Dumbbell Fly', equipmentType: 'DUMBBELL' }),
  exercise({ id: 'squat', name: 'Goblet Squat', muscleGroup: 'QUADS', equipmentType: 'DUMBBELL' }),
  exercise({ id: 'ext', name: 'Leg Extension', muscleGroup: 'QUADS', equipmentType: 'MACHINE' }),
  exercise({
    id: 'pullup',
    name: 'Pull-up',
    muscleGroup: 'BACK_WIDTH',
    equipmentType: 'BODYWEIGHT',
  }),
  exercise({
    id: 'run',
    name: 'Running',
    muscleGroup: 'OTHER',
    category: 'CARDIO',
    equipmentType: 'CARDIO',
  }),
];

function gym(id: string, name: string, dumbbellWeights: number[] = []): GymInventory {
  return buildGymInventory({
    id,
    name,
    dumbbellWeights,
    plateWeights: [],
    barWeights: [],
    equipment: [],
    exerciseConfigs: [],
  });
}

const NAMES = exercises.map((ex) => ex.name);

function shown(): string[] {
  return NAMES.filter((name) => screen.queryByText(name) !== null);
}

async function openMuscles(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Muscles' }));
  return screen.getByRole('group', { name: 'Filter by muscle group' });
}

describe('catalog muscle filter (issue #402)', () => {
  it('keeps the muscle panel closed until asked for', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} />);
    const toggle = screen.getByRole('button', { name: 'Muscles' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Filter by muscle group' })).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Filter by muscle group' })).toBeInTheDocument();
  });

  it('lists the catalog groups as toggle buttons, the region-less one included', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} />);
    const list = await openMuscles(user);
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Chest',
      'Back (width)',
      'Quads',
      'Other',
    ]);
    for (const button of buttons) expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('filters from the list and shows the pressed state', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} />);
    const list = await openMuscles(user);
    const quads = within(list).getByRole('button', { name: 'Quads' });
    await user.click(quads);
    expect(quads).toHaveAttribute('aria-pressed', 'true');
    expect(shown()).toEqual(['Goblet Squat', 'Leg Extension']);
    expect(screen.getByRole('button', { name: 'Muscles (1)' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 exercises shown.');

    await user.click(within(list).getByRole('button', { name: 'Other' }));
    expect(shown()).toEqual(['Goblet Squat', 'Leg Extension', 'Running']);

    await user.click(quads);
    expect(quads).toHaveAttribute('aria-pressed', 'false');
    expect(shown()).toEqual(['Running']);
  });

  it('works from the keyboard alone', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} />);
    screen.getByRole('button', { name: 'Muscles' }).focus();
    await user.keyboard('{Enter}');
    // The silhouettes take no focus: the next stop is the first list button.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Chest' })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Chest' })).toHaveAttribute('aria-pressed', 'true');
    expect(shown()).toEqual(['Barbell Bench Press', 'Dumbbell Fly']);
  });

  it('filters from a tap on the silhouette, in sync with the list', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<ExercisesView exercises={exercises} />);
    const list = await openMuscles(user);
    const region = container.querySelector('path[data-region="quad-left"]');
    expect(region).not.toBeNull();
    await user.click(region!);
    expect(shown()).toEqual(['Goblet Squat', 'Leg Extension']);
    expect(within(list).getByRole('button', { name: 'Quads' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Both regions of the group light up, and a second tap clears it.
    expect(container.querySelectorAll('path[data-selected]')).toHaveLength(2);
    await user.click(container.querySelector('path[data-region="quad-right"]')!);
    expect(shown()).toEqual(NAMES);
  });

  it('hides the silhouettes from assistive technology and from the tab order', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<ExercisesView exercises={exercises} />);
    await openMuscles(user);
    const figures = container.querySelectorAll('figure svg');
    expect(figures).toHaveLength(2);
    for (const svg of figures) expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('figure [tabindex]')).toHaveLength(0);
  });

  it('leaves the region of a group the catalog lacks inert', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<ExercisesView exercises={exercises} />);
    await openMuscles(user);
    await user.click(container.querySelector('path[data-region="abs"]')!);
    expect(shown()).toEqual(NAMES);
    expect(screen.queryByRole('button', { name: 'Abs' })).toBeNull();
  });
});

describe('catalog gym filter (issue #402)', () => {
  it('points to the settings instead of a switch when no gym is saved', () => {
    render(<ExercisesView exercises={exercises} />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(
      screen.getByText('Save a gym and its equipment to list only the exercises you can do there.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gyms and equipment' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('keeps what the gym has, bodyweight and unchecked types included, and says so', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[gym('g1', 'Home', [5, 10])]} />);
    const toggle = screen.getByRole('switch', { name: 'Only what my gym has' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(shown()).toEqual(['Dumbbell Fly', 'Goblet Squat', 'Pull-up', 'Running']);
    expect(toggle).toHaveAccessibleDescription(/Checked against the equipment saved for Home\./);
    // One gym: nothing to choose.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('explains an empty inventory instead of showing a bare short list', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[gym('g1', 'Garage')]} />);
    await user.click(screen.getByRole('switch', { name: 'Only what my gym has' }));
    expect(shown()).toEqual(['Pull-up', 'Running']);
    expect(screen.getByText(/No equipment is saved for Garage yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gyms and equipment' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('starts on the active gym and lets the user pick another', async () => {
    const user = userEvent.setup({ delay: null });
    const club = buildGymInventory({
      id: 'club',
      name: 'Club',
      dumbbellWeights: [],
      plateWeights: [20],
      barWeights: [20],
      equipment: [{ equipmentType: 'MACHINE', exerciseLinks: [] }],
      exerciseConfigs: [],
    });
    render(
      <ExercisesView
        exercises={exercises}
        gyms={[club, gym('home', 'Home', [5, 10])]}
        activeGymId="home"
      />,
    );
    await user.click(screen.getByRole('switch', { name: 'Only what my gym has' }));
    const select = screen.getByRole('combobox', { name: 'Gym' });
    expect(select).toHaveValue('home');
    expect(shown()).toEqual(['Dumbbell Fly', 'Goblet Squat', 'Pull-up', 'Running']);
    await user.selectOptions(select, 'club');
    expect(shown()).toEqual(['Barbell Bench Press', 'Leg Extension', 'Pull-up', 'Running']);
  });
});

describe('catalog filters combined (issue #402)', () => {
  it('intersects search, muscle and gym', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[gym('g1', 'Home', [5, 10])]} />);
    const list = await openMuscles(user);
    await user.click(within(list).getByRole('button', { name: 'Quads' }));
    await user.click(screen.getByRole('switch', { name: 'Only what my gym has' }));
    expect(shown()).toEqual(['Goblet Squat']);
    await user.type(screen.getByRole('searchbox'), 'gob');
    expect(shown()).toEqual(['Goblet Squat']);
    expect(screen.getByRole('status')).toHaveTextContent('1 exercise shown.');
  });

  it('offers to clear the filters while results remain', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[gym('g1', 'Home', [5, 10])]} />);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Only what my gym has' }));
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(shown()).toEqual(NAMES);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('shows an empty state with one clear action that resets everything', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[gym('g1', 'Home', [5, 10])]} />);
    const list = await openMuscles(user);
    await user.click(within(list).getByRole('button', { name: 'Chest' }));
    await user.click(screen.getByRole('switch', { name: 'Only what my gym has' }));
    await user.type(screen.getByRole('searchbox'), 'bench');
    expect(shown()).toEqual([]);
    expect(screen.getByText('No exercises match these filters')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No exercises shown.');

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(shown()).toEqual(NAMES);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Chest' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the search wording and adds the clear action for a search with no match', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} />);
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No exercises match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(shown()).toEqual(NAMES);
  });

  it('drops a selected group that left the catalog instead of emptying the list', async () => {
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(<ExercisesView exercises={exercises} />);
    const list = await openMuscles(user);
    await user.click(within(list).getByRole('button', { name: 'Other' }));
    expect(shown()).toEqual(['Running']);
    const withoutRunning = exercises.filter((ex) => ex.id !== 'run');
    rerender(<ExercisesView exercises={withoutRunning} />);
    expect(shown()).toEqual(NAMES.filter((name) => name !== 'Running'));
    expect(screen.getByRole('button', { name: 'Muscles' })).toBeInTheDocument();
  });
});
