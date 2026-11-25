// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConditioningCard, type ConditioningWeekView } from './conditioning-card';

// The chart itself renders inside Recharts' ResponsiveContainer (zero-sized
// in jsdom), so these tests assert the card chrome and the textual summary -
// the aggregation math is covered by lib/stats.test.ts (weeklyConditioning).

function week(over: Partial<ConditioningWeekView> = {}): ConditioningWeekView {
  return {
    weekKey: '2026-W24',
    weekStartIso: '2026-06-08T00:00:00.000Z',
    minutes: 0,
    distanceKm: 0,
    sessions: 0,
    ...over,
  };
}

describe('ConditioningCard', () => {
  it('renders the title and the 150 min/week guideline copy', () => {
    render(<ConditioningCard weeks={[week()]} />);
    expect(screen.getByText('Conditioning')).toBeInTheDocument();
    expect(screen.getByText(/150 min\/week guideline/)).toBeInTheDocument();
  });

  it('summarizes the current week and the window totals', () => {
    const weeks = [
      week({ weekKey: '2026-W23', weekStartIso: '2026-06-01T00:00:00.000Z', minutes: 90, distanceKm: 10, sessions: 2 }),
      week({ minutes: 45, distanceKm: 5.5, sessions: 1 }),
    ];
    render(<ConditioningCard weeks={weeks} />);
    expect(
      screen.getByText(/This week: 45 min · 5.5 km · 1 session · 2-week total: 135 min, 15.5 km./),
    ).toBeInTheDocument();
  });

  it('converts the distances to miles for a miles user (issue #582)', () => {
    const weeks = [
      week({ weekKey: '2026-W23', weekStartIso: '2026-06-01T00:00:00.000Z', minutes: 90, distanceKm: 10, sessions: 2 }),
      week({ minutes: 45, distanceKm: 5, sessions: 1 }),
    ];
    render(<ConditioningCard weeks={weeks} distanceUnit="mi" />);
    expect(
      screen.getByText(/This week: 45 min · 3.11 mi · 1 session · 2-week total: 135 min, 9.32 mi./),
    ).toBeInTheDocument();
  });

  it('omits distance copy when the window has no distance data', () => {
    render(<ConditioningCard weeks={[week({ minutes: 30, sessions: 1 })]} />);
    expect(screen.getByText(/This week: 30 min · 1 session · 1-week total: 30 min./)).toBeInTheDocument();
  });
});
