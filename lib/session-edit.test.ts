import { afterEach, describe, expect, it } from 'vitest';
import {
  addedSetCompletedAt,
  durationMinutes,
  endsInFuture,
  fromLocalInputs,
  FUTURE_TOLERANCE_MS,
  parseTimingInputs,
  parseTimingEdit,
  resolveEditedWindow,
  retimeSets,
  timingInputsOf,
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

  it('keeps two sets logged at the same instant together, in a move and in a squeeze', () => {
    const tied = [
      { id: 'a', completedAt: at('2026-11-20T18:10:00Z') },
      { id: 'b', completedAt: at('2026-11-20T18:10:00Z') },
      { id: 'c', completedAt: at('2026-11-20T18:40:00Z') },
    ];
    for (const newFinishedAt of [at('2026-11-01T11:00:00Z'), at('2026-11-01T10:20:00Z')]) {
      const { changes } = retimeSets({
        oldStartedAt,
        newStartedAt: at('2026-11-01T10:00:00Z'),
        newFinishedAt,
        sets: tied,
      });
      const time = (id: string) => changes.find((c) => c.id === id)?.completedAt.getTime();
      expect(time('a')).toBe(time('b'));
      expect(time('a') as number).toBeLessThan(time('c') as number);
    }
  });

  it('lets one far outlier compress the others toward the start, without reordering them', () => {
    const newStartedAt = at('2026-11-01T10:00:00Z');
    const { changes, rescaled } = retimeSets({
      oldStartedAt,
      newStartedAt,
      newFinishedAt: at('2026-11-01T11:00:00Z'),
      sets: [...sets, { id: 'outlier', completedAt: at('2026-12-20T18:00:00Z') }],
    });
    expect(rescaled).toBe(true);
    const times = ['a', 'b', 'c', 'outlier'].map(
      (id) => changes.find((c) => c.id === id)!.completedAt.getTime(),
    );
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(times[0]!).toBeGreaterThanOrEqual(newStartedAt.getTime());
    expect(times[3]!).toBe(at('2026-11-01T11:00:00Z').getTime());
  });

  it('handles thousands of sets without spreading them into a call', () => {
    const many = Array.from({ length: 200_000 }, (_, index) => ({
      id: `s${index}`,
      completedAt: new Date(oldStartedAt.getTime() + index * 10),
    }));
    const { changes } = retimeSets({
      oldStartedAt,
      newStartedAt: at('2026-11-01T10:00:00Z'),
      newFinishedAt: at('2026-11-01T11:00:00Z'),
      sets: many,
    });
    expect(changes).toHaveLength(200_000);
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

describe('resolveEditedWindow', () => {
  const startedAt = at('2026-11-20T18:00:27.450Z');
  const finishedAt = at('2026-11-20T18:47:47.450Z');

  it('keeps the stored duration, seconds included, when only the start moves', () => {
    expect(durationMinutes(startedAt, finishedAt)).toBe(47);
    expect(
      resolveEditedWindow({ startedAt, finishedAt, newStartedAt: at('2026-11-18T07:00:00Z') }),
    ).toEqual({
      startedAt: at('2026-11-18T07:00:00Z'),
      finishedAt: at('2026-11-18T07:47:20Z'),
    });
  });

  it('keeps the start, seconds included, when only the duration changes', () => {
    expect(resolveEditedWindow({ startedAt, finishedAt, newDurationMin: 90 })).toEqual({
      startedAt,
      finishedAt: at('2026-11-20T19:30:27.450Z'),
    });
  });

  it('keeps a session longer than the editor lets one type, and one of no length', () => {
    const threeDays = at('2026-11-23T18:00:27.450Z');
    const moved = resolveEditedWindow({
      startedAt,
      finishedAt: threeDays,
      newStartedAt: at('2026-10-01T00:00:00Z'),
    });
    expect(moved.finishedAt.getTime() - moved.startedAt.getTime()).toBe(
      threeDays.getTime() - startedAt.getTime(),
    );
    expect(
      resolveEditedWindow({
        startedAt,
        finishedAt: startedAt,
        newStartedAt: at('2026-10-01T00:00:00Z'),
      }),
    ).toEqual({ startedAt: at('2026-10-01T00:00:00Z'), finishedAt: at('2026-10-01T00:00:00Z') });
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
    // New dates start in 2000, like the imports.
    expect(parseTimingInputs({ date: '1999-12-30', time: '18:30', duration: '60' }, now)).toEqual(
      invalid,
    );
    for (const duration of ['', '0', '1441', '-5', '12.5', 'abc']) {
      expect(parseTimingInputs({ date: '2026-11-20', time: '18:30', duration }, now)).toEqual(
        invalid,
      );
    }
  });
});

describe('parseTimingEdit: only what changed is sent', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });
  const now = new Date(2026, 10, 24, 12, 0);

  it('reports no change for an untouched form, even when the start has seconds', () => {
    const startedAt = new Date(2026, 10, 20, 18, 30, 27, 450);
    const finishedAt = new Date(startedAt.getTime() + 47 * 60_000 + 20_000);
    const inputs = timingInputsOf(startedAt, finishedAt);
    expect(inputs).toEqual({ date: '2026-11-20', time: '18:30', duration: '47' });
    expect(parseTimingEdit({ startedAt, finishedAt, inputs, now })).toEqual({ ok: true, changes: {} });
  });

  it('sends only the duration when only the duration changed, leaving the seconds of the start', () => {
    const startedAt = new Date(2026, 10, 20, 18, 30, 27);
    const finishedAt = new Date(startedAt.getTime() + 47 * 60_000);
    const inputs = { ...timingInputsOf(startedAt, finishedAt), duration: '60' };
    expect(parseTimingEdit({ startedAt, finishedAt, inputs, now })).toEqual({
      ok: true,
      changes: { durationMin: 60 },
    });
  });

  it('sends only the start when only the date changed', () => {
    const startedAt = new Date(2026, 10, 20, 18, 30, 27);
    const finishedAt = new Date(startedAt.getTime() + 47 * 60_000 + 20_000);
    const inputs = { ...timingInputsOf(startedAt, finishedAt), date: '2026-11-18' };
    expect(parseTimingEdit({ startedAt, finishedAt, inputs, now })).toEqual({
      ok: true,
      changes: { startedAt: new Date(2026, 10, 18, 18, 30) },
    });
  });

  it('does not move a start that lies in the hour a daylight saving change repeats', () => {
    process.env.TZ = 'Europe/Paris';
    // 2026-10-25 02:30 happens twice in Paris. This is the second one (CET);
    // read back from the fields it would be the first (CEST), an hour earlier.
    const startedAt = new Date('2026-10-25T01:30:00.000Z');
    const finishedAt = new Date('2026-10-25T02:15:00.000Z');
    const inputs = timingInputsOf(startedAt, finishedAt);
    expect(inputs).toEqual({ date: '2026-10-25', time: '02:30', duration: '45' });
    expect(fromLocalInputs(inputs.date, inputs.time)?.toISOString()).not.toBe(
      startedAt.toISOString(),
    );
    const later = new Date('2026-11-24T11:00:00.000Z');
    expect(parseTimingEdit({ startedAt, finishedAt, inputs, now: later })).toEqual({
      ok: true,
      changes: {},
    });
    expect(
      parseTimingEdit({ startedAt, finishedAt, inputs: { ...inputs, duration: '50' }, now: later }),
    ).toEqual({ ok: true, changes: { durationMin: 50 } });
  });

  it('re-dates a session longer than 24 hours, and one of no length, without touching the duration', () => {
    const startedAt = new Date(2026, 10, 10, 8, 0);
    const long = new Date(startedAt.getTime() + 3 * 24 * 60 * 60_000);
    const longInputs = timingInputsOf(startedAt, long);
    expect(longInputs.duration).toBe('4320');
    expect(
      parseTimingEdit({
        startedAt,
        finishedAt: long,
        inputs: { ...longInputs, date: '2026-11-08' },
        now,
      }),
    ).toEqual({ ok: true, changes: { startedAt: new Date(2026, 10, 8, 8, 0) } });

    const zeroInputs = timingInputsOf(startedAt, startedAt);
    expect(zeroInputs.duration).toBe('0');
    expect(
      parseTimingEdit({
        startedAt,
        finishedAt: startedAt,
        inputs: { ...zeroInputs, time: '09:15' },
        now,
      }),
    ).toEqual({ ok: true, changes: { startedAt: new Date(2026, 10, 10, 9, 15) } });
  });

  it('rejects a changed field that is invalid, in the future or before 2000', () => {
    const startedAt = new Date(2026, 10, 20, 18, 30);
    const finishedAt = new Date(startedAt.getTime() + 47 * 60_000);
    const base = timingInputsOf(startedAt, finishedAt);
    const edit = (inputs: Partial<typeof base>) =>
      parseTimingEdit({ startedAt, finishedAt, inputs: { ...base, ...inputs }, now });
    expect(edit({ duration: '0' })).toEqual({ ok: false, reason: 'invalid' });
    expect(edit({ duration: '1441' })).toEqual({ ok: false, reason: 'invalid' });
    expect(edit({ date: '' })).toEqual({ ok: false, reason: 'invalid' });
    expect(edit({ date: '1999-12-30' })).toEqual({ ok: false, reason: 'invalid' });
    expect(edit({ date: '2026-11-25' })).toEqual({ ok: false, reason: 'future' });
    expect(edit({ date: '2026-11-24', time: '11:30' })).toEqual({ ok: false, reason: 'future' });
  });
});
