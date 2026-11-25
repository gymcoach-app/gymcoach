// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogPastWorkoutButton } from './log-past-workout-button';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// The dialog is seeded from the clock: noon on 2026-11-24, local time.
const NOW = new Date(2026, 10, 24, 12, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const HOME = { id: 'g-home', name: 'Home' };
const CLUB = { id: 'g-club', name: 'Club' };

function open(gyms: { id: string; name: string }[] = [], activeGymId: string | null = null) {
  render(
    <LogPastWorkoutButton
      workouts={[{ id: 'w1', name: 'PPL - Push' }]}
      gyms={gyms}
      activeGymId={activeGymId}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Log a past workout' }));
}

describe('LogPastWorkoutButton (issue #389)', () => {
  it('opens on a workout that ended just now, in local time', () => {
    open();
    expect(screen.getByLabelText('Date')).toHaveValue('2026-11-24');
    expect(screen.getByLabelText('Date')).toHaveAttribute('max', '2026-11-24');
    expect(screen.getByLabelText('Start time')).toHaveValue('11:00');
    expect(screen.getByLabelText('Duration (min)')).toHaveValue(60);
  });

  it('creates a freestyle session at the picked local time and opens its editor', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'past-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    open();

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-20' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '18:30' } });
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/history/past-1/edit'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions/past');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      workoutId: null,
      // The instant of 18:30 on the 20th in the browser's zone.
      startedAt: new Date(2026, 10, 20, 18, 30).toISOString(),
      durationMin: 75,
    });
  });

  it('creates the workout once when Continue is pressed twice in a row', async () => {
    let release: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    open();

    const submit = screen.getByRole('button', { name: 'Continue' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(new Response(JSON.stringify({ id: 'past-1' }), { status: 201 }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/history/past-1/edit'));
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('asks for the gym only with more than one, the active gym preselected, and sends it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'past-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    open([HOME, CLUB], CLUB.id);

    expect(screen.getByLabelText('Gym for this session')).toHaveTextContent('Club');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ gymId: CLUB.id });
  });

  it('preselects no gym without an active one, and says so to the server', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'past-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    open([HOME, CLUB], null);

    expect(screen.getByLabelText('Gym for this session')).toHaveTextContent('No gym');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toHaveProperty('gymId', null);
  });

  it('does not ask for the gym with one gym or none, and lets the server use the active one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'past-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    open([HOME], HOME.id);

    expect(screen.queryByLabelText('Gym for this session')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty('gymId');
  });

  it('refuses a future date before sending anything', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    open();

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(toast.error).toHaveBeenCalledWith('A workout cannot be in the future.');

    // Today, but it would end after now.
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-24' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '11:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(toast.error).toHaveBeenCalledTimes(2);

    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(toast.error).toHaveBeenLastCalledWith('Enter a valid date, time and duration.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the error toast when the server refuses, offline included', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not create the workout.'));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});
