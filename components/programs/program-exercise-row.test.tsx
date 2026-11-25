// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProgramExerciseRow } from './program-exercise-row';

// Cardio target in the program editor (issue #558, slice 1): a cardio exercise
// reads as its duration and distance, never as sets, reps, RIR and rest.

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type RowProps = Parameters<typeof ProgramExerciseRow>[0];
type Row = RowProps['programExercise'];

function row(category: 'COMPOUND' | 'CARDIO', extra: Record<string, unknown> = {}): Row {
  return {
    id: 'pe1',
    workoutId: 'w1',
    exerciseId: 'ex1',
    order: 1,
    targetSets: 1,
    targetRepsMin: 1,
    targetRepsMax: 1,
    targetRIR: 1,
    restSec: 120,
    tempo: null,
    notes: null,
    supersetGroup: null,
    autoregulationMode: 'PRESERVE_RIR',
    fatigueRate: null,
    loadAdjustmentPct: null,
    targetDurationSec: null,
    targetDistanceM: null,
    exercise: { id: 'ex1', name: 'Running', muscleGroup: 'OTHER', category },
    ...extra,
  } as unknown as Row;
}

function prescription(): string {
  return document.querySelector('[data-prescription]')?.textContent ?? '';
}

describe('ProgramExerciseRow prescription (issue #558)', () => {
  it('reads a cardio exercise with a duration target as "20 min"', () => {
    render(
      <ProgramExerciseRow
        programExercise={row('CARDIO', { targetDurationSec: 1200 })}
        catalog={[]}
      />,
    );
    expect(prescription()).toBe('20 min');
    expect(screen.queryByText(/sets|reps|RIR|rest/)).not.toBeInTheDocument();
  });

  it('adds the distance when the target has one', () => {
    render(
      <ProgramExerciseRow
        programExercise={row('CARDIO', { targetDurationSec: 1200, targetDistanceM: 5000 })}
        catalog={[]}
      />,
    );
    expect(prescription()).toBe('20 min · 5 km');
  });

  it('shows a neutral label, not the strength line, for a cardio exercise without a target', () => {
    render(<ProgramExerciseRow programExercise={row('CARDIO')} catalog={[]} />);
    expect(prescription()).toBe('Cardio - no target set');
    expect(screen.queryByText(/sets|reps|RIR|rest/)).not.toBeInTheDocument();
  });

  it('ignores the tempo and the autoregulation badge on a cardio exercise', () => {
    render(
      <ProgramExerciseRow
        programExercise={row('CARDIO', { targetDurationSec: 1200, tempo: '3-1-1' })}
        catalog={[]}
      />,
    );
    expect(prescription()).toBe('20 min');
    expect(screen.queryByText('RIR auto')).not.toBeInTheDocument();
  });

  it('keeps the strength prescription of a strength exercise unchanged', () => {
    render(
      <ProgramExerciseRow
        programExercise={row('COMPOUND', {
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetRIR: 2,
          restSec: 90,
          tempo: '3-1-1',
        })}
        catalog={[]}
      />,
    );
    expect(prescription()).toBe('3 sets × 8-12 reps · RIR 2 · rest 90s · tempo 3-1-1');
    expect(screen.getByText('RIR auto')).toBeInTheDocument();
  });
});
