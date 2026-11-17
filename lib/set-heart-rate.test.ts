import { describe, it, expect } from 'vitest';
import { splitHeartRateBySet, type HrSample } from './set-heart-rate';

// Heart rate per set from an attached watch file (issue #576): the window of
// a set runs from the previous set's log time (the session start for the
// first one) to its own log time.

const START = new Date('2026-06-10T07:30:00.000Z');
// A set logged `sec` seconds after the session start.
const at = (sec: number) => new Date(START.getTime() + sec * 1000);
const set = (id: string, sec: number) => ({ id, completedAt: at(sec) });

function split(samples: HrSample[], sets: Array<{ id: string; completedAt: Date }>, opts = {}) {
  return splitHeartRateBySet({
    sessionStartedAt: START,
    recordingStartedAt: START,
    samples,
    sets,
    ...opts,
  });
}

describe('splitHeartRateBySet', () => {
  it('gives each set the average and the peak of its own window', () => {
    const samples = [
      { t: 10, hr: 100 },
      { t: 20, hr: 110 },
      { t: 30, hr: 121 },
      { t: 70, hr: 140 },
      { t: 80, hr: 160 },
    ];
    expect(split(samples, [set('a', 60), set('b', 120)])).toEqual([
      // (100 + 110 + 121) / 3 = 110.33 -> 110.
      { id: 'a', avgHr: 110, maxHr: 121 },
      { id: 'b', avgHr: 150, maxHr: 160 },
    ]);
  });

  it('puts a sample on a boundary in the set logged at that instant, not the next one', () => {
    const samples = [
      { t: 60, hr: 130 },
      { t: 61, hr: 90 },
    ];
    expect(split(samples, [set('a', 60), set('b', 120)])).toEqual([
      { id: 'a', avgHr: 130, maxHr: 130 },
      { id: 'b', avgHr: 90, maxHr: 90 },
    ]);
  });

  it('counts the sample taken at the session start in the first set', () => {
    expect(split([{ t: 0, hr: 95 }], [set('a', 60)])).toEqual([{ id: 'a', avgHr: 95, maxHr: 95 }]);
  });

  it('ignores what the watch recorded before the session started', () => {
    // The recording starts two minutes before the session.
    const recordingStartedAt = at(-120);
    const samples = [
      { t: 0, hr: 180 },
      { t: 119, hr: 181 },
      { t: 150, hr: 100 },
    ];
    expect(split(samples, [set('a', 60)], { recordingStartedAt })).toEqual([
      { id: 'a', avgHr: 100, maxHr: 100 },
    ]);
  });

  it('places the samples by the recording start, not the session start', () => {
    // The watch was started 5 minutes into the session: t = 0 is at +300 s.
    const recordingStartedAt = at(300);
    const samples = [
      { t: 0, hr: 120 },
      { t: 100, hr: 150 },
    ];
    expect(
      split(samples, [set('a', 200), set('b', 360), set('c', 420)], { recordingStartedAt }),
    ).toEqual([
      { id: 'b', avgHr: 120, maxHr: 120 },
      { id: 'c', avgHr: 150, maxHr: 150 },
    ]);
  });

  it('gives nothing to a set whose window falls in a gap of the recording', () => {
    const samples = [
      { t: 30, hr: 100 },
      // Nothing between 60 s and 120 s: the strap lost contact.
      { t: 150, hr: 140 },
    ];
    expect(split(samples, [set('a', 60), set('b', 120), set('c', 180)])).toEqual([
      { id: 'a', avgHr: 100, maxHr: 100 },
      { id: 'c', avgHr: 140, maxHr: 140 },
    ]);
  });

  it('returns nothing when there is no sample at all', () => {
    expect(split([], [set('a', 60), set('b', 120)])).toEqual([]);
  });

  it('returns nothing when there is no set', () => {
    expect(split([{ t: 10, hr: 100 }], [])).toEqual([]);
  });

  it('gives nothing to sets logged outside the recording', () => {
    const samples = [
      { t: 100, hr: 120 },
      { t: 110, hr: 130 },
    ];
    expect(
      split(samples, [
        // Logged before the session start (a backdated set): empty window.
        set('before', -30),
        // Logged before the first sample.
        set('early', 50),
        set('in', 120),
        // Logged after the last sample.
        set('late', 600),
        set('later', 900),
      ]),
    ).toEqual([{ id: 'in', avgHr: 125, maxHr: 130 }]);
  });

  it('gives nothing to a set logged after the session was finished', () => {
    const samples = [
      { t: 30, hr: 100 },
      { t: 90, hr: 140 },
      { t: 200, hr: 170 },
    ];
    const sets = [set('a', 60), set('b', 120), set('added-later', 86_400)];
    // Without an end (session still running) the last set takes what is left.
    expect(split(samples, sets)).toEqual([
      { id: 'a', avgHr: 100, maxHr: 100 },
      { id: 'b', avgHr: 140, maxHr: 140 },
      { id: 'added-later', avgHr: 170, maxHr: 170 },
    ]);
    expect(split(samples, sets, { sessionFinishedAt: null })).toHaveLength(3);
    // Finished at +300 s: the set typed in a day later has no window.
    expect(split(samples, sets, { sessionFinishedAt: at(300) })).toEqual([
      { id: 'a', avgHr: 100, maxHr: 100 },
      { id: 'b', avgHr: 140, maxHr: 140 },
    ]);
    // A set logged at the very instant the session was finished still counts.
    expect(split(samples, sets, { sessionFinishedAt: at(120) })).toHaveLength(2);
  });

  it('gives nothing when every set was entered after the session', () => {
    const samples = [
      { t: 30, hr: 100 },
      { t: 90, hr: 140 },
    ];
    const sets = [set('a', 5_000_000), set('b', 5_000_060)];
    expect(split(samples, sets, { sessionFinishedAt: at(3600) })).toEqual([]);
  });

  it('gives nothing when the file is from another day', () => {
    const recordingStartedAt = new Date('2026-06-12T07:30:00.000Z');
    expect(split([{ t: 10, hr: 100 }], [set('a', 60)], { recordingStartedAt })).toEqual([]);
    const earlier = new Date('2026-06-08T07:30:00.000Z');
    expect(split([{ t: 10, hr: 100 }], [set('a', 60)], { recordingStartedAt: earlier })).toEqual(
      [],
    );
  });

  it('does not depend on the order of the samples or of the sets', () => {
    const samples = [
      { t: 80, hr: 160 },
      { t: 10, hr: 100 },
      { t: 70, hr: 140 },
      { t: 30, hr: 120 },
    ];
    const sets = [set('b', 120), set('a', 60)];
    expect(split(samples, sets)).toEqual([
      { id: 'a', avgHr: 110, maxHr: 120 },
      { id: 'b', avgHr: 150, maxHr: 160 },
    ]);
    // The inputs are left as they were given.
    expect(samples[0]).toEqual({ t: 80, hr: 160 });
    expect(sets.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('gives the window to the first of two sets logged at the same instant', () => {
    const samples = [{ t: 30, hr: 118 }];
    expect(split(samples, [set('a', 60), set('b', 60)])).toEqual([
      { id: 'a', avgHr: 118, maxHr: 118 },
    ]);
  });

  it('drops samples outside the heart rate bounds and malformed ones', () => {
    const samples = [
      { t: 10, hr: 39 },
      { t: 20, hr: 251 },
      { t: 30, hr: Number.NaN },
      { t: -5, hr: 120 },
      { t: Number.POSITIVE_INFINITY, hr: 120 },
      { t: 40, hr: 40 },
      { t: 50, hr: 250 },
    ];
    expect(split(samples, [set('a', 60)])).toEqual([{ id: 'a', avgHr: 145, maxHr: 250 }]);
    // Only out-of-bounds values in the window: nothing, not a clamped value.
    expect(split(samples.slice(0, 5), [set('a', 60)])).toEqual([]);
  });

  it('rounds the average to a whole bpm', () => {
    const samples = [
      { t: 10, hr: 100 },
      { t: 20, hr: 101 },
    ];
    // 100.5 -> 101.
    expect(split(samples, [set('a', 60)])).toEqual([{ id: 'a', avgHr: 101, maxHr: 101 }]);
  });

  it('returns nothing for an invalid date', () => {
    const samples = [{ t: 10, hr: 100 }];
    expect(split(samples, [set('a', 60)], { sessionStartedAt: new Date('nope') })).toEqual([]);
    expect(split(samples, [set('a', 60)], { recordingStartedAt: new Date('nope') })).toEqual([]);
    expect(split(samples, [{ id: 'a', completedAt: new Date('nope') }])).toEqual([]);
    expect(split(samples, [set('a', 60)], { sessionFinishedAt: new Date('nope') })).toEqual([]);
  });
});
