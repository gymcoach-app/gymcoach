import { describe, it, expect } from 'vitest';
import {
  cardioDistanceUnit,
  distanceInUnit,
  distanceToM,
  formatCardioSet,
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  isCardioSet,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  MILES_TO_METERS,
  paceSecPerKm,
  parseDurationToSec,
  speedKmh,
  sumCardioWorkingSets,
  trackDecoupling,
} from './cardio';

describe('isCardioSet', () => {
  it('is true only when durationSec is set', () => {
    expect(isCardioSet({ durationSec: 600 })).toBe(true);
    expect(isCardioSet({ durationSec: null })).toBe(false);
    expect(isCardioSet({})).toBe(false);
  });
});

describe('parseDurationToSec', () => {
  it('parses mm:ss', () => {
    expect(parseDurationToSec('12:30')).toBe(750);
    expect(parseDurationToSec('0:45')).toBe(45);
  });

  it('parses h:mm:ss', () => {
    expect(parseDurationToSec('1:05:00')).toBe(3900);
  });

  it('accepts "." and "," as separators (numeric keyboards have no colon)', () => {
    expect(parseDurationToSec('11.46')).toBe(706);
    expect(parseDurationToSec('11,46')).toBe(706);
    expect(parseDurationToSec('1.05.00')).toBe(3900);
    expect(parseDurationToSec('12.75')).toBeNull();
    expect(parseDurationToSec('11..46')).toBeNull();
  });

  it('parses plain digits as minutes', () => {
    expect(parseDurationToSec('45')).toBe(2700);
    expect(parseDurationToSec(' 5 ')).toBe(300);
  });

  it('rejects invalid or out-of-bounds input', () => {
    expect(parseDurationToSec('')).toBeNull();
    expect(parseDurationToSec('abc')).toBeNull();
    expect(parseDurationToSec('12:75')).toBeNull();
    expect(parseDurationToSec('-5')).toBeNull();
    expect(parseDurationToSec('0:00')).toBeNull(); // below 1 second
    expect(parseDurationToSec('999:00:00')).toBeNull(); // over 24h
  });

  it('round-trips with formatDuration', () => {
    for (const sec of [45, 750, 3600, 3900, MAX_DURATION_SEC]) {
      expect(parseDurationToSec(formatDuration(sec))).toBe(sec);
    }
  });
});

describe('formatDuration', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatDuration(750)).toBe('12:30');
    expect(formatDuration(45)).toBe('0:45');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatDuration(3900)).toBe('1:05:00');
    expect(formatDuration(3600)).toBe('1:00:00');
  });
});

describe('formatDistance', () => {
  it('renders kilometers with up to 2 decimals, trimmed', () => {
    expect(formatDistance(2500)).toBe('2.5 km');
    expect(formatDistance(10000)).toBe('10 km');
    expect(formatDistance(21097.5)).toBe('21.1 km');
  });
});

describe('formatCardioSet', () => {
  it('shows duration and distance when both are present', () => {
    expect(formatCardioSet(750, 2500)).toBe('12:30 · 2.5 km');
  });

  it('shows duration only when distance is absent or zero', () => {
    expect(formatCardioSet(750, null)).toBe('12:30');
    expect(formatCardioSet(750, 0)).toBe('12:30');
  });
});

describe('paceSecPerKm', () => {
  it('derives seconds per kilometer', () => {
    // 30:00 over 5 km -> 6:00 /km.
    expect(paceSecPerKm(1800, 5000)).toBe(360);
  });

  it('returns null for zero/absent distance (no divide-by-zero)', () => {
    expect(paceSecPerKm(1800, 0)).toBeNull();
    expect(paceSecPerKm(1800, null)).toBeNull();
    expect(paceSecPerKm(1800, undefined)).toBeNull();
  });
});

describe('speedKmh', () => {
  it('derives kilometers per hour', () => {
    // 5 km in 30:00 -> 10 km/h.
    expect(speedKmh(1800, 5000)).toBe(10);
  });

  it('returns null for zero/absent distance or zero duration', () => {
    expect(speedKmh(1800, 0)).toBeNull();
    expect(speedKmh(1800, null)).toBeNull();
    expect(speedKmh(0, 5000)).toBeNull();
  });
});

describe('formatPace', () => {
  it('formats metric pace as mm:ss /km', () => {
    expect(formatPace(1800, 5000, 'km')).toBe('6:00 /km');
  });

  it('formats imperial pace as mm:ss /mi', () => {
    // 6:00 /km -> 6:00 * 1.60934 = 579.4 s/mi -> 9:39.
    expect(formatPace(1800, 5000, 'mi')).toBe('9:39 /mi');
  });

  it('returns null when there is no distance', () => {
    expect(formatPace(1800, 0, 'km')).toBeNull();
    expect(formatPace(1800, null, 'mi')).toBeNull();
  });
});

describe('formatSpeed', () => {
  it('formats metric speed as km/h', () => {
    expect(formatSpeed(1800, 5000, 'km')).toBe('10 km/h');
  });

  it('formats imperial speed as mph', () => {
    // 10 km/h -> 10 / 1.60934 = 6.21 mph -> 6.2.
    expect(formatSpeed(1800, 5000, 'mi')).toBe('6.2 mph');
  });

  it('returns null when there is no distance', () => {
    expect(formatSpeed(1800, 0, 'km')).toBeNull();
    expect(formatSpeed(1800, null, 'mi')).toBeNull();
  });
});

describe('sumCardioWorkingSets (issue #183)', () => {
  it('excludes warmup sets from the duration and distance totals', () => {
    const sets = [
      { durationSec: 300, distanceM: 800, isWarmup: true }, // warmup, excluded
      { durationSec: 1800, distanceM: 5000, isWarmup: false },
      { durationSec: 600, distanceM: 2000, isWarmup: false },
    ];
    expect(sumCardioWorkingSets(sets)).toEqual({ durationSec: 2400, distanceM: 7000 });
  });

  it('treats absent duration/distance as 0 and handles an all-warmup list', () => {
    expect(
      sumCardioWorkingSets([{ durationSec: 1800, distanceM: null, isWarmup: false }]),
    ).toEqual({ durationSec: 1800, distanceM: 0 });
    expect(
      sumCardioWorkingSets([{ durationSec: 300, distanceM: 800, isWarmup: true }]),
    ).toEqual({ durationSec: 0, distanceM: 0 });
  });
});

describe('trackDecoupling (issue #268)', () => {
  // 5 points at a constant 3 m/s: t 0..400 every 100 s, d = 3 * t.
  const steadyDistance = [0, 100, 200, 300, 400].map((t) => ({ t, d: t * 3 }));

  it('is ~0% for a steady track (same speed, same HR in both halves)', () => {
    const track = steadyDistance.map((p) => ({ ...p, hr: 150 }));
    expect(trackDecoupling(track)).toBeCloseTo(0, 5);
  });

  it('is positive when HR drifts up at constant speed', () => {
    // First half at 140 bpm, second half rising to 154 bpm. With the boundary
    // sample shared, avg HR is 140 vs 149.333 -> exactly 6.25% decoupling.
    const hrs = [140, 140, 140, 154, 154];
    const track = steadyDistance.map((p, i) => ({ ...p, hr: hrs[i]! }));
    expect(trackDecoupling(track)).toBeCloseTo(6.25, 2);
  });

  it('is positive when the pace fades at constant HR', () => {
    // 3 m/s for the first half, 2 m/s for the second -> (1 - 2/3) * 100.
    const ds = [0, 300, 600, 800, 1000];
    const track = ds.map((d, i) => ({ t: i * 100, d, hr: 150 }));
    expect(trackDecoupling(track)).toBeCloseTo(33.333, 2);
  });

  it('is negative for a negative split (faster second half at the same HR)', () => {
    // 2 m/s then 3 m/s -> (1 - 3/2) * 100 = -50%.
    const ds = [0, 200, 400, 700, 1000];
    const track = ds.map((d, i) => ({ t: i * 100, d, hr: 150 }));
    expect(trackDecoupling(track)).toBeCloseTo(-50, 2);
  });

  it('splits at the time midpoint, not at the middle sample index', () => {
    // Samples clustered in the first 30 s plus one late point: the time
    // midpoint (t=200) puts the first four points in the first half. 3 m/s
    // for 30 s then 1 m/s for 370 s at constant HR -> (1 - 1/3) * 100.
    const track = [
      { t: 0, d: 0, hr: 150 },
      { t: 10, d: 30, hr: 150 },
      { t: 20, d: 60, hr: 150 },
      { t: 30, d: 90, hr: 150 },
      { t: 400, d: 460, hr: 150 },
    ];
    expect(trackDecoupling(track)).toBeCloseTo(66.667, 2);
  });

  it('sorts by time, so an out-of-order track still computes', () => {
    const track = steadyDistance.map((p) => ({ ...p, hr: 150 })).reverse();
    expect(trackDecoupling(track)).toBeCloseTo(0, 5);
  });

  it('is null when the track lacks distance or heart rate', () => {
    expect(trackDecoupling(steadyDistance)).toBeNull(); // no HR
    expect(
      trackDecoupling([0, 100, 200, 300, 400].map((t) => ({ t, hr: 150 }))),
    ).toBeNull(); // no distance
  });

  it('is null with fewer than two usable samples per half', () => {
    expect(trackDecoupling([])).toBeNull();
    expect(
      trackDecoupling([
        { t: 0, d: 0, hr: 140 },
        { t: 100, d: 300, hr: 145 },
        { t: 200, d: 600, hr: 150 },
      ]),
    ).toBeNull();
  });

  it('ignores samples missing either field when counting usable points', () => {
    // Only 3 of the 5 points carry both d and hr -> below the threshold.
    const track = [
      { t: 0, d: 0, hr: 140 },
      { t: 100, d: 300 },
      { t: 200, d: 600, hr: 150 },
      { t: 300, hr: 155 },
      { t: 400, d: 1200, hr: 160 },
    ];
    expect(trackDecoupling(track)).toBeNull();
  });

  it('is null for a degenerate track (no distance covered or no time elapsed)', () => {
    expect(
      trackDecoupling([0, 100, 200, 300, 400].map((t) => ({ t, d: 500, hr: 150 }))),
    ).toBeNull(); // distance never advances
    expect(
      trackDecoupling([
        { t: 0, d: 0, hr: 150 },
        { t: 0, d: 100, hr: 150 },
        { t: 0, d: 200, hr: 150 },
        { t: 0, d: 300, hr: 150 },
      ]),
    ).toBeNull(); // all at the same instant
  });
});

// Distance unit setting (issue #582).
describe('cardioDistanceUnit', () => {
  it('is kilometers without a profile', () => {
    expect(cardioDistanceUnit()).toBe('km');
    expect(cardioDistanceUnit(null)).toBe('km');
    expect(cardioDistanceUnit({})).toBe('km');
  });

  it('follows the weight unit while the preference is automatic', () => {
    expect(cardioDistanceUnit({ distanceUnit: null, unit: 'KG' })).toBe('km');
    expect(cardioDistanceUnit({ distanceUnit: null, unit: 'LB' })).toBe('mi');
    expect(cardioDistanceUnit({ unit: 'LB' })).toBe('mi');
  });

  it('lets an explicit preference win over the weight unit', () => {
    expect(cardioDistanceUnit({ distanceUnit: 'KM', unit: 'LB' })).toBe('km');
    expect(cardioDistanceUnit({ distanceUnit: 'MI', unit: 'KG' })).toBe('mi');
    expect(cardioDistanceUnit({ distanceUnit: 'MI' })).toBe('mi');
  });
});

describe('distance in the user unit', () => {
  it('converts stored meters to the unit, rounded to 2 decimals', () => {
    expect(distanceInUnit(2500)).toBe(2.5);
    expect(distanceInUnit(2500, 'km')).toBe(2.5);
    expect(distanceInUnit(5000, 'mi')).toBe(3.11);
    expect(distanceInUnit(8047, 'mi')).toBe(5);
    expect(distanceInUnit(42195, 'mi')).toBe(26.22);
  });

  it('formats a distance in kilometers by default and in miles on request', () => {
    expect(formatDistance(5000)).toBe('5 km');
    expect(formatDistance(5000, 'km')).toBe('5 km');
    expect(formatDistance(5000, 'mi')).toBe('3.11 mi');
    expect(formatDistance(1609.34, 'mi')).toBe('1 mi');
  });

  it('labels a cardio set in the unit', () => {
    expect(formatCardioSet(1800, 5000, 'mi')).toBe('30:00 · 3.11 mi');
    expect(formatCardioSet(1800, 5000, 'km')).toBe('30:00 · 5 km');
    expect(formatCardioSet(1800, null, 'mi')).toBe('30:00');
  });

  it('keeps pace, speed and distance on the same unit', () => {
    expect(formatPace(1800, 5000, 'mi')).toBe('9:39 /mi');
    expect(formatSpeed(1800, 5000, 'mi')).toBe('6.2 mph');
    expect(formatDistance(5000, 'mi')).toContain('mi');
  });
});

describe('distanceToM', () => {
  it('converts a typed distance to whole meters', () => {
    expect(distanceToM(5)).toBe(5000);
    expect(distanceToM(2.5, 'km')).toBe(2500);
    expect(distanceToM(5, 'mi')).toBe(8047);
    expect(distanceToM(3.1, 'mi')).toBe(Math.round(3.1 * MILES_TO_METERS));
  });

  it('reads back exactly what was typed, in either unit, at any 2-decimal value', () => {
    for (const unit of ['km', 'mi'] as const) {
      const max = Math.floor(MAX_DISTANCE_M / (unit === 'mi' ? MILES_TO_METERS : 1000));
      // Every value up to the bound, checked in a plain loop (one assertion
      // per unit) so the sweep stays cheap.
      const drifted: number[] = [];
      for (let hundredths = 1; hundredths <= max * 100; hundredths++) {
        const typed = hundredths / 100;
        const stored = distanceToM(typed, unit);
        const shown = distanceInUnit(stored, unit);
        // Saving what is shown again stores the same meters: no drift.
        if (shown !== typed || distanceToM(shown, unit) !== stored) drifted.push(typed);
      }
      expect(drifted).toEqual([]);
    }
  });

  it('keeps the stored meters of a value the field was only showing', () => {
    // 5000 m reads 3.11 mi; converting 3.11 mi again would give 5005 m.
    expect(distanceToM(3.11, 'mi')).toBe(5005);
    expect(distanceToM(3.11, 'mi', [5000])).toBe(5000);
    // A different value typed over it is converted normally.
    expect(distanceToM(3.2, 'mi', [5000])).toBe(5150);
    // Null and zero candidates are ignored.
    expect(distanceToM(3.11, 'mi', [null, undefined, 0])).toBe(5005);
  });

  it('never drifts over repeated saves after a unit switch', () => {
    let stored = 5000; // typed as 5 km
    for (let i = 0; i < 5; i++) {
      stored = distanceToM(distanceInUnit(stored, 'mi'), 'mi', [stored]);
      stored = distanceToM(distanceInUnit(stored, 'km'), 'km', [stored]);
    }
    expect(stored).toBe(5000);
  });
});
