import { afterEach, describe, expect, it } from 'vitest';
import {
  addedSetCompletedAt,
  durationMinutes,
  endsInFuture,
  fromLocalInputs,
  FUTURE_TOLERANCE_MS,
  parseTimingInputs,
  resolveEditedFinish,
  retimeSets,
  toLocalInputs,
} from './session-edit';

const at = (iso: string) => new Date(iso);

describe('retimeSets (issue #389)', () => {
  const oldStartedAt = at('2026-11-20T18:00:00Z');
  const sets = [
    { id: 'a', completedAt: at('2026-11-20T18:05:00Z') },
    { id: 'b', completedAt: at('2026-11-20T18:20:00Z') },
    { id: 'c', completedAt: at('2026-11-20T18:50:00Z') },
  ];

  it('keeps each set at its offset from the start when the session moves', () => {
    const { changes, rescaled } = retimeSets({
      oldStartedAt,
      newStartedAt: at('2026-10-03T07:30:00Z'),
      newFinishedAt: at('2026-10-03T08:30:00Z'),
      sets,
    });
    expect(rescaled).toBe(false);
    expect(changes).toEqual([
      { id: 'a', completedAt: at('2026-10-03T07:35:00Z') },
      { id: 'b', completedAt: at('2026-10-03T07:50:00Z') },
      { id: 'c', completedAt: at('2026-10-03T08:20:00Z') },
    ]);
  });

  it('changes nothing when neither the start nor the fit changes', () => {
    const result = retimeSets({
      oldStartedAt,
      newStartedAt: oldStartedAt,
      newFinishedAt: at('2026-11-20T19:30:00Z'),
      sets,
    });
    expect(result).toEqual({ changes: [], rescaled: false });
  });

  it('squeezes the sets into a shorter session and keeps their order', () => {
    const newStartedAt = at('2026-11-20T18:00:00Z');
    const newFinishedAt = at('2026-11-20T18:25:00Z');
    const { changes, rescaled } = retimeSets({ oldStartedAt, newStartedAt, newFinishedAt, sets });
    expect(rescaled).toBe(true);
    const times = sets.map(
      (set) => (changes.find((c) => c.id === set.id)?.completedAt ?? set.completedAt).getTime(),
    );
    expect(times[0]!).toBeGreaterThanOrEqual(newStartedAt.getTime());
    expect(times[2]!).toBe(newFinishedAt.getTime());
    expect(times[0]!).toBeLessThan(times[1]!);
    expect(times[1]!).toBeLessThan(times[2]!);
  });

  it('pulls a set stamped before the start or long after the end into the window', () => {
    const newStartedAt = at('2026-11-01T10:00:00Z');
    const newFinishedAt = at('2026-11-01T11:00:00Z');
    const { changes, rescaled } = retimeSets({
      oldStartedAt,
      newStartedAt,
      newFinishedAt,
      sets: [
        { id: 'early', completedAt: at('2026-11-20T17:50:00Z') },
        { id: 'late', completedAt: at('2026-11-23T09:00:00Z') },
      ],
    });
    expect(rescaled).toBe(true);
    expect(changes).toEqual([
      { id: 'early', completedAt: newStartedAt },
      { id: 'late', completedAt: newFinishedAt },
    ]);
  });

  it('handles a session without sets', () => {
    expect(
      retimeSets({
        oldStartedAt,
        newStartedAt: at('2026-11-01T10:00:00Z'),
        newFinishedAt: at('2026-11-01T11:00:00Z'),
        sets: [],
      }),
    ).toEqual({ changes: [], rescaled: false });
  });
});

describe('addedSetCompletedAt', () => {
  const startedAt = at('2026-11-03T18:00:00Z');
  const finishedAt = at('2026-11-03T19:00:00Z');

  it('dates the first set of an empty session just after its start', () => {
    expect(addedSetCompletedAt({ startedAt, finishedAt, lastSetAt: null })).toEqual(
      at('2026-11-03T18:00:01Z'),
    );
  });

  it('dates a set one second after the last one', () => {
    expect(
      addedSetCompletedAt({ startedAt, finishedAt, lastSetAt: at('2026-11-03T18:40:00Z') }),
    ).toEqual(at('2026-11-03T18:40:01Z'));
  });

  it('never leaves the session window', () => {
    // A late Finish ends the session at its last set: the next one ties with it.
    expect(addedSetCompletedAt({ startedAt, finishedAt, lastSetAt: finishedAt })).toEqual(finishedAt);
    expect(
      addedSetCompletedAt({ startedAt, finishedAt, lastSetAt: at('2026-11-09T08:00:00Z') }),
    ).toEqual(finishedAt);
    expect(
      addedSetCompletedAt({ startedAt, finishedAt, lastSetAt: at('2026-11-01T08:00:00Z') }),
    ).toEqual(startedAt);
  });
});

describe('resolveEditedFinish', () => {
  const oldStartedAt = at('2026-11-20T18:00:00Z');
  const oldFinishedAt = at('2026-11-20T18:47:20Z');
  const newStartedAt = at('2026-11-18T07:00:00Z');

  it('keeps the stored duration, seconds included, when the minutes were not changed', () => {
    expect(durationMinutes(oldStartedAt, oldFinishedAt)).toBe(47);
    expect(
      resolveEditedFinish({ oldStartedAt, oldFinishedAt, newStartedAt, durationMin: 47 }),
    ).toEqual(at('2026-11-18T07:47:20Z'));
  });

  it('uses the typed minutes when they changed', () => {
    expect(
      resolveEditedFinish({ oldStartedAt, oldFinishedAt, newStartedAt, durationMin: 90 }),
    ).toEqual(at('2026-11-18T08:30:00Z'));
  });
});

describe('endsInFuture', () => {
  const now = at('2026-11-24T12:00:00Z');

  it('tolerates a clock a few seconds ahead, not more', () => {
    expect(endsInFuture(at('2026-11-24T11:59:00Z'), now)).toBe(false);
    expect(endsInFuture(new Date(now.getTime() + FUTURE_TOLERANCE_MS), now)).toBe(false);
    expect(endsInFuture(new Date(now.getTime() + FUTURE_TOLERANCE_MS + 1), now)).toBe(true);
    expect(endsInFuture(at('2026-11-25T12:00:00Z'), now)).toBe(true);
  });
});

describe('local date and time fields', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('round-trips an instant through the two fields', () => {
    const instant = new Date(2026, 10, 3, 18, 30);
    expect(toLocalInputs(instant)).toEqual({ date: '2026-11-03', time: '18:30' });
    expect(fromLocalInputs('2026-11-03', '18:30')).toEqual(instant);
  });

  it('reads the fields in the zone of the runtime, not in UTC', () => {
    process.env.TZ = 'America/New_York';
    // 23:30 on the 3rd in New York is already the 4th in UTC.
    const instant = fromLocalInputs('2026-11-03', '23:30');
    expect(instant?.toISOString()).toBe('2026-11-04T04:30:00.000Z');
    expect(toLocalInputs(new Date('2026-11-04T04:30:00.000Z'))).toEqual({
      date: '2026-11-03',
      time: '23:30',
    });

    process.env.TZ = 'Asia/Tokyo';
    expect(fromLocalInputs('2026-11-03', '06:00')?.toISOString()).toBe('2026-11-02T21:00:00.000Z');
  });

  it('resolves a wall-clock time skipped by daylight saving to the same day', () => {
    process.env.TZ = 'Europe/Paris';
    // 02:30 does not exist on 2026-03-29 in Paris: the clocks go 02:00 -> 03:00.
    const instant = fromLocalInputs('2026-03-29', '02:30');
    expect(instant).not.toBeNull();
    expect(toLocalInputs(instant as Date).date).toBe('2026-03-29');
  });

  it('rejects what is not a real date or time', () => {
    expect(fromLocalInputs('2026-02-30', '10:00')).toBeNull();
    expect(fromLocalInputs('2026-13-01', '10:00')).toBeNull();
    expect(fromLocalInputs('2026-11-03', '24:00')).toBeNull();
    expect(fromLocalInputs('2026-11-03', '10:60')).toBeNull();
    expect(fromLocalInputs('', '10:00')).toBeNull();
    expect(fromLocalInputs('2026-11-03', '')).toBeNull();
    expect(fromLocalInputs('03/11/2026', '10:00')).toBeNull();
  });
});

describe('parseTimingInputs', () => {
  const now = new Date(2026, 10, 24, 12, 0);

  it('reads a past date, time and duration', () => {
    expect(parseTimingInputs({ date: '2026-11-20', time: '18:30', duration: '75' }, now)).toEqual({
      ok: true,
      startedAt: new Date(2026, 10, 20, 18, 30),
      durationMin: 75,
    });
  });

  it('accepts a session that ended just now', () => {
    const result = parseTimingInputs({ date: '2026-11-24', time: '11:00', duration: '60' }, now);
    expect(result.ok).toBe(true);
  });

  it('rejects a future date and a session that would end in the future', () => {
    expect(parseTimingInputs({ date: '2026-11-25', time: '08:00', duration: '60' }, now)).toEqual({
      ok: false,
      reason: 'future',
    });
    expect(parseTimingInputs({ date: '2026-11-24', time: '11:30', duration: '60' }, now)).toEqual({
      ok: false,
      reason: 'future',
    });
  });

  it('rejects an incomplete form and a duration out of bounds', () => {
    const invalid = { ok: false, reason: 'invalid' };
    expect(parseTimingInputs({ date: '', time: '18:30', duration: '60' }, now)).toEqual(invalid);
    expect(parseTimingInputs({ date: '2026-11-20', time: '', duration: '60' }, now)).toEqual(invalid);
    for (const duration of ['', '0', '1441', '-5', '12.5', 'abc']) {
      expect(parseTimingInputs({ date: '2026-11-20', time: '18:30', duration }, now)).toEqual(
        invalid,
      );
    }
  });
});
