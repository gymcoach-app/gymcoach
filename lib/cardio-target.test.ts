import { describe, expect, it } from 'vitest';
import { MAX_DISTANCE_M, MAX_DURATION_SEC, parseDurationToSec } from '@/lib/cardio';
import {
  cardioTargetLoggerInputs,
  coachCardioTarget,
  distanceMToKmInput,
  durationSecToMinutesInput,
  formatCardioTarget,
  formatTargetDuration,
  hasCardioTarget,
  isCardioExercise,
  kmInputToDistanceM,
  minutesInputToDurationSec,
} from '@/lib/cardio-target';

// Cardio target of a programmed exercise (issue #558, slice 1).

describe('isCardioExercise', () => {
  it('is true only for the CARDIO category', () => {
    expect(isCardioExercise({ category: 'CARDIO' })).toBe(true);
    expect(isCardioExercise({ category: 'COMPOUND' })).toBe(false);
    expect(isCardioExercise({ category: 'ISOLATION' })).toBe(false);
  });
});

describe('hasCardioTarget', () => {
  it('needs a positive duration', () => {
    expect(hasCardioTarget({ targetDurationSec: 1200 })).toBe(true);
    expect(hasCardioTarget({ targetDurationSec: null, targetDistanceM: 5000 })).toBe(false);
    expect(hasCardioTarget({ targetDurationSec: 0 })).toBe(false);
    expect(hasCardioTarget({})).toBe(false);
  });
});

describe('formatTargetDuration', () => {
  it('reads whole minutes as minutes, also over an hour', () => {
    expect(formatTargetDuration(1200)).toBe('20 min');
    expect(formatTargetDuration(60)).toBe('1 min');
    expect(formatTargetDuration(5400)).toBe('90 min');
  });

  it('falls back to the clock format of a logged set otherwise', () => {
    expect(formatTargetDuration(750)).toBe('12:30');
    expect(formatTargetDuration(45)).toBe('0:45');
    expect(formatTargetDuration(3930)).toBe('1:05:30');
  });
});

describe('formatCardioTarget', () => {
  it('reads a duration-only target as "20 min"', () => {
    expect(formatCardioTarget({ targetDurationSec: 1200, targetDistanceM: null })).toBe('20 min');
    expect(formatCardioTarget({ targetDurationSec: 1200 })).toBe('20 min');
  });

  it('appends the distance when one is set', () => {
    expect(formatCardioTarget({ targetDurationSec: 1200, targetDistanceM: 5000 })).toBe(
      '20 min · 5 km',
    );
    expect(formatCardioTarget({ targetDurationSec: 1800, targetDistanceM: 2500 })).toBe(
      '30 min · 2.5 km',
    );
  });

  it('ignores a zero distance', () => {
    expect(formatCardioTarget({ targetDurationSec: 1200, targetDistanceM: 0 })).toBe('20 min');
  });

  it('is null without a duration, so the caller shows the neutral label', () => {
    expect(formatCardioTarget({ targetDurationSec: null, targetDistanceM: null })).toBeNull();
    expect(formatCardioTarget({ targetDurationSec: null, targetDistanceM: 5000 })).toBeNull();
    expect(formatCardioTarget({})).toBeNull();
  });

  it('never mentions sets, reps or RIR', () => {
    const text = formatCardioTarget({ targetDurationSec: 1200, targetDistanceM: 5000 })!;
    expect(text).not.toMatch(/set|rep|rir|rest/i);
  });
});

describe('minutesInputToDurationSec', () => {
  it('converts typed minutes to seconds', () => {
    expect(minutesInputToDurationSec('20')).toBe(1200);
    expect(minutesInputToDurationSec(' 12.5 ')).toBe(750);
    expect(minutesInputToDurationSec('12,5')).toBe(750);
  });

  it('accepts the bounds of a logged cardio set', () => {
    expect(minutesInputToDurationSec('1440')).toBe(MAX_DURATION_SEC);
    expect(minutesInputToDurationSec('1441')).toBeNull();
    expect(minutesInputToDurationSec('0')).toBeNull();
  });

  it('refuses an empty or malformed value', () => {
    expect(minutesInputToDurationSec('')).toBeNull();
    expect(minutesInputToDurationSec('abc')).toBeNull();
    expect(minutesInputToDurationSec('-5')).toBeNull();
    expect(minutesInputToDurationSec('1e3')).toBeNull();
  });
});

describe('kmInputToDistanceM', () => {
  it('converts typed kilometers to meters', () => {
    expect(kmInputToDistanceM('5')).toBe(5000);
    expect(kmInputToDistanceM('2.5')).toBe(2500);
    expect(kmInputToDistanceM('2,5')).toBe(2500);
  });

  it('reads an empty field as no distance (optional)', () => {
    expect(kmInputToDistanceM('')).toBeNull();
    expect(kmInputToDistanceM('  ')).toBeNull();
  });

  it('flags an invalid or out-of-bounds value as undefined', () => {
    expect(kmInputToDistanceM('0')).toBeUndefined();
    expect(kmInputToDistanceM('-1')).toBeUndefined();
    expect(kmInputToDistanceM('abc')).toBeUndefined();
    expect(kmInputToDistanceM('1000')).toBe(MAX_DISTANCE_M);
    expect(kmInputToDistanceM('1000.5')).toBeUndefined();
  });
});

describe('editor field values', () => {
  it('shows stored seconds as minutes and stored meters as kilometers', () => {
    expect(durationSecToMinutesInput(1200)).toBe('20');
    expect(durationSecToMinutesInput(750)).toBe('12.5');
    expect(durationSecToMinutesInput(null)).toBe('');
    expect(distanceMToKmInput(5000)).toBe('5');
    expect(distanceMToKmInput(2500)).toBe('2.5');
    expect(distanceMToKmInput(null)).toBe('');
    expect(distanceMToKmInput(0)).toBe('');
  });

  it('round-trips through the typed values', () => {
    expect(minutesInputToDurationSec(durationSecToMinutesInput(1200))).toBe(1200);
    expect(kmInputToDistanceM(distanceMToKmInput(5000))).toBe(5000);
  });
});

describe('cardioTargetLoggerInputs', () => {
  it('starts the logger from the target, in the format the logger parses', () => {
    const inputs = cardioTargetLoggerInputs({ targetDurationSec: 1200, targetDistanceM: 5000 });
    expect(inputs).toEqual({ durationInput: '20:00', distanceInput: '5' });
    expect(parseDurationToSec(inputs.durationInput)).toBe(1200);
  });

  it('leaves the distance empty when the target has none', () => {
    expect(cardioTargetLoggerInputs({ targetDurationSec: 750, targetDistanceM: null })).toEqual({
      durationInput: '12:30',
      distanceInput: '',
    });
  });

  it('leaves both inputs empty without a target', () => {
    expect(cardioTargetLoggerInputs({ targetDurationSec: null, targetDistanceM: null })).toEqual({
      durationInput: '',
      distanceInput: '',
    });
  });
});

describe('coachCardioTarget', () => {
  it('carries minutes, and kilometers only when a distance is set', () => {
    expect(coachCardioTarget({ category: 'CARDIO' }, { targetDurationSec: 1200 })).toEqual({
      targetDurationMin: 20,
    });
    expect(
      coachCardioTarget({ category: 'CARDIO' }, { targetDurationSec: 750, targetDistanceM: 2500 }),
    ).toEqual({ targetDurationMin: 12.5, targetDistanceKm: 2.5 });
  });

  it('adds nothing for a cardio row without a target or a strength row', () => {
    expect(coachCardioTarget({ category: 'CARDIO' }, { targetDurationSec: null })).toEqual({});
    expect(
      coachCardioTarget({ category: 'COMPOUND' }, { targetDurationSec: 1200, targetDistanceM: 5 }),
    ).toEqual({});
  });
});
