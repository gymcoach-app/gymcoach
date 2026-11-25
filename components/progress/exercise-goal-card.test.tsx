// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseGoalCard } from './exercise-goal-card';

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

// 100x5 goal -> target e1RM 116.7; best e1RM 105 -> 90%.
const goal = {
  id: 'g1',
  targetWeight: 100,
  targetReps: 5,
  achievedAt: null,
};

function renderCard(over: Partial<Parameters<typeof ExerciseGoalCard>[0]> = {}) {
  return render(
    <ExerciseGoalCard
      exerciseId="e1"
      exerciseName="Squat"
      usesBodyweight={false}
      goal={goal}
      bestE1RM={105}
      unit="KG"
      {...over}
    />,
  );
}

describe('ExerciseGoalCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the target and the e1RM progress percentage', () => {
    renderCard();
    expect(screen.getByText(/target: 100 kg x 5 reps/i)).toBeInTheDocument();
    // 105 / 116.67 = 90%.
    expect(screen.getByText(/90% of the target/i)).toBeInTheDocument();
    expect(screen.queryByText('Achieved')).not.toBeInTheDocument();
  });

  it('shows the achieved badge once achievedAt is set', () => {
    renderCard({ goal: { ...goal, achievedAt: '2026-06-01T10:00:00Z' } });
    expect(screen.getByText('Achieved')).toBeInTheDocument();
  });

  it('offers to set a goal when none exists', () => {
    renderCard({ goal: null });
    expect(screen.getByText(/no goal set for this exercise/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set a goal' })).toBeInTheDocument();
  });

  it('posts the goal in kg, converting from the display unit (lb)', async () => {
    const user = userEvent.setup();
    renderCard({ goal: null, unit: 'LB' });

    await user.click(screen.getByRole('button', { name: 'Set a goal' }));
    await user.type(screen.getByLabelText(/target load/i), '225');
    await user.type(screen.getByLabelText(/target reps/i), '5');
    await user.click(screen.getByRole('button', { name: 'Save goal' }));

    const [url, init] = lastFetchCall(fetchMock);
    expect(url).toBe('/api/goals');
    const body = JSON.parse(init?.body as string) as {
      exerciseId: string;
      targetWeight: number;
      targetReps: number;
    };
    expect(body.exerciseId).toBe('e1');
    // 225 lb = 102.06 kg.
    expect(body.targetWeight).toBeCloseTo(102.06, 1);
    expect(body.targetReps).toBe(5);
    expect(refresh).toHaveBeenCalled();
  });

  it('deletes the goal through the API', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    const [url, init] = lastFetchCall(fetchMock);
    expect(url).toBe('/api/goals/g1');
    expect(init?.method).toBe('DELETE');
    expect(refresh).toHaveBeenCalled();
  });

  it('rejects an empty or non-positive target without calling the API', async () => {
    const user = userEvent.setup();
    renderCard({ goal: null });

    await user.click(screen.getByRole('button', { name: 'Set a goal' }));
    await user.click(screen.getByRole('button', { name: 'Save goal' }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mentions the effective-load semantics for bodyweight exercises', async () => {
    const user = userEvent.setup();
    renderCard({ goal: null, usesBodyweight: true });

    await user.click(screen.getByRole('button', { name: 'Set a goal' }));
    expect(screen.getByText(/total effective load/i)).toBeInTheDocument();
  });
});
