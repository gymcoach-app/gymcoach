import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutStartList } from './workout-start-list';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const workouts = [{ id: 'w1', name: 'Push day', day: 'Monday', exerciseCount: 5 }];

function freestyleCard() {
  return screen.getByText('Freestyle session').closest('li') as HTMLElement;
}

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
  toast.error.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 's9' }) } as Response),
  );
});

// Freestyle session (issue #388): the start list always ends with an entry
// that starts a session without a workout.
describe('WorkoutStartList freestyle entry', () => {
  it('offers the empty session after the workouts of the active program', () => {
    render(<WorkoutStartList workouts={workouts} gyms={[]} activeGymId={null} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Push day')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Freestyle session')).toBeInTheDocument();
    expect(
      within(items[1]!).getByRole('button', { name: 'Start empty session' }),
    ).toBeEnabled();
  });

  it('is the only entry when there is no program', () => {
    render(<WorkoutStartList workouts={[]} gyms={[]} activeGymId={null} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Start empty session' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start this session' })).not.toBeInTheDocument();
  });

  it('starts a session without a workout id and opens it', async () => {
    render(<WorkoutStartList workouts={workouts} gyms={[]} activeGymId={null} />);
    fireEvent.click(within(freestyleCard()).getByRole('button', { name: 'Start empty session' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/session/s9'));
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('/api/sessions');
    expect(init?.method).toBe('POST');
    // No workoutId key at all: JSON drops the undefined value.
    expect(JSON.parse(init?.body as string)).toEqual({ gymId: null });
  });

  it('sends the selected gym with the freestyle start', async () => {
    render(
      <WorkoutStartList
        workouts={[]}
        gyms={[
          { id: 'g1', name: 'Home' },
          { id: 'g2', name: 'Hotel' },
        ]}
        activeGymId="g2"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start empty session' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string)).toEqual({ gymId: 'g2' });
  });

  it('still sends the workout id from a workout card', async () => {
    render(<WorkoutStartList workouts={workouts} gyms={[]} activeGymId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start this session' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string)).toEqual({
      workoutId: 'w1',
      gymId: null,
    });
  });

  it('reports a failed start and stays on the page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));
    render(<WorkoutStartList workouts={[]} gyms={[]} activeGymId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start empty session' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not start the session.'));
    expect(router.push).not.toHaveBeenCalled();
  });
});
