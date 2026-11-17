import { describe, it, expect } from 'vitest';
import { LATE_FINISH_THRESHOLD_MS, resolveFinishedAt } from './session-finish';

const now = new Date('2026-11-17T18:00:00.000Z');
const minutesBefore = (min: number) => new Date(now.getTime() - min * 60_000);

describe('resolveFinishedAt (issue #571)', () => {
  it('uses a 30 minute threshold', () => {
    expect(LATE_FINISH_THRESHOLD_MS).toBe(30 * 60 * 1000);
  });

  it('returns now when the session has no set', () => {
    expect(resolveFinishedAt({ now, startedAt: minutesBefore(600), lastSetAt: null })).toBe(now);
  });

  it('returns now when the last set is recent', () => {
    expect(
      resolveFinishedAt({ now, startedAt: minutesBefore(60), lastSetAt: minutesBefore(2) }),
    ).toBe(now);
  });

  it('returns now when the last set is exactly at the threshold', () => {
    const lastSetAt = new Date(now.getTime() - LATE_FINISH_THRESHOLD_MS);
    expect(resolveFinishedAt({ now, startedAt: minutesBefore(90), lastSetAt })).toBe(now);
  });

  it('returns the last set time once the threshold is passed', () => {
    const lastSetAt = new Date(now.getTime() - LATE_FINISH_THRESHOLD_MS - 1);
    expect(resolveFinishedAt({ now, startedAt: minutesBefore(90), lastSetAt })).toBe(lastSetAt);
  });

  it('ends a session finished the next morning at its last set', () => {
    const startedAt = minutesBefore(14 * 60);
    const lastSetAt = minutesBefore(13 * 60);
    const finishedAt = resolveFinishedAt({ now, startedAt, lastSetAt });
    expect(finishedAt).toBe(lastSetAt);
    expect(finishedAt.getTime() - startedAt.getTime()).toBe(60 * 60_000);
  });

  it('never ends a session before it started', () => {
    const startedAt = minutesBefore(120);
    expect(resolveFinishedAt({ now, startedAt, lastSetAt: minutesBefore(180) })).toBe(startedAt);
  });

  it('returns now when the last set is stamped in the future', () => {
    const lastSetAt = new Date(now.getTime() + 5 * 60_000);
    expect(resolveFinishedAt({ now, startedAt: minutesBefore(60), lastSetAt })).toBe(now);
  });
});
