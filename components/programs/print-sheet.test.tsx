// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PrintSheetExerciseInput } from '@/lib/print-sheet';
import { PrintSheet, type PrintSheetLabels } from './print-sheet';

const labels: PrintSheetLabels = {
  date: 'Date',
  exercise: 'Exercise',
  plan: 'Plan',
  set: (n) => `Set ${n}`,
  weight: 'kg',
  reps: 'Reps',
  rir: 'RIR',
  duration: 'Duration',
  distance: 'Distance',
  notes: 'Notes',
  planLine: ({ sets, min, max, rir }) => `${sets} x ${min}-${max} reps, RIR ${rir}`,
  rest: (seconds) => `Rest ${seconds}s`,
  tempo: (tempo) => `Tempo ${tempo}`,
  cardio: 'Cardio',
  empty: 'No exercises in this session.',
};

function pe(
  id: string,
  name: string,
  order: number,
  targetSets: number,
  extra: Partial<PrintSheetExerciseInput> = {},
): PrintSheetExerciseInput {
  return {
    id,
    order,
    supersetGroup: null,
    exercise: { name },
    targetSets,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetRIR: 2,
    restSec: 90,
    tempo: null,
    notes: null,
    ...extra,
  };
}

describe('PrintSheet', () => {
  it('renders every exercise with weight, reps and RIR empty cells per planned set', () => {
    const { container } = render(
      <PrintSheet
        programName="Hypertrophy block"
        workout={{
          id: 'w1',
          name: 'Upper A',
          exercises: [
            pe('a', 'Bench Press', 1, 4, { notes: 'Pause on the chest', tempo: '3-1-1' }),
            pe('b', 'Barbell Row', 2, 3),
            pe('c', 'Face Pull', 3, 2),
          ],
        }}
        labels={labels}
        exerciseName={(name) => name.toUpperCase()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Upper A' })).toBeInTheDocument();
    expect(screen.getByText('Hypertrophy block')).toBeInTheDocument();
    expect(screen.getByText('BENCH PRESS')).toBeInTheDocument();
    expect(screen.getByText('BARBELL ROW')).toBeInTheDocument();
    expect(screen.getByText('FACE PULL')).toBeInTheDocument();
    expect(screen.getByText('4 x 8-12 reps, RIR 2')).toBeInTheDocument();
    expect(screen.getByText('Pause on the chest')).toBeInTheDocument();
    expect(screen.getByText('Tempo 3-1-1')).toBeInTheDocument();

    // (4 + 3 + 2) sets x 3 cells, and one set column per widest exercise.
    expect(container.querySelectorAll('[data-print-cell]')).toHaveLength(27);
    expect(container.querySelectorAll('[data-print-cell="weight"]')).toHaveLength(9);
    expect(screen.getAllByRole('columnheader', { name: /^Set \d$/ })).toHaveLength(4);
    // The narrower exercises leave their extra set columns blank, not padded.
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[2]?.querySelectorAll('[data-print-cell]')).toHaveLength(6);
  });

  it('shows superset labels and an empty-session message', () => {
    render(
      <PrintSheet
        programName="Block"
        workout={{
          id: 'w2',
          name: 'Arms',
          exercises: [
            pe('a', 'Curl', 1, 3, { supersetGroup: 2 }),
            pe('b', 'Pushdown', 2, 3, { supersetGroup: 2 }),
          ],
        }}
        labels={labels}
        exerciseName={(name) => name}
      />,
    );
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('A2')).toBeInTheDocument();

    render(
      <PrintSheet
        programName="Block"
        workout={{ id: 'w3', name: 'Rest day', exercises: [] }}
        labels={labels}
        exerciseName={(name) => name}
      />,
    );
    expect(screen.getByText('No exercises in this session.')).toBeInTheDocument();
  });
});

describe('PrintSheet cardio rows (issue #558)', () => {
  it('prints the duration and distance target instead of sets, reps and rest', () => {
    render(
      <PrintSheet
        programName="Block"
        workout={{
          id: 'w4',
          name: 'Conditioning',
          exercises: [
            pe('a', 'Bench Press', 1, 3, {
              exercise: { name: 'Bench Press', category: 'COMPOUND' },
            }),
            pe('b', 'Running', 2, 1, {
              exercise: { name: 'Running', category: 'CARDIO' },
              targetRepsMin: 1,
              targetRepsMax: 1,
              restSec: 120,
              tempo: '3-1-1',
              targetDurationSec: 1200,
              targetDistanceM: 5000,
            }),
          ],
        }}
        labels={labels}
        exerciseName={(name) => name}
      />,
    );

    expect(screen.getByText('20 min · 5 km')).toBeInTheDocument();
    // The strength row keeps its plan; the cardio row has none of it.
    expect(screen.getByText('3 x 8-12 reps, RIR 2')).toBeInTheDocument();
    expect(screen.getByText('Rest 90s')).toBeInTheDocument();
    expect(screen.queryByText('1 x 1-1 reps, RIR 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Rest 120s')).not.toBeInTheDocument();
    expect(screen.queryByText('Tempo 3-1-1')).not.toBeInTheDocument();
  });

  // Issue #576: the boxes of a cardio row are what is logged for cardio.
  it('draws duration and distance boxes for a cardio row, with the target pre-printed', () => {
    const { container } = render(
      <PrintSheet
        programName="Block"
        workout={{
          id: 'w6',
          name: 'Conditioning',
          exercises: [
            pe('a', 'Bench Press', 1, 3, {
              exercise: { name: 'Bench Press', category: 'COMPOUND' },
            }),
            pe('b', 'Running', 2, 1, {
              exercise: { name: 'Running', category: 'CARDIO' },
              targetDurationSec: 1200,
              targetDistanceM: 5000,
            }),
            pe('c', 'Rowing', 3, 1, { exercise: { name: 'Rowing', category: 'CARDIO' } }),
          ],
        }}
        labels={labels}
        exerciseName={(name) => name}
      />,
    );

    const rows = container.querySelectorAll('tbody tr');
    const kinds = (row: Element | undefined) =>
      Array.from(row?.querySelectorAll('[data-print-cell]') ?? []).map((cell) =>
        cell.getAttribute('data-print-cell'),
      );
    // Strength: weight, reps and RIR per set, as before.
    expect(kinds(rows[0])).toEqual([
      'weight',
      'reps',
      'rir',
      'weight',
      'reps',
      'rir',
      'weight',
      'reps',
      'rir',
    ]);
    // Cardio: one duration and one distance box, no strength box.
    expect(kinds(rows[1])).toEqual(['duration', 'distance']);
    expect(kinds(rows[2])).toEqual(['duration', 'distance']);

    const running = rows[1]!.querySelectorAll('[data-print-cell]');
    expect(running[0]).toHaveTextContent('Duration');
    expect(running[0]?.querySelector('[data-print-target]')).toHaveTextContent('20 min');
    expect(running[1]).toHaveTextContent('Distance');
    expect(running[1]?.querySelector('[data-print-target]')).toHaveTextContent('5 km');
    // No target: the boxes are labelled and empty.
    expect(rows[2]!.querySelectorAll('[data-print-target]')).toHaveLength(0);
    expect(rows[2]!.querySelectorAll('[data-print-cell]')[0]).toHaveTextContent(/^Duration$/);
  });

  it('keeps the markup of a strength row identical when a cardio row is added', () => {
    const bench = pe('a', 'Bench Press', 1, 3, {
      exercise: { name: 'Bench Press', category: 'COMPOUND' },
    });
    const sheet = (exercises: PrintSheetExerciseInput[]) =>
      render(
        <PrintSheet
          programName="Block"
          workout={{ id: 'w7', name: 'Mixed', exercises }}
          labels={labels}
          exerciseName={(name) => name}
        />,
      ).container.querySelector('tbody tr')?.outerHTML;

    const alone = sheet([bench]);
    const mixed = sheet([
      bench,
      pe('b', 'Running', 2, 1, {
        exercise: { name: 'Running', category: 'CARDIO' },
        targetDurationSec: 1200,
      }),
    ]);
    expect(alone).toBeDefined();
    expect(mixed).toBe(alone);
  });

  it('writes the cardio target in the locale it is given', () => {
    render(
      <PrintSheet
        programName="Block"
        workout={{
          id: 'w8',
          name: 'Conditioning',
          exercises: [
            pe('b', 'Running', 1, 1, {
              exercise: { name: 'Running', category: 'CARDIO' },
              targetDurationSec: 1200,
              targetDistanceM: 2500,
            }),
          ],
        }}
        labels={labels}
        exerciseName={(name) => name}
        format={{ locale: 'de' }}
      />,
    );
    expect(screen.getByText('20 Min. · 2,5 km')).toBeInTheDocument();
  });

  it('prints a neutral label for a cardio exercise without a target', () => {
    render(
      <PrintSheet
        programName="Block"
        workout={{
          id: 'w5',
          name: 'Conditioning',
          exercises: [
            pe('b', 'Running', 1, 1, {
              exercise: { name: 'Running', category: 'CARDIO' },
              targetRepsMin: 1,
              targetRepsMax: 1,
            }),
          ],
        }}
        labels={labels}
        exerciseName={(name) => name}
      />,
    );

    expect(screen.getByText('Cardio')).toBeInTheDocument();
    expect(screen.queryByText(/reps, RIR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Rest /)).not.toBeInTheDocument();
  });
});
