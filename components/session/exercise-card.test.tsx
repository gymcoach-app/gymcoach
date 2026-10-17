import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { READINESS_RECENCY_HOURS, type ReadinessSignal } from '@/lib/progression';
import { ExerciseCard } from './exercise-card';
import type { SerializedLastPerformance } from './session-runner';

const exo: Exercise = {
  id: 'e1',
  userId: 'u',
  name: 'Squat',
  muscleGroup: 'QUADS',
  category: 'COMPOUND',
  defaultRestSec: 120,
  notes: null,
  usesBodyweight: false,
  equipmentType: 'BARBELL',
  isFavorite: false,
  createdAt: new Date(),
};

const pe: ProgramExercise & { exercise: Exercise } = {
  id: 'pe',
  workoutId: 'w',
  exerciseId: 'e1',
  order: 1,
  targetSets: 3,
  targetRepsMin: 6,
  targetRepsMax: 10,
  targetRIR: 2,
  restSec: 120,
  tempo: null,
  notes: null,
  supersetGroup: null,
  autoregulationMode: 'PRESERVE_RIR',
  fatigueRate: null,
  loadAdjustmentPct: null,
  exercise: exo,
};

// Last session: every working set hit the top of the rep range, so the base
// rule wants to progress (+2.5 kg). Readiness can then hold or step that down.
const lastPerf: SerializedLastPerformance = {
  sessionStartedAt: new Date().toISOString(),
  sets: [
    { weight: 100, reps: 10, rir: 1 },
    { weight: 100, reps: 10, rir: 1 },
    { weight: 100, reps: 10, rir: 1 },
  ],
  maxWeight: 100,
  repsAtMaxWeight: 10,
  cardio: null,
};

function renderCard(readiness: ReadinessSignal | null, deloadActive = false) {
  return render(
    <ExerciseCard
      programExercise={pe}
      lastPerformance={lastPerf}
      readiness={readiness}
      deloadActive={deloadActive}
      unit="KG"
    />,
  );
}

describe('ExerciseCard last done line (issue #459)', () => {
  function renderLastDone(lastDoneDaysAgo: number | null | undefined) {
    return render(
      <ExerciseCard
        programExercise={pe}
        lastPerformance={lastDoneDaysAgo == null ? undefined : lastPerf}
        lastDoneDaysAgo={lastDoneDaysAgo}
        readiness={null}
        deloadActive={false}
        unit="KG"
      />,
    );
  }

  it.each([
    [0, 'Last done today'],
    [1, 'Last done yesterday'],
    [2, 'Last done 2 days ago'],
    [45, 'Last done 45 days ago'],
  ])('shows %i calendar days as "%s"', (days, text) => {
    renderLastDone(days);
    expect(screen.getByTestId('exercise-last-done')).toHaveTextContent(text);
  });

  it('says never when the exercise has no previous working set', () => {
    renderLastDone(null);
    expect(screen.getByTestId('exercise-last-done')).toHaveTextContent('Never done before');
  });

  it('shows no line when the caller passes no last-done information', () => {
    renderLastDone(undefined);
    expect(screen.queryByTestId('exercise-last-done')).not.toBeInTheDocument();
  });
});

describe('ExerciseCard mobile title layout', () => {
  it('keeps a long exercise title on one horizontally scrollable line', () => {
    const longName = 'An exceptionally long incline dumbbell press exercise name';
    const longExercise = { ...exo, name: longName };
    const longProgramExercise = { ...pe, exercise: longExercise };

    render(
      <ExerciseCard
        programExercise={longProgramExercise}
        lastPerformance={lastPerf}
        readiness={null}
        deloadActive={false}
        unit="KG"
      />,
    );

    expect(screen.getByTestId('exercise-title-scroll')).toHaveClass('overflow-x-auto');
    expect(screen.getByRole('heading', { level: 2, name: longName })).toHaveClass(
      'w-max',
      'whitespace-nowrap',
    );
  });
});

describe('ExerciseCard actions button', () => {
  it('is a full tap target next to the scrollable title', () => {
    render(
      <ExerciseCard
        programExercise={pe}
        lastPerformance={lastPerf}
        readiness={null}
        deloadActive={false}
        unit="KG"
        onOpenMenu={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Exercise actions' })).toHaveClass(
      'min-h-tap',
      'min-w-tap',
      'shrink-0',
    );
    expect(screen.getByTestId('exercise-title-scroll')).toHaveClass('min-w-0', 'flex-1');
  });

  it('stays in the header but disabled while the menu is unavailable', () => {
    const onOpenMenu = vi.fn();
    const props = {
      programExercise: pe,
      lastPerformance: lastPerf,
      readiness: null,
      deloadActive: false,
      unit: 'KG' as const,
      onOpenMenu,
    };
    const view = render(<ExerciseCard {...props} menuDisabled />);

    // Same box as in input mode, so the header height does not change.
    const resting = screen.getByRole('button', { name: 'Exercise actions' });
    expect(resting).toBeDisabled();
    expect(resting).toHaveClass('min-h-tap', 'min-w-tap');
    fireEvent.click(resting);
    expect(onOpenMenu).not.toHaveBeenCalled();

    view.rerender(<ExerciseCard {...props} />);
    const active = screen.getByRole('button', { name: 'Exercise actions' });
    expect(active).toBeEnabled();
    fireEvent.click(active);
    expect(onOpenMenu).toHaveBeenCalledOnce();
  });
});

describe('ExerciseCard readiness explainer', () => {
  it('shows no readiness note when there is no check-in (unchanged UI)', () => {
    renderCard(null);
    expect(screen.queryByText(/Held -/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lighter -/)).not.toBeInTheDocument();
  });

  it('shows a "Held" note when readiness holds the load', () => {
    // readiness 2 -> hold (no progression), but not a deload.
    renderCard({ readiness: 2, soreness: null, ageHours: 1 });
    expect(screen.getByText('Held - low readiness today')).toBeInTheDocument();
    expect(screen.queryByText(/Lighter -/)).not.toBeInTheDocument();
  });

  it('shows a "Lighter" note when readiness steps the load down', () => {
    // readiness 1 -> deload (step-down).
    renderCard({ readiness: 1, soreness: null, ageHours: 1 });
    expect(screen.getByText('Lighter - low readiness today')).toBeInTheDocument();
  });

  it('names reported soreness as the cause when soreness drives the hold', () => {
    // Good overall readiness but the trained muscle is sore -> hold via soreness.
    renderCard({ readiness: 5, soreness: { QUADS: 4 }, ageHours: 1 });
    expect(screen.getByText('Held - reported soreness')).toBeInTheDocument();
  });

  it('shows no note when the check-in is stale (out of the recency window)', () => {
    renderCard({ readiness: 1, soreness: null, ageHours: READINESS_RECENCY_HOURS + 1 });
    expect(screen.queryByText(/Held -/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lighter -/)).not.toBeInTheDocument();
  });

  it('explains the planned deload week when one is active', () => {
    // No readiness signal at all: the planned deload alone drives the note,
    // and the suggested load steps down 10% from the 100 kg working weight.
    renderCard(null, true);
    expect(screen.getByText('Lighter - planned deload week')).toBeInTheDocument();
    expect(screen.getByText('90 kg')).toBeInTheDocument();
  });
});

// Issue #224: the exercise's own notes/cue is surfaced as an always-visible
// muted line under the header (the form reminder while logging), distinct from
// the per-set quick-note field and the collapsible program-notes block.
describe('ExerciseCard exercise cue', () => {
  const CUE = 'keep elbows tucked, pause 1s at the bottom';

  function renderWithExoNotes(notes: string | null, category: Exercise['category'] = 'COMPOUND') {
    const exoWithNotes: Exercise = { ...exo, notes, category };
    const peWithNotes: ProgramExercise & { exercise: Exercise } = {
      ...pe,
      exercise: exoWithNotes,
    };
    return render(
      <ExerciseCard
        programExercise={peWithNotes}
        lastPerformance={lastPerf}
        readiness={null}
        deloadActive={false}
        unit="KG"
      />,
    );
  }

  it('shows the cue line when the exercise has notes', () => {
    renderWithExoNotes(CUE);
    expect(screen.getByText(CUE)).toBeInTheDocument();
  });

  it('shows nothing (no empty element) when the exercise has no notes', () => {
    renderWithExoNotes(null);
    expect(screen.queryByText(CUE)).not.toBeInTheDocument();
    // No collapsible notes block either when neither program nor exercise notes
    // exist (this card's pe.notes is null).
    expect(screen.queryByText(/Notes \/ mind-muscle cue/)).not.toBeInTheDocument();
  });

  it('shows the cue for a cardio exercise too', () => {
    renderWithExoNotes(CUE, 'CARDIO');
    expect(screen.getByText(CUE)).toBeInTheDocument();
  });
});

// Issue #176: a cardio exercise with prior history shows a "Last session"
// reference (duration / distance / avgHr) instead of a load. The strength
// branch above pins that strength cards are unchanged.
const cardioExo: Exercise = { ...exo, id: 'c1', name: 'Running', category: 'CARDIO' };
const cardioPe: ProgramExercise & { exercise: Exercise } = {
  ...pe,
  exerciseId: 'c1',
  exercise: cardioExo,
};

function renderCardioCard(cardio: SerializedLastPerformance['cardio'] | undefined) {
  const lastPerformance: SerializedLastPerformance | undefined =
    cardio === undefined
      ? undefined
      : {
          sessionStartedAt: new Date().toISOString(),
          sets: [{ weight: 0, reps: 1, rir: null }],
          maxWeight: 0,
          repsAtMaxWeight: 1,
          cardio,
        };
  return render(
    <ExerciseCard
      programExercise={cardioPe}
      lastPerformance={lastPerformance}
      readiness={null}
      deloadActive={false}
      unit="KG"
    />,
  );
}

describe('ExerciseCard cardio last-performance', () => {
  it('shows duration, distance and avgHr for a cardio exercise with history', () => {
    renderCardioCard({ durationSec: 1800, distanceM: 5000, avgHr: 152 });
    expect(screen.getByText(/Last session/)).toBeInTheDocument();
    expect(screen.getByText('30:00 · 5 km · 152 bpm')).toBeInTheDocument();
  });

  it('omits distance and bpm for a duration-only cardio set', () => {
    renderCardioCard({ durationSec: 1500, distanceM: 0, avgHr: null });
    expect(screen.getByText('25:00')).toBeInTheDocument();
    expect(screen.queryByText(/bpm/)).not.toBeInTheDocument();
    expect(screen.queryByText(/km/)).not.toBeInTheDocument();
  });

  it('shows nothing (no crash) for a cardio exercise with no prior history', () => {
    renderCardioCard(undefined);
    expect(screen.queryByText(/Last session/)).not.toBeInTheDocument();
  });

  it('shows nothing when the last session for the exercise had no cardio set', () => {
    // Defensive: a strength record on a cardio-categorized card must not render
    // a misleading load line; the cardio branch gates on the cardio totals.
    renderCardioCard(null);
    expect(screen.queryByText(/Last session/)).not.toBeInTheDocument();
  });
});
