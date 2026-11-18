import { describe, expect, it } from 'vitest';
import {
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  MILES_TO_METERS,
  cardioDistanceUnit,
  metersPerDistanceUnit,
  parseDurationToSec,
} from '@/lib/cardio';
import {
  cardioTargetLoggerInputs,
  coachCardioTarget,
  distanceInputToM,
  distanceMToInput,
  distanceMToKmInput,
  distanceUnitLabel,
  durationSecToMinutesInput,
  formatCardioTarget,
  formatCardioTargetParts,
  formatTargetDistance,
  formatTargetDuration,
  hasCardioTarget,
  isCardioExercise,
  kmInputToDistanceM,
  maxTargetDistance,
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

// --- Issue #576: localized text and the logger's distance unit ---------------

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'tr', 'zh-CN'] as const;

// Intl separates a number from its unit with a plain or a no-break space,
// depending on the locale; the tests compare with plain spaces.
function plain(text: string | null): string | null {
  return text == null ? null : text.replace(/[\u00a0\u202f]/g, ' ');
}

describe('localized cardio target (issue #576)', () => {
  it('defaults to English, so an untouched caller reads as before', () => {
    expect(formatCardioTarget({ targetDurationSec: 1200, targetDistanceM: 5000 })).toBe(
      formatCardioTarget({ targetDurationSec: 1200, targetDistanceM: 5000 }, { locale: 'en' }),
    );
    expect(formatTargetDistance(2500)).toBe('2.5 km');
  });

  it('names the minute in the language of each of the 11 locales', () => {
    const minutes = Object.fromEntries(
      LOCALES.map((locale) => [locale, plain(formatTargetDuration(1200, locale))]),
    );
    expect(minutes).toEqual({
      en: '20 min',
      de: '20 Min.',
      es: '20 min',
      fr: '20 min',
      it: '20 min',
      nl: '20 min',
      pl: '20 min',
      pt: '20 min',
      ru: '20 мин',
      tr: '20 dk.',
      'zh-CN': '20分钟',
    });
  });

  it('names the kilometer and writes the decimal mark of each locale', () => {
    const km = Object.fromEntries(
      LOCALES.map((locale) => [locale, plain(formatTargetDistance(2500, { locale }))]),
    );
    expect(km).toEqual({
      en: '2.5 km',
      de: '2,5 km',
      es: '2,5 km',
      fr: '2,5 km',
      it: '2,5 km',
      nl: '2,5 km',
      pl: '2,5 km',
      pt: '2,5 km',
      ru: '2,5 км',
      tr: '2,5 km',
      'zh-CN': '2.5公里',
    });
  });

  it('no longer leaves the Latin "min" or "km" in Russian and Chinese', () => {
    for (const locale of ['ru', 'zh-CN']) {
      const text = formatCardioTarget(
        { targetDurationSec: 1200, targetDistanceM: 5000 },
        { locale },
      )!;
      expect(text).not.toMatch(/min|km/);
      expect(text).toContain(' · ');
    }
  });

  it('keeps the clock format for a duration that is not whole minutes, in every locale', () => {
    for (const locale of LOCALES) expect(formatTargetDuration(750, locale)).toBe('12:30');
  });

  it('formats every locale without throwing and returns the two halves separately', () => {
    for (const locale of LOCALES) {
      const parts = formatCardioTargetParts(
        { targetDurationSec: 1200, targetDistanceM: 5000 },
        { locale },
      );
      expect(parts.duration).toBeTruthy();
      expect(parts.distance).toBeTruthy();
      expect(
        formatCardioTarget({ targetDurationSec: 1200, targetDistanceM: 5000 }, { locale }),
      ).toBe(`${parts.duration} · ${parts.distance}`);
    }
    expect(formatCardioTargetParts({ targetDurationSec: 1200 })).toEqual({
      duration: '20 min',
      distance: null,
    });
    expect(formatCardioTargetParts({ targetDistanceM: 5000 })).toEqual({
      duration: null,
      distance: null,
    });
  });

  it('labels the distance unit of a field in the reader language', () => {
    expect(distanceUnitLabel('km')).toBe('km');
    expect(distanceUnitLabel('mi')).toBe('mi');
    expect(distanceUnitLabel('km', 'ru')).toBe('км');
    expect(distanceUnitLabel('km', 'zh-CN')).toBe('公里');
  });
});

describe('distance unit of a cardio target (issue #576)', () => {
  it('follows the unit the set logger types its distance in: kilometers by default', () => {
    expect(cardioDistanceUnit()).toBe('km');
    // Editor default = logger unit: what the editor stores for "5" is what
    // the logger shows back as "5".
    const stored = distanceInputToM('5');
    expect(stored).toBe(5000);
    expect(distanceMToInput(stored)).toBe('5');
    expect(
      cardioTargetLoggerInputs({ targetDurationSec: 1200, targetDistanceM: stored }).distanceInput,
    ).toBe(distanceMToInput(stored, cardioDistanceUnit()));
    expect(formatTargetDistance(5000)).toBe(
      formatTargetDistance(5000, { distanceUnit: cardioDistanceUnit() }),
    );
  });

  it('converts a distance typed in miles to stored meters and back', () => {
    expect(metersPerDistanceUnit('km')).toBe(1000);
    expect(metersPerDistanceUnit('mi')).toBe(MILES_TO_METERS);
    expect(distanceInputToM('3', 'mi')).toBe(4828);
    expect(distanceInputToM('3,1', 'mi')).toBe(4989);
    expect(distanceMToInput(4828, 'mi')).toBe('3');
    expect(distanceMToInput(5000, 'mi')).toBe('3.11');
    expect(formatTargetDistance(4828, { distanceUnit: 'mi' })).toBe('3 mi');
    expect(
      formatCardioTarget(
        { targetDurationSec: 1800, targetDistanceM: 4828 },
        { distanceUnit: 'mi' },
      ),
    ).toBe('30 min · 3 mi');
  });

  it('applies the same stored bound in either unit', () => {
    expect(maxTargetDistance('km')).toBe(1000);
    expect(maxTargetDistance('mi')).toBe(621);
    expect(distanceInputToM('621', 'mi')).toBe(999400);
    expect(distanceInputToM('622', 'mi')).toBeUndefined();
    expect(distanceInputToM('', 'mi')).toBeNull();
    expect(distanceInputToM('0', 'mi')).toBeUndefined();
    expect(distanceInputToM('abc', 'mi')).toBeUndefined();
  });

  it('keeps the kilometer helpers as the km case of the unit-aware ones', () => {
    expect(kmInputToDistanceM('2.5')).toBe(distanceInputToM('2.5', 'km'));
    expect(distanceMToKmInput(2500)).toBe(distanceMToInput(2500, 'km'));
  });
});

describe('coach payload stays numeric (issue #576)', () => {
  it('carries minutes and kilometers as numbers, whatever the display locale or unit', () => {
    const before = JSON.stringify(
      coachCardioTarget({ category: 'CARDIO' }, { targetDurationSec: 750, targetDistanceM: 2500 }),
    );
    // Formatting for a German reader, in miles, must not leak into it.
    formatCardioTarget(
      { targetDurationSec: 750, targetDistanceM: 2500 },
      { locale: 'de', distanceUnit: 'mi' },
    );
    const after = coachCardioTarget(
      { category: 'CARDIO' },
      { targetDurationSec: 750, targetDistanceM: 2500 },
    );
    expect(JSON.stringify(after)).toBe(before);
    expect(before).toBe('{"targetDurationMin":12.5,"targetDistanceKm":2.5}');
    expect(typeof after.targetDurationMin).toBe('number');
    expect(typeof after.targetDistanceKm).toBe('number');
  });
});

// Distance unit setting (issue #582): the editor, the logger prefill and the
// target text all take the unit resolved from the profile.
describe('cardio target in the user distance unit (issue #582)', () => {
  const miles = cardioDistanceUnit({ distanceUnit: 'MI', unit: 'KG' });

  it('types, shows and prefills in miles for a miles user', () => {
    expect(miles).toBe('mi');
    const stored = distanceInputToM('3', miles);
    expect(stored).toBe(4828);
    expect(distanceMToInput(stored, miles)).toBe('3');
    expect(
      cardioTargetLoggerInputs({ targetDurationSec: 1200, targetDistanceM: stored }, miles)
        .distanceInput,
    ).toBe('3');
    expect(formatCardioTarget({ targetDurationSec: 1200, targetDistanceM: stored }, {
      distanceUnit: miles,
    })).toBe('20 min · 3 mi');
  });

  it('keeps kilometers for every helper called without a unit', () => {
    expect(distanceInputToM('5')).toBe(5000);
    expect(distanceMToInput(5000)).toBe('5');
    expect(formatTargetDistance(5000)).toBe('5 km');
    expect(
      cardioTargetLoggerInputs({ targetDurationSec: 1200, targetDistanceM: 5000 }).distanceInput,
    ).toBe('5');
  });

  it('does not drift when a target typed in kilometers is re-saved in miles', () => {
    const shown = distanceMToInput(5000, 'mi');
    expect(shown).toBe('3.11');
    // Without the stored value the text converts to 5005 m.
    expect(distanceInputToM(shown, 'mi')).toBe(5005);
    // With it, an untouched field keeps the 5000 m it was showing.
    expect(distanceInputToM(shown, 'mi', [5000])).toBe(5000);
    expect(distanceInputToM('3,11', 'mi', [5000])).toBe(5000);
    // A value typed over it is converted once.
    expect(distanceInputToM('3.5', 'mi', [5000])).toBe(5633);
  });

  it('still validates a text that matches nothing shown', () => {
    expect(distanceInputToM('', 'mi', [5000])).toBeNull();
    expect(distanceInputToM('abc', 'mi', [5000])).toBeUndefined();
    expect(distanceInputToM('0', 'mi', [5000])).toBeUndefined();
    expect(distanceInputToM('622', 'mi', [5000])).toBeUndefined();
  });
});
