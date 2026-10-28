import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as nextIntl from 'next-intl';
import type { Exercise } from '@/lib/prisma-client';
import { ExercisesView } from './exercises-view';

// The catalog renders the create/edit dialogs and the delete button, which call
// useRouter; mock it so the component mounts under jsdom.
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function exercise(over: Partial<Exercise>): Exercise {
  return {
    id: over.id ?? 'e1',
    userId: 'u',
    name: over.name ?? 'Exercise',
    muscleGroup: over.muscleGroup ?? 'CHEST',
    category: over.category ?? 'COMPOUND',
    defaultRestSec: 120,
    notes: null,
    usesBodyweight: false,
    equipmentType: over.equipmentType ?? 'OTHER',
    isFavorite: over.isFavorite ?? false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

const exercises: Exercise[] = [
  exercise({ id: 'e1', name: 'Barbell Bench Press', muscleGroup: 'CHEST' }),
  exercise({ id: 'e2', name: 'Back Squat', muscleGroup: 'QUADS' }),
  exercise({ id: 'e3', name: 'Romanian Deadlift', muscleGroup: 'HAMSTRINGS' }),
];

describe('ExercisesView search (issue #238)', () => {
  it('shows every exercise when the query is empty', () => {
    render(<ExercisesView exercises={exercises} />);
    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.getByText('Romanian Deadlift')).toBeInTheDocument();
  });

  it('narrows the list to name matches, case-insensitively', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} />);
    await user.type(screen.getByLabelText('Search exercises by name'), 'squat');
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.queryByText('Barbell Bench Press')).not.toBeInTheDocument();
    expect(screen.queryByText('Romanian Deadlift')).not.toBeInTheDocument();
  });

  it('shows a no-match empty state when nothing matches', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} />);
    await user.type(screen.getByLabelText('Search exercises by name'), 'zzz');
    expect(screen.getByText('No exercises match')).toBeInTheDocument();
    expect(screen.queryByText('Back Squat')).not.toBeInTheDocument();
  });

  describe('in Turkish (follow-up to #537)', () => {
    const turkish: Exercise[] = [
      exercise({ id: 't1', name: 'Jump rope', muscleGroup: 'OTHER' }),
      exercise({ id: 't2', name: 'Incline Flys · Dumbbells', muscleGroup: 'CHEST' }),
      exercise({ id: 't3', name: 'Back Squat', muscleGroup: 'QUADS' }),
    ];

    beforeEach(() => {
      vi.spyOn(nextIntl, 'useLocale').mockReturnValue('tr');
    });

    it('finds a name with a dotted capital I from a lowercase query', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ExercisesView exercises={turkish} />);
      expect(screen.getByText('İp atlama')).toBeInTheDocument();
      await user.type(screen.getByRole('searchbox'), 'ip atlama');
      expect(screen.getByText('İp atlama')).toBeInTheDocument();
      expect(screen.queryByText('Incline fly · Dambıl')).not.toBeInTheDocument();
    });

    it('finds "Incline" names when Turkish lowercasing gives a dotless i', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ExercisesView exercises={turkish} />);
      await user.type(screen.getByRole('searchbox'), 'incline');
      expect(screen.getByText('Incline fly · Dambıl')).toBeInTheDocument();
      expect(screen.queryByText('İp atlama')).not.toBeInTheDocument();
    });

    it('ignores accents in the query', async () => {
      const user = userEvent.setup({ delay: null });
      render(<ExercisesView exercises={turkish} />);
      await user.type(screen.getByRole('searchbox'), 'dambil');
      expect(screen.getByText('Incline fly · Dambıl')).toBeInTheDocument();
    });
  });

  it('restores the full list when the query is cleared', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={exercises} />);
    const input = screen.getByLabelText('Search exercises by name');
    await user.type(input, 'squat');
    expect(screen.queryByText('Barbell Bench Press')).not.toBeInTheDocument();
    await user.clear(input);
    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Romanian Deadlift')).toBeInTheDocument();
  });

  it('renders the catalog-empty state and no search box when there are no exercises', () => {
    render(<ExercisesView exercises={[]} />);
    expect(screen.getByText('No exercises')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search exercises by name')).not.toBeInTheDocument();
  });
});

describe('ExercisesView catalog card at mobile width (issue #330)', () => {
  it('renders the full name in a wrapping (not truncating) element', () => {
    render(
      <ExercisesView
        exercises={[exercise({ id: 'e1', name: 'Incline dumbbell bench press with a pause' })]}
      />,
    );
    const name = screen.getByText('Incline dumbbell bench press with a pause');
    expect(name).toHaveClass('line-clamp-2');
    expect(name).not.toHaveClass('truncate');
  });

  it('labels the equipment with the compact form, not the long badge text', () => {
    render(<ExercisesView exercises={[exercise({ id: 'e1', equipmentType: 'OTHER' })]} />);
    // Equipment and rest form one non-wrapping unit, so the separator cannot orphan.
    const label = screen.getByText('Any equipment');
    expect(label.parentElement).toHaveClass('whitespace-nowrap');
    expect(label.parentElement).toHaveTextContent('Any equipment · rest 120s');
    expect(screen.queryByText('Other / unrestricted')).not.toBeInTheDocument();
  });

  it('gives every card the same fixed-size technique slot, with or without media', () => {
    render(
      <ExercisesView
        exercises={[
          exercise({ id: 'e1', name: 'Barbell Bench Press' }),
          exercise({ id: 'e2', name: 'Future custom movement' }),
        ]}
      />,
    );
    const withMedia = screen.getByRole('button', {
      name: 'View technique for Barbell Bench Press',
    });
    const withoutMedia = screen.getByRole('button', {
      name: 'View technique for Future custom movement',
    });
    for (const slot of [withMedia, withoutMedia]) {
      expect(slot).toHaveClass('size-16');
      expect(slot).toHaveClass('min-h-tap');
      expect(slot).toHaveClass('min-w-tap');
    }
    // The slot shows the start frame when the catalog knows the exercise and
    // stays the same size (icon only) when it does not.
    expect(withMedia.querySelector('img')).not.toBeNull();
    expect(withoutMedia.querySelector('img')).toBeNull();
  });
});

describe('ExercisesView favourites (issue #404)', () => {
  const catalog = [
    exercise({ id: 'e1', name: 'Barbell Bench Press', muscleGroup: 'CHEST' }),
    exercise({ id: 'e2', name: 'Back Squat', muscleGroup: 'QUADS', isFavorite: true }),
    exercise({ id: 'e3', name: 'Romanian Deadlift', muscleGroup: 'HAMSTRINGS' }),
  ];

  it('pins favourites in their own section at the top, not repeated below', () => {
    render(<ExercisesView exercises={catalog} />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Favourites');
    const favorites = screen.getByRole('region', { name: 'Favourites' });
    expect(within(favorites).getByText('Back Squat')).toBeInTheDocument();
    expect(within(favorites).queryByText('Barbell Bench Press')).not.toBeInTheDocument();
    expect(screen.getAllByText('Back Squat')).toHaveLength(1);
    expect(headings).not.toContain('Quads');
  });

  it('shows no favourites section when nothing is starred', () => {
    render(<ExercisesView exercises={exercises} />);
    expect(screen.queryByRole('region', { name: 'Favourites' })).not.toBeInTheDocument();
  });

  it('stars an exercise through PATCH and moves it to the favourites section at once', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={catalog} />);

    const star = screen.getByRole('button', { name: 'Add Barbell Bench Press to favourites' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await user.click(star);

    expect(fetchMock).toHaveBeenCalledWith('/api/exercises/e1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite: true }),
    });
    const favorites = screen.getByRole('region', { name: 'Favourites' });
    expect(within(favorites).getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove Barbell Bench Press from favourites' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('puts the star back and says so when the save fails, offline included', async () => {
    for (const failure of [
      vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response),
      vi.fn().mockRejectedValue(new TypeError('offline')),
    ]) {
      vi.stubGlobal('fetch', failure);
      const user = userEvent.setup({ delay: null });
      const { unmount } = render(<ExercisesView exercises={catalog} />);

      await user.click(screen.getByRole('button', { name: 'Remove Back Squat from favourites' }));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Could not update your favourites.'),
      );
      expect(
        within(screen.getByRole('region', { name: 'Favourites' })).getByText('Back Squat'),
      ).toBeInTheDocument();
      expect(router.refresh).not.toHaveBeenCalled();
      unmount();
      vi.clearAllMocks();
    }
  });

  it('keeps focus on the star after its row moves to the favourites section', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response));
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={catalog} />);

    await user.click(screen.getByRole('button', { name: 'Add Barbell Bench Press to favourites' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Remove Barbell Bench Press from favourites' }),
      ),
    );
  });

  it('ignores a second tap on a star while its save is in flight', async () => {
    let resolve: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={catalog} />);

    await user.click(screen.getByRole('button', { name: 'Add Barbell Bench Press to favourites' }));
    const pending = screen.getByRole('button', {
      name: 'Remove Barbell Bench Press from favourites',
    });
    expect(pending).toHaveAttribute('aria-disabled', 'true');
    await user.click(pending);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve({ ok: true, status: 200 } as Response);
    await waitFor(() => expect(pending).not.toHaveAttribute('aria-disabled'));
  });

  it('ignores a tap on the neighbouring star that slid under the finger', async () => {
    let resolve: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={catalog} />);

    await user.click(screen.getByRole('button', { name: 'Add Barbell Bench Press to favourites' }));
    const neighbour = screen.getByRole('button', {
      name: 'Add Romanian Deadlift to favourites',
    });
    expect(neighbour).toHaveAttribute('aria-disabled', 'true');
    await user.click(neighbour);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve({ ok: true, status: 200 } as Response);
    await waitFor(() => expect(neighbour).not.toHaveAttribute('aria-disabled'));
  });

  it('releases the guard when the save throws (offline)', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={catalog} />);

    await user.click(screen.getByRole('button', { name: 'Add Barbell Bench Press to favourites' }));
    const star = await screen.findByRole('button', {
      name: 'Add Barbell Bench Press to favourites',
    });
    await waitFor(() => expect(star).not.toHaveAttribute('aria-disabled'));
  });

  it('restores the star shown before a failed tap, not the stale server value', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ delay: null });
    // The refreshed list never arrives here, so the prop still says unstarred.
    render(<ExercisesView exercises={catalog} />);

    await user.click(screen.getByRole('button', { name: 'Add Barbell Bench Press to favourites' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    await user.click(
      screen.getByRole('button', { name: 'Remove Barbell Bench Press from favourites' }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not update your favourites.'),
    );
    expect(
      within(screen.getByRole('region', { name: 'Favourites' })).getByText('Barbell Bench Press'),
    ).toBeInTheDocument();
  });

  it('hides a favourite that does not match the search', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ExercisesView exercises={catalog} />);

    await user.type(screen.getByRole('searchbox'), 'bench');
    expect(screen.queryByText('Back Squat')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Favourites' })).not.toBeInTheDocument();
    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
  });
});
