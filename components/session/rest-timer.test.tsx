import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RestTimer } from '@/components/session/rest-timer';
import { EffortScaleProvider } from '@/components/shared/effort-scale-provider';

vi.mock('@/lib/sound', () => ({ playRestEndBeep: vi.fn() }));

function renderTimer(props: Partial<Parameters<typeof RestTimer>[0]> = {}) {
  const handlers = {
    onEnd: vi.fn(),
    onSkip: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onAdjust: vi.fn(),
  };
  render(
    <RestTimer
      endsAt={Date.now() + 120_000}
      totalSec={120}
      nextLabel={null}
      unit="KG"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RestTimer next-set recommendation', () => {
  it('shows the automatically calculated next set during rest', () => {
    renderTimer({
      nextLabel: 'Back Squat',
      recommendation: {
        mode: 'PRESERVE_REPS',
        weight: 97.5,
        reps: 12,
        rir: 2,
        reason: 'reduce-load',
        predictedRepsAtSameLoad: 11,
        fatigueLoss: 1,
        confidence: 'medium',
      },
    });

    expect(screen.getByText(/97.5 kg/i)).toBeInTheDocument();
    expect(screen.getByText(/× 12 · RIR 2/i)).toBeInTheDocument();
  });
});

describe('RestTimer controls (issue #393)', () => {
  it('adjusts the rest by 15 s in either direction', () => {
    const { onAdjust } = renderTimer();

    fireEvent.click(screen.getByRole('button', { name: 'Add 15 seconds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove 15 seconds' }));

    expect(onAdjust.mock.calls).toEqual([[15_000], [-15_000]]);
  });

  it('offers pause while running and resume while paused', () => {
    const running = renderTimer();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(running.onPause).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it('shows the frozen time while paused and does not end at zero', () => {
    vi.useFakeTimers();
    const { onEnd, onResume } = renderTimer({
      endsAt: Date.now() - 5_000,
      pausedRemainingMs: 42_000,
    });

    expect(screen.getByText('Rest paused')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByTestId('rest-remaining')).toHaveTextContent('42');
    expect(onEnd).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('disables -15 s once no time is left', () => {
    renderTimer({ pausedRemainingMs: 0 });
    expect(screen.getByRole('button', { name: 'Remove 15 seconds' })).toBeDisabled();
  });

  it('ends a running rest once its time is up', () => {
    vi.useFakeTimers();
    const { onEnd } = renderTimer({ endsAt: Date.now() + 1_000 });

    act(() => {
      vi.advanceTimersByTime(1_200);
    });

    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('RestTimer effort scale (issue #390)', () => {
  it('shows the next-set effort as RPE when the lifter uses RPE', () => {
    render(
      <EffortScaleProvider scale="RPE">
        <RestTimer
          endsAt={Date.now() + 120_000}
          totalSec={120}
          nextLabel="Back Squat"
          unit="KG"
          onEnd={vi.fn()}
          onSkip={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onAdjust={vi.fn()}
          recommendation={{
            mode: 'PRESERVE_REPS',
            weight: 97.5,
            reps: 12,
            rir: 2,
            reason: 'reduce-load',
            predictedRepsAtSameLoad: 11,
            fatigueLoss: 1,
            confidence: 'medium',
          }}
        />
      </EffortScaleProvider>,
    );
    expect(screen.getByText(/× 12 · RPE 8/i)).toBeInTheDocument();
  });
});
