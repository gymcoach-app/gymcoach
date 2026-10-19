import { describe, expect, it } from 'vitest';
import { blockKey } from './exercise-blocks';
import {
  calendarDaysBetween,
  lastDoneAtByExercise,
  lastDoneDaysByExercise,
  msUntilNextLocalMidnight,
} from './last-done';

describe('calendarDaysBetween (issue #459)', () => {
  it('counts calendar days, not 24-hour periods', () => {
    // 23:30 then 08:00 the next morning: under 24 hours, but yesterday.
    expect(
      calendarDaysBetween(
        new Date('2026-10-16T23:30:00Z'),
        new Date('2026-10-17T08:00:00Z'),
        'UTC',
      ),
    ).toBe(1);
  });

  it('is 0 on the same calendar day', () => {
    expect(
      calendarDaysBetween(
        new Date('2026-10-17T06:00:00Z'),
        new Date('2026-10-17T20:00:00Z'),
        'UTC',
      ),
    ).toBe(0);
  });

  it('uses the given time zone for the day boundary', () => {
    const from = new Date('2026-10-16T22:30:00Z');
    const to = new Date('2026-10-17T06:00:00Z');
    // In UTC these are different days; in Paris (UTC+2 in October) both fall
    // on 2026-10-17.
    expect(calendarDaysBetween(from, to, 'UTC')).toBe(1);
    expect(calendarDaysBetween(from, to, 'Europe/Paris')).toBe(0);
  });

  it('spans month and year boundaries and DST changes', () => {
    expect(
      calendarDaysBetween(
        new Date('2025-12-20T12:00:00Z'),
        new Date('2026-01-03T12:00:00Z'),
        'UTC',
      ),
    ).toBe(14);
    // Europe/Paris leaves summer time on 2026-10-25, a 25-hour day. 23:30 on
    // the 24th (CEST, 21:30Z) to 00:30 on the 26th (CET, 23:30Z on the 25th)
    // is 26 hours: dividing elapsed time by 24 hours says 1, the calendar 2.
    expect(
      calendarDaysBetween(
        new Date('2026-10-24T21:30:00Z'),
        new Date('2026-10-25T23:30:00Z'),
        'Europe/Paris',
      ),
    ).toBe(2);
    // Spring forward on 2026-03-29, a 23-hour day: 00:30 on the 29th (CET,
    // 23:30Z on the 28th) to 23:30 the same day (CEST, 21:30Z) is 22 hours
    // and still the same calendar day.
    expect(
      calendarDaysBetween(
        new Date('2026-03-28T23:30:00Z'),
        new Date('2026-03-29T21:30:00Z'),
        'Europe/Paris',
      ),
    ).toBe(0);
  });

  it('never goes negative', () => {
    expect(
      calendarDaysBetween(
        new Date('2026-10-18T10:00:00Z'),
        new Date('2026-10-17T10:00:00Z'),
        'UTC',
      ),
    ).toBe(0);
  });
});

describe('lastDoneDaysByExercise', () => {
  it('maps each exercise with a last working set and omits the others', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    const result = lastDoneDaysByExercise(
      { squat: '2026-10-14T18:00:00Z', bench: '2026-10-17T07:00:00Z' },
      now,
      'UTC',
    );
    expect(result).toEqual({ squat: 3, bench: 0 });
  });
});

describe('lastDoneAtByExercise (session page wiring, issue #480)', () => {
  it('sends the session start per exercise, ignoring block entries and exercises never done', () => {
    const squatStart = new Date('2026-10-14T18:00:00Z');
    const lastPerformances = new Map([
      ['squat', { sessionStartedAt: squatStart }],
      [blockKey('squat', 1), { sessionStartedAt: new Date('2026-10-01T09:00:00Z') }],
    ]);
    expect(lastDoneAtByExercise(['squat', 'bench'], lastPerformances)).toEqual({
      squat: '2026-10-14T18:00:00.000Z',
    });
  });
});

describe('msUntilNextLocalMidnight (issue #480)', () => {
  it('waits until one second past the next local midnight', () => {
    const now = new Date(2026, 9, 17, 23, 0, 0);
    expect(msUntilNextLocalMidnight(now)).toBe(new Date(2026, 9, 18).getTime() - now.getTime() + 1000);
  });

  it('waits a full day plus the margin at midnight itself', () => {
    const now = new Date(2026, 9, 17);
    expect(msUntilNextLocalMidnight(now)).toBe(new Date(2026, 9, 18).getTime() - now.getTime() + 1000);
  });
});
