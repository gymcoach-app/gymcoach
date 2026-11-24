import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Exercise, MuscleGroup } from '@/lib/prisma-client';
import {
  buildGymInventory,
  defaultFilterGym,
  toggleMuscle,
  type GymInventory,
  type GymInventorySource,
} from '@/lib/exercise-filters';
import { GymFilter, MuscleFilter } from './catalog-filters';
import { ExercisesView } from './exercises-view';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The gym picker is the Radix select, which needs these under jsdom.
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

function gym(over: Partial<GymInventorySource> & { id: string; name: string }): GymInventory {
  return buildGymInventory({
    dumbbellWeights: [],
    plateWeights: [],
    barWeights: [],
    equipment: [],
    exerciseConfigs: [],
    ...over,
  });
}

// The two controls are tested on their own first: the catalog page around them
// is a heavy tree, and these behaviours do not depend on it.

const GROUPS: MuscleGroup[] = ['CHEST', 'BACK_WIDTH', 'QUADS', 'OTHER'];

function MuscleHarness({
  onChange,
  groups = GROUPS,
}: {
  onChange?: (selected: MuscleGroup[]) => void;
  groups?: MuscleGroup[];
}) {
  const [selected, setSelected] = useState<ReadonlySet<MuscleGroup>>(new Set());
  return (
    <MuscleFilter
      groups={groups}
      selected={selected}
      onToggle={(group) => {
        const next = toggleMuscle(selected, group);
        setSelected(next);
        onChange?.([...next]);
      }}
    />
  );
}

describe('MuscleFilter (issue #402)', () => {
  it('lists the offered groups as toggle buttons, the region-less one included', () => {
    render(<MuscleHarness />);
    const list = screen.getByRole('group', { name: 'Filter by muscle group' });
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Chest',
      'Back (width)',
      'Quads',
      'Other',
    ]);
    for (const button of buttons) expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('tells assistive technology where cardio is, only when Other is offered', () => {
    const { unmount } = render(<MuscleHarness />);
    expect(
      screen.getByRole('group', { name: 'Filter by muscle group' }),
    ).toHaveAccessibleDescription('Cardio and unclassified exercises are under Other.');
    unmount();
    render(<MuscleHarness groups={['CHEST', 'QUADS']} />);
    expect(
      screen.getByRole('group', { name: 'Filter by muscle group' }),
    ).not.toHaveAccessibleDescription();
    expect(screen.queryByText(/under Other/)).toBeNull();
  });

  it('toggles from the list and shows the pressed state', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<MuscleHarness onChange={onChange} />);
    const quads = screen.getByRole('button', { name: 'Quads' });
    await user.click(quads);
    expect(quads).toHaveAttribute('aria-pressed', 'true');
    expect(onChange).toHaveBeenLastCalledWith(['QUADS']);
    await user.click(screen.getByRole('button', { name: 'Other' }));
    expect(onChange).toHaveBeenLastCalledWith(['QUADS', 'OTHER']);
    await user.click(quads);
    expect(quads).toHaveAttribute('aria-pressed', 'false');
    expect(onChange).toHaveBeenLastCalledWith(['OTHER']);
  });

  it('works from the keyboard alone: the silhouettes take no focus', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<MuscleHarness onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Chest' })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Chest' })).toHaveAttribute('aria-pressed', 'true');
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['CHEST', 'BACK_WIDTH']);
  });

  it('toggles from a tap on the silhouette, in sync with the list', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    const { container } = render(<MuscleHarness onChange={onChange} />);
    await user.click(container.querySelector('path[data-region="quad-left"]')!);
    expect(onChange).toHaveBeenLastCalledWith(['QUADS']);
    expect(screen.getByRole('button', { name: 'Quads' })).toHaveAttribute('aria-pressed', 'true');
    // Both regions of the group light up, and a tap on either clears it.
    expect(container.querySelectorAll('path[data-selected]')).toHaveLength(2);
    await user.click(container.querySelector('path[data-region="quad-right"]')!);
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(container.querySelectorAll('path[data-selected]')).toHaveLength(0);
  });

  it('draws both views, hidden from assistive technology and from the tab order', () => {
    const { container } = render(<MuscleHarness />);
    const figures = container.querySelectorAll('figure svg');
    expect(figures).toHaveLength(2);
    for (const svg of figures) expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('figure [tabindex]')).toHaveLength(0);
    expect(container.querySelector('path[data-region="chest-left"]')).not.toBeNull();
    expect(container.querySelector('path[data-region="lat-left"]')).not.toBeNull();
  });

  it('leaves the region of a group that is not offered inert', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    const { container } = render(<MuscleHarness onChange={onChange} />);
    await user.click(container.querySelector('path[data-region="abs"]')!);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Abs' })).toBeNull();
  });
});

// Gyms as the settings screen saves them: free weights and per-exercise rows,
// no equipment item.
const home = gym({ id: 'home', name: 'Home', dumbbellWeights: [5, 10] });
const club = gym({
  id: 'club',
  name: 'Club',
  plateWeights: [5, 10, 20],
  barWeights: [20],
  exerciseConfigs: [
    { exerciseId: 'ext', isAvailable: true, weightOptions: [10, 20, 30] },
    { exerciseId: 'pullup', isAvailable: false, weightOptions: [] },
  ],
});
const garage = gym({ id: 'garage', name: 'Garage' });

function GymHarness({ gyms, activeGymId }: { gyms: GymInventory[]; activeGymId?: string }) {
  const [enabled, setEnabled] = useState(false);
  const [gymId, setGymId] = useState<string | null>(null);
  const selected = gyms.find((g) => g.id === gymId) ?? defaultFilterGym(gyms, activeGymId);
  return (
    <GymFilter
      gyms={gyms}
      enabled={enabled}
      onEnabledChange={setEnabled}
      gym={selected}
      onGymChange={setGymId}
    />
  );
}

describe('GymFilter (issue #402)', () => {
  it('points to the settings instead of a switch when no gym is saved', () => {
    render(<GymHarness gyms={[]} />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(
      screen.getByText('Save a gym and its equipment to list only the exercises you can do there.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gyms and equipment' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('states its whole rule once switched on, and offers no gym choice with one gym', async () => {
    const user = userEvent.setup({ delay: null });
    render(<GymHarness gyms={[home]} />);
    const toggle = screen.getByRole('switch', { name: 'Only what my gym has' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(/Checked against/)).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    const note = document.getElementById(toggle.getAttribute('aria-describedby')!)!;
    expect(note).toHaveTextContent('Checked against the equipment saved for Home.');
    // What is hidden...
    expect(note).toHaveTextContent(
      'Dumbbell and barbell exercises are hidden when the gym has no such weights',
    );
    expect(note).toHaveTextContent('any exercise switched off for this gym');
    // ...and what always stays.
    expect(note).toHaveTextContent('Bodyweight, machine, cable and cardio exercises');
    expect(note).toHaveTextContent('exercises with no set equipment type, stay listed');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('explains an empty inventory and links to the settings', async () => {
    const user = userEvent.setup({ delay: null });
    render(<GymHarness gyms={[garage]} />);
    const toggle = screen.getByRole('switch', { name: 'Only what my gym has' });
    await user.click(toggle);
    expect(toggle).toHaveAccessibleDescription(
      /No equipment is saved for Garage yet, so dumbbell and barbell exercises are hidden/,
    );
    expect(toggle).toHaveAccessibleDescription(/machine, cable and cardio exercises.*stay listed/);
    expect(screen.getByRole('link', { name: 'Gyms and equipment' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('does not call a gym empty when it only holds exercise load options', async () => {
    const user = userEvent.setup({ delay: null });
    const stacksOnly = gym({
      id: 'stacks',
      name: 'Stacks',
      exerciseConfigs: [{ exerciseId: 'ext', isAvailable: true, weightOptions: [10, 20] }],
    });
    render(<GymHarness gyms={[stacksOnly]} />);
    const toggle = screen.getByRole('switch', { name: 'Only what my gym has' });
    await user.click(toggle);
    expect(toggle).toHaveAccessibleDescription(/Checked against the equipment saved for Stacks/);
    expect(screen.queryByText(/No equipment is saved/)).toBeNull();
  });

  it('starts on the active gym and lets the user pick another', async () => {
    const user = userEvent.setup({ delay: null });
    render(<GymHarness gyms={[club, home]} activeGymId="home" />);
    const toggle = screen.getByRole('switch', { name: 'Only what my gym has' });
    await user.click(toggle);
    const select = screen.getByRole('combobox', { name: 'Gym' });
    expect(select).toHaveTextContent('Home');
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'Club' }));
    expect(screen.getByRole('combobox', { name: 'Gym' })).toHaveTextContent('Club');
    expect(toggle).toHaveAccessibleDescription(/saved for Club\./);
  });
});

// The catalog page with the filters wired in.

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

const NAMES = exercises.map((ex) => ex.name);

function shown(): string[] {
  return NAMES.filter((name) => screen.queryByText(name) !== null);
}

// The filter controls sit in their own labelled region. Each test looks it up
// once and scopes its queries to it, which keeps them off the exercise rows.
function filters() {
  return within(screen.getByRole('region', { name: 'Filters' }));
}

describe('ExercisesView filters (issue #402)', () => {
  it('opens the muscle panel on demand and filters by the picked muscles', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} />);
    const f = filters();
    const toggle = f.getByRole('button', { name: 'Muscles' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(f.queryByRole('group', { name: 'Filter by muscle group' })).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Only the groups of this catalog are offered.
    const list = f.getByRole('group', { name: 'Filter by muscle group' });
    expect(within(list).getAllByRole('button')).toHaveLength(4);

    await user.click(within(list).getByRole('button', { name: 'Quads' }));
    expect(shown()).toEqual(['Goblet Squat', 'Leg Extension']);
    expect(toggle).toHaveTextContent('Muscles (1)');
    expect(f.getByRole('status')).toHaveTextContent('2 exercises shown.');
  });

  it('filters from a tap on the silhouette', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<ExercisesView exercises={exercises} />);
    const f = filters();
    await user.click(f.getByRole('button', { name: 'Muscles' }));
    await user.click(container.querySelector('path[data-region="lat-left"]')!);
    expect(shown()).toEqual(['Pull-up']);
  });

  // The page tests stay at two or three interactions each: every one of them
  // re-renders the whole catalog, which is slow on a busy machine.
  it('hides the free-weight work the gym lacks and keeps the machines', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[club, home]} activeGymId="home" />);
    await user.click(filters().getByRole('switch', { name: 'Only what my gym has' }));
    // Home has dumbbells only: the barbell exercise goes, the machine stays.
    expect(shown()).toEqual(['Goblet Squat', 'Leg Extension', 'Pull-up', 'Running']);
  });

  it('hides what is switched off for the gym, bodyweight included', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[club, home]} activeGymId="club" />);
    await user.click(filters().getByRole('switch', { name: 'Only what my gym has' }));
    // Club has a bar and no dumbbells, and pull-ups are switched off there.
    expect(shown()).toEqual(['Barbell Bench Press', 'Leg Extension', 'Running']);
  });

  it('filters against the gym picked in the select', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[club, home]} activeGymId="home" />);
    const f = filters();
    await user.click(f.getByRole('switch', { name: 'Only what my gym has' }));
    await user.click(f.getByRole('combobox', { name: 'Gym' }));
    await user.click(await screen.findByRole('option', { name: 'Club' }));
    expect(shown()).toEqual(['Barbell Bench Press', 'Leg Extension', 'Running']);
  });

  it('explains an empty inventory, which hides the free-weight exercises only', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[garage]} />);
    const f = filters();
    await user.click(f.getByRole('switch', { name: 'Only what my gym has' }));
    expect(shown()).toEqual(['Leg Extension', 'Pull-up', 'Running']);
    expect(f.getByText(/No equipment is saved for Garage yet/)).toBeInTheDocument();
  });

  it('intersects search, muscle and gym, each narrowing the list', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[home]} />);
    const f = filters();
    expect(f.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    await user.click(f.getByRole('switch'));
    expect(shown()).toEqual(['Goblet Squat', 'Leg Extension', 'Pull-up', 'Running']);
    await user.click(f.getByRole('button', { name: 'Muscles' }));
    await user.click(f.getByRole('button', { name: 'Quads' }));
    expect(shown()).toEqual(['Goblet Squat', 'Leg Extension']);
    expect(f.getByRole('status')).toHaveTextContent('2 exercises shown.');
    screen.getByRole('searchbox').focus();
    await user.paste('gob');
    expect(shown()).toEqual(['Goblet Squat']);
    expect(f.getByRole('status')).toHaveTextContent('1 exercise shown.');
  });

  it('clears the filters from the filter bar while results remain', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} />);
    const f = filters();
    const muscles = f.getByRole('button', { name: 'Muscles' });
    await user.click(muscles);
    await user.click(f.getByRole('button', { name: 'Quads' }));
    await user.click(f.getByRole('button', { name: 'Clear filters' }));
    expect(shown()).toEqual(NAMES);
    expect(f.getByRole('button', { name: 'Quads' })).toHaveAttribute('aria-pressed', 'false');
    expect(f.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    // The pressed button is gone; focus lands on a control that opens no keyboard.
    expect(muscles).toHaveFocus();
  });

  it('shows an empty state with one clear action that resets everything', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} gyms={[home]} />);
    const f = filters();
    await user.click(f.getByRole('switch'));
    screen.getByRole('searchbox').focus();
    await user.paste('bench');
    expect(shown()).toEqual([]);
    expect(screen.getByText('No exercises match these filters')).toBeInTheDocument();
    expect(f.getByRole('status')).toHaveTextContent('No exercises shown.');

    // One action only: the filter bar leaves it to the empty state.
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(shown()).toEqual(NAMES);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(f.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(f.getByRole('button', { name: 'Muscles' })).toHaveFocus();
  });

  it('leaves focus in the search box when the clear tap did not take it', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} />);
    const search = screen.getByRole('searchbox');
    search.focus();
    await user.paste('zzz');
    expect(screen.getByText('No exercises match')).toBeInTheDocument();
    // Some mobile browsers do not focus a tapped button: fireEvent clicks
    // without moving focus.
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(shown()).toEqual(NAMES);
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
  });

  it('forgets a selected group that left the catalog', async () => {
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(<ExercisesView exercises={exercises} />);
    const f = filters();
    await user.click(f.getByRole('button', { name: 'Muscles' }));
    await user.click(f.getByRole('button', { name: 'Other' }));
    expect(shown()).toEqual(['Running']);
    // It stops filtering instead of emptying the list...
    rerender(<ExercisesView exercises={exercises.filter((ex) => ex.id !== 'run')} />);
    expect(shown()).toEqual(NAMES.filter((name) => name !== 'Running'));
    expect(f.getByRole('button', { name: 'Muscles' })).toHaveTextContent(/^Muscles$/);
    // ...and does not come back on its own with the group.
    rerender(<ExercisesView exercises={exercises} />);
    expect(shown()).toEqual(NAMES);
    expect(f.getByRole('button', { name: 'Other' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('forgets the gym filter when the last gym is gone', async () => {
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(<ExercisesView exercises={exercises} gyms={[home]} />);
    const f = filters();
    await user.click(f.getByRole('switch'));
    expect(shown()).not.toContain('Barbell Bench Press');
    rerender(<ExercisesView exercises={exercises} gyms={[]} />);
    expect(shown()).toEqual(NAMES);
    rerender(<ExercisesView exercises={exercises} gyms={[home]} />);
    expect(f.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(shown()).toEqual(NAMES);
  });
});
