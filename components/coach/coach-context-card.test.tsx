// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CoachContextCard } from './coach-context-card';
import type { CoachContextSummary } from '@/lib/coach-context';

function emptySummary(): CoachContextSummary {
  return {
    goals: [],
    stalledExercises: [],
    deloadActive: false,
    deloadRecommended: false,
    deloadReasons: [],
    conditioning: {
      currentMinutes: 0,
      currentKm: 0,
      currentSessions: 0,
      weeklyTargetMin: 150,
    },
    readiness: null,
    weeksOfHistory: 0,
    exercisesTracked: 0,
  };
}

function fullSummary(): CoachContextSummary {
  return {
    goals: [
      {
        exerciseName: 'Bench Press',
        targetWeight: 100,
        targetReps: 5,
        progressPct: 82,
        achieved: false,
      },
      {
        exerciseName: 'Squat',
        targetWeight: 140,
        targetReps: 3,
        progressPct: 100,
        achieved: true,
      },
    ],
    stalledExercises: ['Overhead Press', 'Squat'],
    deloadActive: false,
    deloadRecommended: true,
    deloadReasons: ['2 lifts stalled'],
    conditioning: {
      currentMinutes: 75,
      currentKm: 12.5,
      currentSessions: 2,
      weeklyTargetMin: 150,
    },
    readiness: { daysAgo: 2, readiness: 4, sleepQuality: 3 },
    weeksOfHistory: 6,
    exercisesTracked: 8,
  };
}

describe('CoachContextCard', () => {
  it('is collapsed by default and expands on click', () => {
    render(<CoachContextCard summary={fullSummary()} />);
    expect(screen.getByText('What your coach sees')).toBeInTheDocument();
    expect(screen.queryByText(/Stalled lifts/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /What your coach sees/ }));
    expect(screen.getByText(/Stalled lifts: Overhead Press, Squat\./)).toBeInTheDocument();
  });

  it('renders every section of a full context when expanded', () => {
    render(<CoachContextCard summary={fullSummary()} />);
    fireEvent.click(screen.getByRole('button', { name: /What your coach sees/ }));

    expect(screen.getByText(/6 weeks of recent history across 8 exercises\./)).toBeInTheDocument();
    expect(screen.getByText(/Bench Press: 100 kg x 5/)).toBeInTheDocument();
    expect(screen.getByText(/\(82% there\)/)).toBeInTheDocument();
    expect(screen.getByText('achieved')).toBeInTheDocument();
    expect(screen.getByText(/Deload recommended: 2 lifts stalled\./)).toBeInTheDocument();
    expect(screen.getByText(/This week: 75 min · 12.5 km · 2 sessions/)).toBeInTheDocument();
    expect(screen.getByText(/\(target 150 min\/week\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/Last check-in 2 days ago: readiness 4\/5, sleep 3\/5\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText('A compact summary like this, plus your recent set-by-set training logs, is what the AI receives - never your account data or anything outside your training history.'),
    ).toBeInTheDocument();
  });

  it('renders sensible empty states for a fresh user', () => {
    render(<CoachContextCard summary={emptySummary()} />);
    fireEvent.click(screen.getByRole('button', { name: /What your coach sees/ }));

    expect(
      screen.getByText(/No logged sessions yet - the coach starts learning from your first workout\./),
    ).toBeInTheDocument();
    expect(screen.getByText('No exercise goals set.')).toBeInTheDocument();
    expect(screen.getByText('No stalled lifts detected.')).toBeInTheDocument();
    expect(screen.getByText('No deload recommended.')).toBeInTheDocument();
    expect(screen.getByText(/This week: 0 min · 0 sessions/)).toBeInTheDocument();
    expect(screen.getByText('No readiness check-in in the last 7 days.')).toBeInTheDocument();
  });

  it('shows the active deload state instead of a recommendation', () => {
    const summary = { ...fullSummary(), deloadActive: true };
    render(<CoachContextCard summary={summary} />);
    fireEvent.click(screen.getByRole('button', { name: /What your coach sees/ }));
    expect(screen.getByText('A planned deload week is active.')).toBeInTheDocument();
    expect(screen.queryByText(/Deload recommended/)).not.toBeInTheDocument();
  });
});
