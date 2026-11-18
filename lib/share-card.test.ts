import { describe, expect, it } from 'vitest';
import {
  ELLIPSIS,
  SHARE_CARD_MAX_EXERCISES,
  bestStrengthSet,
  buildShareCard,
  fitText,
  type ShareCardExercise,
  type ShareCardInput,
  type ShareCardOptions,
  type ShareCardSet,
} from './share-card';

const labels: ShareCardOptions['labels'] = {
  duration: 'Duration',
  minutes: (count) => `${count} min`,
  totalVolume: 'Total volume',
  avgHr: 'Avg HR',
  maxHr: 'Max HR',
  bpm: (value) => `${value} bpm`,
  bodyweight: 'BW',
  more: (count) => `+ ${count} more`,
  noSets: 'No set recorded.',
};

function options(overrides: Partial<ShareCardOptions> = {}): ShareCardOptions {
  return { unit: 'KG', locale: 'en', bodyweight: null, labels, ...overrides };
}

function set(overrides: Partial<ShareCardSet> = {}): ShareCardSet {
  return {
    weight: 100,
    reps: 5,
    isWarmup: false,
    durationSec: null,
    distanceM: null,
    ...overrides,
  };
}

function exercise(overrides: Partial<ShareCardExercise> = {}): ShareCardExercise {
  return {
    id: 'squat',
    name: 'Back Squat',
    isCardio: false,
    usesBodyweight: false,
    sets: [set()],
    ...overrides,
  };
}

function input(overrides: Partial<ShareCardInput> = {}): ShareCardInput {
  return {
    title: 'Leg day',
    date: 'November 17, 2026',
    dateKey: '2026-11-17',
    durationMin: 62,
    avgHr: null,
    maxHr: null,
    exercises: [exercise()],
    ...overrides,
  };
}

describe('buildShareCard (issue #576)', () => {
  it('carries the app name, the title, the date and a dated file name', () => {
    const card = buildShareCard(input(), options());
    expect(card.appName).toBe('GymCoach');
    expect(card.title).toBe('Leg day');
    expect(card.date).toBe('November 17, 2026');
    expect(card.fileName).toBe('gymcoach-2026-11-17.png');
    expect(card.more).toBeNull();
    expect(card.empty).toBeNull();
  });

  it('shows the best set of a strength exercise, not the last or the warm-up', () => {
    const card = buildShareCard(
      input({
        exercises: [
          exercise({
            sets: [
              set({ weight: 140, reps: 3, isWarmup: true }),
              set({ weight: 100, reps: 5 }),
              set({ weight: 110, reps: 5 }),
              set({ weight: 102.5, reps: 3 }),
            ],
          }),
        ],
      }),
      options(),
    );
    expect(card.exercises).toEqual([{ name: 'Back Squat', detail: '110 kg x 5' }]);
  });

  it('sums the working volume and formats it in the user unit', () => {
    const sets = [set({ weight: 100, reps: 5 }), set({ weight: 60, reps: 10, isWarmup: true })];
    const kg = buildShareCard(input({ exercises: [exercise({ sets })] }), options());
    expect(kg.stats).toEqual([
      { label: 'Duration', value: '62 min' },
      { label: 'Total volume', value: '500 kg' },
    ]);
    const lb = buildShareCard(input({ exercises: [exercise({ sets })] }), options({ unit: 'LB' }));
    expect(lb.stats[1]).toEqual({ label: 'Total volume', value: '1,102 lb' });
    expect(lb.exercises[0]!.detail).toBe('220.46 lb x 5');
  });

  it('formats numbers in the locale', () => {
    const card = buildShareCard(
      input({ exercises: [exercise({ sets: [set({ weight: 102.5, reps: 20 })] })] }),
      options({ locale: 'de' }),
    );
    expect(card.exercises[0]!.detail).toBe('102,5 kg x 20');
    expect(card.stats[1]!.value).toBe('2.050 kg');
  });

  it('shows a cardio exercise as its total duration and distance, with no volume tile', () => {
    const card = buildShareCard(
      input({
        exercises: [
          exercise({
            id: 'run',
            name: 'Running',
            isCardio: true,
            sets: [
              set({ weight: 0, reps: 1, durationSec: 300, distanceM: 800, isWarmup: true }),
              set({ weight: 0, reps: 1, durationSec: 1500, distanceM: 5000 }),
              set({ weight: 0, reps: 1, durationSec: 600, distanceM: 1500 }),
            ],
          }),
          exercise({
            id: 'row',
            name: 'Rowing',
            isCardio: true,
            sets: [set({ weight: 0, reps: 1, durationSec: 750 })],
          }),
        ],
      }),
      options(),
    );
    expect(card.exercises).toEqual([
      { name: 'Running', detail: '35:00 · 6.5 km' },
      { name: 'Rowing', detail: '12:30' },
    ]);
    expect(card.stats).toEqual([{ label: 'Duration', value: '62 min' }]);
  });

  it('shows the cardio distance in miles for a miles user (issue #582)', () => {
    const card = buildShareCard(
      input({
        exercises: [
          exercise({
            id: 'run',
            name: 'Running',
            isCardio: true,
            sets: [set({ weight: 0, reps: 1, durationSec: 1800, distanceM: 5000 })],
          }),
        ],
      }),
      options({ distanceUnit: 'mi' }),
    );
    expect(card.exercises).toEqual([{ name: 'Running', detail: '30:00 · 3.11 mi' }]);
  });

  it('shows a dash for a cardio exercise logged without a duration', () => {
    const card = buildShareCard(
      input({
        exercises: [exercise({ isCardio: true, sets: [set({ weight: 0, reps: 1 })] })],
      }),
      options(),
    );
    expect(card.exercises[0]!.detail).toBe('-');
  });

  it('labels bodyweight sets and counts the bodyweight in the volume', () => {
    const exercises = [
      exercise({
        id: 'pullup',
        name: 'Pull-up',
        usesBodyweight: true,
        sets: [set({ weight: 0, reps: 12 }), set({ weight: 10, reps: 6 })],
      }),
      exercise({
        id: 'dip',
        name: 'Assisted Dip',
        usesBodyweight: true,
        sets: [set({ weight: -20, reps: 8 })],
      }),
      exercise({
        id: 'plank',
        name: 'Push-up',
        usesBodyweight: false,
        sets: [set({ weight: 0, reps: 20 }), set({ weight: 0, reps: 25 })],
      }),
    ];
    const card = buildShareCard(input({ exercises }), options({ bodyweight: 80 }));
    expect(card.exercises).toEqual([
      // 80 x 12 estimates 112, 90 x 6 estimates 108: the unweighted set wins.
      { name: 'Pull-up', detail: 'BW x 12' },
      { name: 'Assisted Dip', detail: 'BW-20 kg x 8' },
      { name: 'Push-up', detail: 'BW x 25' },
    ]);
    // 80x12 + 90x6 + 60x8 = 1980; unloaded push-ups count 0.
    expect(card.stats[1]).toEqual({ label: 'Total volume', value: '1,980 kg' });
  });

  it('ranks bodyweight sets on the external load when the bodyweight is unknown', () => {
    const best = bestStrengthSet(
      { usesBodyweight: true, sets: [set({ weight: 0, reps: 12 }), set({ weight: 10, reps: 6 })] },
      null,
    );
    expect(best).toMatchObject({ weight: 10, reps: 6 });
  });

  it('falls back to a warm-up when it is all that was logged', () => {
    const card = buildShareCard(
      input({ exercises: [exercise({ sets: [set({ weight: 40, reps: 8, isWarmup: true })] })] }),
      options(),
    );
    expect(card.exercises[0]!.detail).toBe('40 kg x 8');
    expect(card.stats.map((s) => s.label)).toEqual(['Duration']);
  });

  it('reports an empty session instead of a list', () => {
    const card = buildShareCard(
      input({ durationMin: null, exercises: [exercise({ sets: [] })] }),
      options(),
    );
    expect(card.exercises).toEqual([]);
    expect(card.stats).toEqual([]);
    expect(card.empty).toBe('No set recorded.');
    expect(card.more).toBeNull();
    expect(bestStrengthSet({ usesBodyweight: false, sets: [] }, null)).toBeNull();
  });

  it('keeps the first exercises and counts the rest', () => {
    const exercises = Array.from({ length: 11 }, (_, i) =>
      exercise({ id: `ex-${i}`, name: `Exercise ${i + 1}` }),
    );
    const card = buildShareCard(input({ exercises }), options());
    expect(card.exercises).toHaveLength(SHARE_CARD_MAX_EXERCISES);
    expect(card.exercises[0]!.name).toBe('Exercise 1');
    expect(card.exercises[7]!.name).toBe('Exercise 8');
    expect(card.more).toBe('+ 3 more');
    // The hidden exercises still count in the total: 11 x 500.
    expect(card.stats[1]!.value).toBe('5,500 kg');
  });

  it('merges the blocks of a repeated exercise into one line', () => {
    const card = buildShareCard(
      input({
        exercises: [
          exercise({ sets: [set({ weight: 120, reps: 3 })] }),
          exercise({ id: 'curl', name: 'Curl', sets: [set({ weight: 20, reps: 10 })] }),
          exercise({ sets: [set({ weight: 80, reps: 10 })] }),
        ],
      }),
      options(),
    );
    expect(card.exercises).toEqual([
      { name: 'Back Squat', detail: '120 kg x 3' },
      { name: 'Curl', detail: '20 kg x 10' },
    ]);
  });

  it('adds the session heart rate when present', () => {
    const card = buildShareCard(input({ avgHr: 128, maxHr: 171 }), options());
    expect(card.stats.slice(2)).toEqual([
      { label: 'Avg HR', value: '128 bpm' },
      { label: 'Max HR', value: '171 bpm' },
    ]);
    const onlyMax = buildShareCard(input({ maxHr: 171 }), options());
    expect(onlyMax.stats.map((s) => s.label)).toEqual(['Duration', 'Total volume', 'Max HR']);
  });
});

describe('fitText', () => {
  // One unit per code point: widths are easy to reason about.
  const measure = (value: string) => Array.from(value).length;

  it('returns the text unchanged when it fits', () => {
    expect(fitText('Bench Press', 11, measure)).toBe('Bench Press');
  });

  it('cuts with an ellipsis and never exceeds the width', () => {
    const cut = fitText('Romanian Deadlift', 9, measure);
    expect(cut).toBe(`Romanian${ELLIPSIS}`);
    expect(measure(cut)).toBeLessThanOrEqual(9);
  });

  it('does not leave a space before the ellipsis', () => {
    expect(fitText('Romanian Deadlift', 10, measure)).toBe(`Romanian${ELLIPSIS}`);
  });

  it('does not split a surrogate pair', () => {
    const flex = String.fromCodePoint(0x1f4aa);
    expect(fitText(`${flex}${flex}${flex}${flex}`, 3, measure)).toBe(`${flex}${flex}${ELLIPSIS}`);
  });

  it('returns an empty string when nothing fits', () => {
    expect(fitText('Squat', 0, measure)).toBe('');
    expect(fitText('Squat', 1, measure)).toBe(ELLIPSIS);
  });
});
