// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { WorkoutCard } from './workout-card';

// Reordering in the program editor (issue #557, step 1): "Move up" and
// "Move down" in each exercise's menu. The block rules are unit-tested in
// lib/supersets.test.ts; this pins the wiring: which items are disabled, what
// is sent, that the list updates without waiting for the server, and that a
// failed save puts the previous order back with an error toast.

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type CardProps = Parameters<typeof WorkoutCard>[0];
type Row = CardProps['workout']['exercises'][number];

function row(name: string, order: number, supersetGroup: number | null = null): Row {
  const id = name.toLowerCase();
  return {
    id: `pe-${id}`,
    workoutId: 'w1',
    exerciseId: `ex-${id}`,
    order,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetRIR: 2,
    restSec: 90,
    tempo: null,
    notes: null,
    supersetGroup,
    autoregulationMode: 'PRESERVE_RIR',
    fatigueRate: 0.75,
    loadAdjustmentPct: 2.5,
    exercise: { id: `ex-${id}`, name, muscleGroup: 'CHEST', category: 'COMPOUND' },
  } as unknown as Row;
}

function workout(exercises: Row[]): CardProps['workout'] {
  return {
    id: 'w1',
    programId: 'p1',
    name: 'Full body',
    dayOfWeek: null,
    order: 1,
    exercises,
  } as unknown as CardProps['workout'];
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// Exercise names top to bottom, with the superset label when there is one.
function shown(): string[] {
  return screen.getAllByRole('listitem').map((li) => {
    const name = li.querySelector('p')?.textContent ?? '';
    const label = within(li).queryByText(/^Superset /)?.textContent;
    return label ? `${name} (${label.replace('Superset ', '')})` : name;
  });
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, index: number) {
  await user.click(screen.getAllByRole('button', { name: 'Exercise actions' })[index]!);
  return screen.findByRole('menu');
}

function sentOrder(call = 0): { url: string; method?: string; ids: string[] } {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  const body = JSON.parse(String(init.body)) as { programExerciseIds: string[] };
  return { url, method: init.method, ids: body.programExerciseIds };
}

describe('WorkoutCard reordering (issue #557)', () => {
  const three = () => [row('Bench', 1), row('Squat', 2), row('Running', 3)];

  it('disables Move up on the first row and Move down on the last', async () => {
    const user = userEvent.setup({ delay: null });
    render(<WorkoutCard workout={workout(three())} catalog={[]} />);

    let menu = await openMenu(user, 0);
    expect(within(menu).getByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(menu).getByRole('menuitem', { name: 'Move down' })).not.toHaveAttribute(
      'aria-disabled',
    );
    await user.keyboard('{Escape}');

    menu = await openMenu(user, 2);
    expect(within(menu).getByRole('menuitem', { name: 'Move up' })).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(within(menu).getByRole('menuitem', { name: 'Move down' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('disables both items when the workout has a single exercise', async () => {
    const user = userEvent.setup({ delay: null });
    render(<WorkoutCard workout={workout([row('Bench', 1)])} catalog={[]} />);
    const menu = await openMenu(user, 0);
    for (const name of ['Move up', 'Move down']) {
      expect(within(menu).getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('moves the last exercise to the top in two moves, saving the full order each time', async () => {
    const user = userEvent.setup({ delay: null });
    render(<WorkoutCard workout={workout(three())} catalog={[]} />);
    expect(shown()).toEqual(['Bench', 'Squat', 'Running']);

    await user.click(within(await openMenu(user, 2)).getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => expect(shown()).toEqual(['Bench', 'Running', 'Squat']));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(sentOrder(0)).toEqual({
      url: '/api/workouts/w1/order',
      method: 'PUT',
      ids: ['pe-bench', 'pe-running', 'pe-squat'],
    });

    // The second move starts from the order the first one produced.
    await user.click(within(await openMenu(user, 1)).getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => expect(shown()).toEqual(['Running', 'Bench', 'Squat']));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(sentOrder(1).ids).toEqual(['pe-running', 'pe-bench', 'pe-squat']);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('works from the keyboard', async () => {
    const user = userEvent.setup({ delay: null });
    render(<WorkoutCard workout={workout(three())} catalog={[]} />);
    screen.getAllByRole('button', { name: 'Exercise actions' })[0]!.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    // Edit is focused first; Move up is disabled on the first row and is
    // skipped, so one arrow lands on Move down.
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Move down' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(shown()).toEqual(['Squat', 'Bench', 'Running']));
    expect(sentOrder().ids).toEqual(['pe-squat', 'pe-bench', 'pe-running']);
  });

  it('shows the new order before the save answers', async () => {
    let answer: (res: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    const user = userEvent.setup({ delay: null });
    render(<WorkoutCard workout={workout(three())} catalog={[]} />);

    await user.click(within(await openMenu(user, 0)).getByRole('menuitem', { name: 'Move down' }));
    await waitFor(() => expect(shown()).toEqual(['Squat', 'Bench', 'Running']));
    expect(refresh).not.toHaveBeenCalled();

    // While the save is in flight no second move can start.
    const menu = await openMenu(user, 2);
    expect(within(menu).getByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('{Escape}');

    answer(Response.json({ ok: true }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the server refuses', () => Promise.resolve(Response.json({ error: 'no' }, { status: 400 }))],
    ['the network fails', () => Promise.reject(new TypeError('offline'))],
  ])('restores the previous order and shows an error when %s', async (_label, respond) => {
    fetchMock.mockImplementation(respond);
    const user = userEvent.setup({ delay: null });
    render(<WorkoutCard workout={workout(three())} catalog={[]} />);

    await user.click(within(await openMenu(user, 2)).getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save the new order.'));
    expect(shown()).toEqual(['Bench', 'Squat', 'Running']);
    expect(refresh).not.toHaveBeenCalled();

    // The row can be moved again afterwards.
    const menu = await openMenu(user, 2);
    expect(within(menu).getByRole('menuitem', { name: 'Move up' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('keeps an earlier saved move when a later one fails', async () => {
    const user = userEvent.setup({ delay: null });
    render(<WorkoutCard workout={workout(three())} catalog={[]} />);

    await user.click(within(await openMenu(user, 2)).getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValueOnce(Response.json({ error: 'no' }, { status: 500 }));
    await user.click(within(await openMenu(user, 1)).getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(shown()).toEqual(['Bench', 'Running', 'Squat']);
  });

  it('follows the server order once the refreshed rows arrive', async () => {
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(<WorkoutCard workout={workout(three())} catalog={[]} />);
    await user.click(within(await openMenu(user, 2)).getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => expect(shown()).toEqual(['Bench', 'Running', 'Squat']));

    // Another tab reordered meanwhile: the fresh rows win over the local copy.
    rerender(
      <WorkoutCard
        workout={workout([row('Running', 1), row('Squat', 2), row('Bench', 3)])}
        catalog={[]}
      />,
    );
    expect(shown()).toEqual(['Running', 'Squat', 'Bench']);
  });

  describe('with a superset', () => {
    const mixed = () => [row('Warmup', 1), row('Bench', 2, 1), row('Row', 3, 1), row('Squat', 4)];

    it('moves the whole pair when its second member moves up', async () => {
      const user = userEvent.setup({ delay: null });
      render(<WorkoutCard workout={workout(mixed())} catalog={[]} />);
      expect(shown()).toEqual(['Warmup', 'Bench (A1)', 'Row (A2)', 'Squat']);

      await user.click(within(await openMenu(user, 2)).getByRole('menuitem', { name: 'Move up' }));
      await waitFor(() => expect(shown()).toEqual(['Bench (A1)', 'Row (A2)', 'Warmup', 'Squat']));
      expect(sentOrder().ids).toEqual(['pe-bench', 'pe-row', 'pe-warmup', 'pe-squat']);
    });

    it('makes a standalone exercise jump over the whole pair', async () => {
      const user = userEvent.setup({ delay: null });
      render(<WorkoutCard workout={workout(mixed())} catalog={[]} />);

      await user.click(within(await openMenu(user, 3)).getByRole('menuitem', { name: 'Move up' }));
      await waitFor(() => expect(shown()).toEqual(['Warmup', 'Squat', 'Bench (A1)', 'Row (A2)']));
      expect(sentOrder().ids).toEqual(['pe-warmup', 'pe-squat', 'pe-bench', 'pe-row']);
    });

    it('disables the edge move for every member of a pair at the edge', async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <WorkoutCard
          workout={workout([row('Bench', 1, 1), row('Row', 2, 1), row('Squat', 3)])}
          catalog={[]}
        />,
      );
      for (const index of [0, 1]) {
        const menu = await openMenu(user, index);
        expect(within(menu).getByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
          'aria-disabled',
          'true',
        );
        expect(within(menu).getByRole('menuitem', { name: 'Move down' })).not.toHaveAttribute(
          'aria-disabled',
        );
        await user.keyboard('{Escape}');
      }
    });

    it('still offers Pair with previous against the new neighbour after a move', async () => {
      const user = userEvent.setup({ delay: null });
      render(<WorkoutCard workout={workout(mixed())} catalog={[]} />);
      // Squat moves above the pair: its new previous row is Warmup.
      await user.click(within(await openMenu(user, 3)).getByRole('menuitem', { name: 'Move up' }));
      await waitFor(() => expect(shown()).toEqual(['Warmup', 'Squat', 'Bench (A1)', 'Row (A2)']));
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      fetchMock.mockClear();

      await user.click(
        within(await openMenu(user, 1)).getByRole('menuitem', { name: 'Pair with previous' }),
      );
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
      // Warmup gets a fresh group (1 is taken by the pair), then Squat joins it.
      expect(calls.map(([url]) => url)).toEqual([
        '/api/program-exercises/pe-warmup',
        '/api/program-exercises/pe-squat',
      ]);
      for (const [, init] of calls) {
        expect((JSON.parse(String(init.body)) as { supersetGroup: number }).supersetGroup).toBe(2);
      }
    });
  });
});
