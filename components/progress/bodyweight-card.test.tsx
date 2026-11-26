// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { fromDisplayWeight } from '@/lib/units';
import { BodyweightCard } from './bodyweight-card';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

function lastFetchCall(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
}

const entries = [
  { id: 'b2', weightKg: 81.2, measuredAt: '2026-06-08T08:00:00Z' },
  { id: 'b1', weightKg: 80, measuredAt: '2026-06-01T08:00:00Z' },
];

describe('BodyweightCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the current bodyweight from the newest entry', () => {
    render(<BodyweightCard entries={entries} unit="KG" />);
    expect(screen.getByText(/current: 81.2 kg/i)).toBeInTheDocument();
  });

  it('shows an empty state when nothing is logged yet', () => {
    render(<BodyweightCard entries={[]} unit="KG" />);
    expect(screen.getByText(/no bodyweight logged yet/i)).toBeInTheDocument();
  });

  it('posts the quick-add weight in kg, converting from the display unit (lb)', async () => {
    const user = userEvent.setup();
    render(<BodyweightCard entries={[]} unit="LB" />);

    await user.type(screen.getByLabelText(/bodyweight \(lb\)/i), '180');
    await user.click(screen.getByRole('button', { name: 'Log' }));

    const [url, init] = lastFetchCall(fetchMock);
    expect(url).toBe('/api/bodyweight');
    const body = JSON.parse(init?.body as string) as { weightKg: number };
    // 180 lb = 81.65 kg.
    expect(body.weightKg).toBeCloseTo(81.65, 1);
    expect(refresh).toHaveBeenCalled();
  });

  it('rejects an empty or non-positive weight without calling the API', async () => {
    const user = userEvent.setup();
    render(<BodyweightCard entries={[]} unit="KG" />);

    await user.click(screen.getByRole('button', { name: 'Log' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletes an entry through the API', async () => {
    const user = userEvent.setup();
    render(<BodyweightCard entries={entries} unit="KG" />);

    await user.click(
      screen.getAllByRole('button', { name: /delete entry/i })[0] as HTMLElement,
    );

    const [url, init] = lastFetchCall(fetchMock);
    expect(url).toBe('/api/bodyweight/b2');
    expect(init?.method).toBe('DELETE');
    expect(refresh).toHaveBeenCalled();
  });

  it('lists entries in the display unit', () => {
    render(<BodyweightCard entries={entries} unit="LB" />);
    // 80 kg = 176.4 lb.
    expect(screen.getByText(/176.4 lb/)).toBeInTheDocument();
  });

  describe('bodyweight goal (issue #398)', () => {
    it('shows the goal and colours the delta by the distance to the goal', () => {
      // The window went 80 -> 81.2 kg: good toward a higher goal...
      const { unmount } = render(<BodyweightCard entries={entries} unit="KG" goalKg={84} />);
      expect(screen.getByText(/goal: 84 kg/i)).toBeInTheDocument();
      const delta = screen.getByTestId('bodyweight-goal-delta');
      expect(delta).toHaveTextContent('2.8 kg to gain');
      expect(delta).toHaveAttribute('data-tone', 'good');
      // The trend is also spelled out, not only coloured.
      expect(delta).toHaveTextContent('(moving toward your goal)');
      unmount();

      // ...and bad toward a lower one.
      render(<BodyweightCard entries={entries} unit="KG" goalKg={76} />);
      const away = screen.getByTestId('bodyweight-goal-delta');
      expect(away).toHaveAttribute('data-tone', 'bad');
      expect(away).toHaveTextContent('5.2 kg to lose');
      expect(away).toHaveTextContent('(moving away from your goal)');
    });

    it('spells out a good trend when the weight crossed the goal', () => {
      // 80 -> 81.2 kg past a goal of 80.8: the weight went up, the gap is now
      // "to lose", yet the distance to the goal shrank (0.8 -> 0.4 kg).
      render(<BodyweightCard entries={entries} unit="KG" goalKg={80.8} />);
      const delta = screen.getByTestId('bodyweight-goal-delta');
      expect(delta).toHaveAttribute('data-tone', 'good');
      expect(delta).toHaveTextContent('0.4 kg to lose');
      expect(delta).toHaveTextContent('(moving toward your goal)');
    });

    it('displays a goal saved in pounds as the same number of pounds', () => {
      render(
        <BodyweightCard entries={entries} unit="LB" goalKg={fromDisplayWeight(165, 'LB')} />,
      );
      expect(screen.getByText(/goal: 165 lb/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/goal \(lb\)/i)).toHaveAttribute('placeholder', '165');
    });

    it('says when the goal is reached', () => {
      render(<BodyweightCard entries={entries} unit="KG" goalKg={81} />);
      expect(screen.getByTestId('bodyweight-goal-delta')).toHaveTextContent('Goal reached');
    });

    it('saves the goal in kg, converting from the display unit (lb)', async () => {
      const user = userEvent.setup();
      render(<BodyweightCard entries={entries} unit="LB" />);

      await user.type(screen.getByLabelText(/goal \(lb\)/i), '165');
      await user.click(screen.getByRole('button', { name: 'Set goal' }));

      const [url, init] = lastFetchCall(fetchMock);
      expect(url).toBe('/api/profile');
      expect(init?.method).toBe('PATCH');
      const body = JSON.parse(init?.body as string) as { bodyweightGoalKg: number };
      // 165 lb = 74.84 kg.
      expect(body.bodyweightGoalKg).toBeCloseTo(74.84, 1);
      expect(refresh).toHaveBeenCalled();
    });

    it('rejects a goal outside the bounds without calling the API', async () => {
      const user = userEvent.setup();
      render(<BodyweightCard entries={entries} unit="KG" />);

      await user.type(screen.getByLabelText(/goal \(kg\)/i), '5');
      await user.click(screen.getByRole('button', { name: 'Set goal' }));
      expect(fetchMock).not.toHaveBeenCalled();

      // Past the native min/max check, the kg check still refuses it.
      fireEvent.submit(screen.getByLabelText(/goal \(kg\)/i).closest('form') as HTMLFormElement);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Enter a goal between 20 and 300 kg.');
    });

    it('bounds the goal input by the real limits in the display unit', () => {
      const { unmount } = render(<BodyweightCard entries={entries} unit="KG" />);
      const kgInput = screen.getByLabelText(/goal \(kg\)/i);
      expect(kgInput).toHaveAttribute('min', '20');
      expect(kgInput).toHaveAttribute('max', '300');
      unmount();

      // 20 kg = 44.09 lb and 300 kg = 661.39 lb, rounded inward to 0.1.
      render(<BodyweightCard entries={entries} unit="LB" />);
      const lbInput = screen.getByLabelText(/goal \(lb\)/i);
      expect(lbInput).toHaveAttribute('min', '44.1');
      expect(lbInput).toHaveAttribute('max', '661.3');
    });

    it('shows the error toast when the goal write is refused or the network is down', async () => {
      const user = userEvent.setup();
      render(<BodyweightCard entries={entries} unit="KG" />);
      const input = screen.getByLabelText(/goal \(kg\)/i);

      fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
      await user.type(input, '75');
      await user.click(screen.getByRole('button', { name: 'Set goal' }));
      expect(toast.error).toHaveBeenLastCalledWith('Could not save the goal.');

      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await user.click(screen.getByRole('button', { name: 'Set goal' }));
      expect(toast.error).toHaveBeenCalledTimes(2);
      expect(toast.success).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it('removes the goal with a null write', async () => {
      const user = userEvent.setup();
      render(<BodyweightCard entries={entries} unit="KG" goalKg={76} />);

      await user.click(screen.getByRole('button', { name: 'Remove goal' }));
      const [url, init] = lastFetchCall(fetchMock);
      expect(url).toBe('/api/profile');
      expect(JSON.parse(init?.body as string)).toEqual({ bodyweightGoalKg: null });
    });

    it('shows no goal line or delta without a goal', () => {
      render(<BodyweightCard entries={entries} unit="KG" />);
      expect(screen.queryByTestId('bodyweight-goal-delta')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Remove goal' })).toBeNull();
    });
  });
});
