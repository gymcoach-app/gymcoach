// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadinessCheckin } from './readiness-checkin';

// sonner's toast is a side effect we do not assert on here; stub it so the
// component can call it without a real toaster mounted.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function lastFetchBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe('ReadinessCheckin', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function openForm() {
    // delay: null removes user-event's per-keystroke/per-click setTimeout, which
    // is what stalls this suite under parallel CPU contention (issue #219). The
    // interactions are still driven through user-event, so the asserted behavior
    // is unchanged; only the artificial inter-event delay is dropped.
    const user = userEvent.setup({ delay: null });
    render(<ReadinessCheckin />);
    await user.click(
      screen.getByRole('button', { name: /readiness check-in \(optional\)/i }),
    );
    return user;
  }

  it('submits only readiness + sleep on the quick path (no soreness/note)', async () => {
    const user = await openForm();

    await user.click(screen.getByRole('button', { name: 'Overall readiness: 4' }));
    await user.click(screen.getByRole('button', { name: 'Sleep quality: 3' }));
    await user.click(screen.getByRole('button', { name: 'Save check-in' }));

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith('/api/readiness', expect.anything());
    expect(lastFetchBody(fetchMock)).toEqual({ readiness: 4, sleepQuality: 3 });
  });

  it('does not submit and warns when readiness or sleep is missing', async () => {
    const user = await openForm();
    await user.click(screen.getByRole('button', { name: 'Overall readiness: 4' }));
    await user.click(screen.getByRole('button', { name: 'Save check-in' }));

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the soreness/note section collapsed until the user opens it', async () => {
    await openForm();
    expect(screen.queryByText('Per-muscle soreness')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /add soreness \/ note \(optional\)/i }),
    ).toBeInTheDocument();
  });

  // Raised timeout as a belt-and-suspenders for the heaviest interaction case
  // (two soreness toggles + typing a note): even with delay:null the default 5s
  // budget can be eaten by scheduler contention when the whole suite runs in
  // parallel under load (issue #219). The assertion below is unchanged.
  it('submits a partial soreness map and a note when filled in', { timeout: 15000 }, async () => {
    const user = await openForm();

    await user.click(screen.getByRole('button', { name: 'Overall readiness: 5' }));
    await user.click(screen.getByRole('button', { name: 'Sleep quality: 4' }));
    await user.click(
      screen.getByRole('button', { name: /add soreness \/ note \(optional\)/i }),
    );

    // Rate only two groups; the rest stay unrated and must be absent.
    await user.click(screen.getByRole('button', { name: 'Chest soreness: 3' }));
    await user.click(screen.getByRole('button', { name: 'Quads soreness: 5' }));
    await user.type(screen.getByLabelText('Note'), 'Left shoulder tight.');
    await user.click(screen.getByRole('button', { name: 'Save check-in' }));

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(lastFetchBody(fetchMock)).toEqual({
      readiness: 5,
      sleepQuality: 4,
      soreness: { CHEST: 3, QUADS: 5 },
      note: 'Left shoulder tight.',
    });
  });

  it('clears a soreness rating when its current value is tapped again', async () => {
    const user = await openForm();

    await user.click(screen.getByRole('button', { name: 'Overall readiness: 2' }));
    await user.click(screen.getByRole('button', { name: 'Sleep quality: 2' }));
    await user.click(
      screen.getByRole('button', { name: /add soreness \/ note \(optional\)/i }),
    );

    const chest3 = screen.getByRole('button', { name: 'Chest soreness: 3' });
    await user.click(chest3); // set
    await user.click(chest3); // clear
    await user.click(screen.getByRole('button', { name: 'Save check-in' }));

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    // Empty soreness map must be omitted entirely, back to the quick payload.
    expect(lastFetchBody(fetchMock)).toEqual({ readiness: 2, sleepQuality: 2 });
  });
});
