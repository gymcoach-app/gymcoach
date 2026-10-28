import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HistoryCalendar,
  weekStartsOnForLocale,
  type HistoryCalendarSession,
} from './history-calendar';

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: '/history',
  query: 'month=2026-09',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

const sessions: HistoryCalendarSession[] = [
  {
    id: 'session-1',
    startedAt: new Date(2026, 8, 12, 10, 30).toISOString(),
    title: 'Upper body',
    programName: 'Strength',
    workingSets: 4,
    volumeLabel: '2,400 kg vol.',
    durationLabel: '45 min',
    cardioDistanceLabel: null,
    cardioDurationLabel: null,
    cardioHeartRateLabel: null,
  },
  {
    id: 'session-2',
    startedAt: new Date(2026, 8, 12, 16, 0).toISOString(),
    title: 'Evening session',
    programName: null,
    workingSets: 3,
    volumeLabel: '1,500 kg vol.',
    durationLabel: '30 min',
    cardioDistanceLabel: null,
    cardioDurationLabel: null,
    cardioHeartRateLabel: null,
  },
];

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe('HistoryCalendar', () => {
  beforeEach(() => {
    navigation.push.mockReset();
    navigation.replace.mockReset();
    navigation.query = `month=2026-09&tz=${browserZone}`;
    window.history.replaceState({}, '', `/history?month=2026-09&tz=${browserZone}`);
  });

  it('marks workout days and lists sessions for the selected date', () => {
    render(
      <HistoryCalendar
        monthKey="2026-09"
        initialDay="2026-09-12"
        sessions={sessions}
        timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
      />,
    );

    const day = screen.getByRole('button', { name: /12.*2 workouts/i });
    expect(day).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Upper body')).toBeInTheDocument();
    expect(screen.getByText('Evening session')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Upper body/i })).toHaveAttribute(
      'href',
      `/history/session-1?month=2026-09&day=2026-09-12&tz=${encodeURIComponent(browserZone)}`,
    );
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('hands the browser timezone to the server once when the URL has none', () => {
    navigation.query = 'month=2026-09';
    render(
      <HistoryCalendar
        monthKey="2026-09"
        initialDay="2026-09-12"
        sessions={sessions}
        timeZone="UTC"
      />,
    );

    expect(navigation.replace).toHaveBeenCalledTimes(1);
    const href = navigation.replace.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('month')).toBe('2026-09');
    expect(params.get('tz')).toBe(browserZone);
  });

  it('builds URLs with the zone the URL already carries, not the server fallback', () => {
    navigation.query = 'month=2026-09&tz=Asia/Tokyo';
    render(
      <HistoryCalendar
        monthKey="2026-09"
        initialDay="2026-09-12"
        sessions={sessions}
        timeZone="UTC"
      />,
    );

    expect(screen.getByRole('link', { name: /Upper body/i })).toHaveAttribute(
      'href',
      '/history/session-1?month=2026-09&day=2026-09-12&tz=Asia%2FTokyo',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    const href = navigation.push.mock.calls[0]?.[0] as string;
    expect(new URLSearchParams(href.split('?')[1]).get('tz')).toBe('Asia/Tokyo');
  });

  it('shows the filtered empty message when a program has no sessions this month', () => {
    navigation.query = `programId=program-1&month=2026-09&tz=${browserZone}`;
    render(
      <HistoryCalendar
        monthKey="2026-09"
        sessions={[]}
        selectedProgramId="program-1"
        timeZone={browserZone}
      />,
    );

    expect(screen.getByText('No finished session matches these filters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
  });

  it('updates the selected day in place without navigating away', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    render(
      <HistoryCalendar
        monthKey="2026-09"
        initialDay="2026-09-12"
        sessions={sessions}
        timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /13/ }));

    expect(screen.getByText('No completed workouts on this date.')).toBeInTheDocument();
    expect(replaceState).toHaveBeenLastCalledWith(
      null,
      '',
      `/history?month=2026-09&tz=${encodeURIComponent(browserZone)}&day=2026-09-13`,
    );
    replaceState.mockRestore();
  });

  it('navigates between months while preserving other query filters', () => {
    navigation.query = `programId=program-1&month=2026-09&tz=${browserZone}`;
    render(
      <HistoryCalendar
        monthKey="2026-09"
        initialDay="2026-09-12"
        sessions={sessions}
        selectedProgramId="program-1"
        timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));

    expect(navigation.push).toHaveBeenCalledTimes(1);
    const href = navigation.push.mock.calls[0]?.[0] as string;
    expect(href).toContain('/history?');
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('month')).toBe('2026-10');
    expect(params.get('programId')).toBe('program-1');
    expect(params.get('tz')).toBe(browserZone);
    expect(params.has('day')).toBe(false);
  });
});

describe('weekStartsOnForLocale', () => {
  it('starts weeks on Monday for French, Russian, German, Spanish, Italian and Dutch', () => {
    expect(weekStartsOnForLocale('fr')).toBe(1);
    expect(weekStartsOnForLocale('ru')).toBe(1);
    expect(weekStartsOnForLocale('de')).toBe(1);
    expect(weekStartsOnForLocale('de-AT')).toBe(1);
    expect(weekStartsOnForLocale('es')).toBe(1);
    expect(weekStartsOnForLocale('it')).toBe(1);
    expect(weekStartsOnForLocale('nl')).toBe(1);
  });

  it('starts weeks on Sunday for English and Portuguese', () => {
    expect(weekStartsOnForLocale('en')).toBe(0);
    expect(weekStartsOnForLocale('en-US')).toBe(0);
    expect(weekStartsOnForLocale('pt')).toBe(0);
  });
});
