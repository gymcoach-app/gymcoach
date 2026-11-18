import { describe, expect, it } from 'vitest';
import {
  formatWorkoutText,
  type WorkoutTextOptions,
  type WorkoutTextSet,
} from '@/lib/workout-text';

const labels = {
  warmup: 'warm-up',
  dropSet: 'drop set',
  bodyweight: 'BW',
  setNote: (n: number) => `Set ${n}:`,
  notes: 'Notes:',
};

const kg: WorkoutTextOptions = { unit: 'KG', locale: 'en-US', labels };

function set(overrides: Partial<WorkoutTextSet> = {}): WorkoutTextSet {
  return {
    setNumber: 1,
    weight: 100,
    reps: 5,
    isWarmup: false,
    isDropSet: false,
    durationSec: null,
    distanceM: null,
    notes: null,
    ...overrides,
  };
}

describe('formatWorkoutText (issue #405)', () => {
  it('writes a header and one line per exercise, marking warm-ups and drop sets', () => {
    const text = formatWorkoutText(
      {
        title: 'Push day',
        date: 'October 7, 2026',
        notes: null,
        exercises: [
          {
            name: 'Bench press',
            isCardio: false,
            usesBodyweight: false,
            sets: [
              set({ setNumber: 1, weight: 60, reps: 10, isWarmup: true }),
              set({ setNumber: 2, weight: 100, reps: 5 }),
              set({ setNumber: 3, weight: 102.5, reps: 5 }),
              set({ setNumber: 4, weight: 80, reps: 8, isDropSet: true }),
            ],
          },
        ],
      },
      kg,
    );
    expect(text).toBe(
      [
        'Push day - October 7, 2026',
        '',
        'Bench press: 60 kg x 10 (warm-up), 100 kg x 5, 102.5 kg x 5, 80 kg x 8 (drop set)',
      ].join('\n'),
    );
  });

  it('converts stored kilograms to pounds for a pound user', () => {
    const text = formatWorkoutText(
      {
        title: 'Pull',
        date: 'today',
        notes: null,
        exercises: [
          { name: 'Row', isCardio: false, usesBodyweight: false, sets: [set({ weight: 45.359237 })] },
        ],
      },
      { ...kg, unit: 'LB' },
    );
    expect(text).toContain('Row: 100 lb x 5');
  });

  it('writes bodyweight loads as BW, BW+added and BW-assisted', () => {
    const text = formatWorkoutText(
      {
        title: 'Calisthenics',
        date: 'today',
        notes: null,
        exercises: [
          {
            name: 'Dip',
            isCardio: false,
            usesBodyweight: true,
            sets: [
              set({ weight: 0, reps: 12 }),
              set({ weight: 10, reps: 8 }),
              set({ weight: -15, reps: 6 }),
            ],
          },
          {
            name: 'Plank shoulder tap',
            isCardio: false,
            usesBodyweight: false,
            sets: [set({ weight: 0, reps: 20 })],
          },
        ],
      },
      kg,
    );
    expect(text).toContain('Dip: BW x 12, BW+10 kg x 8, BW-15 kg x 6');
    expect(text).toContain('Plank shoulder tap: BW x 20');
  });

  it('writes cardio sets as duration and distance', () => {
    const text = formatWorkoutText(
      {
        title: 'Run',
        date: 'today',
        notes: null,
        exercises: [
          {
            name: 'Running',
            isCardio: true,
            usesBodyweight: false,
            sets: [
              set({ weight: 0, reps: 0, durationSec: 600, isWarmup: true }),
              set({ weight: 0, reps: 0, durationSec: 1530, distanceM: 5000 }),
              set({ weight: 0, reps: 0 }),
            ],
          },
        ],
      },
      kg,
    );
    expect(text).toContain('Running: 10:00 (warm-up), 25:30 · 5 km, -');
  });

  it('writes the cardio distance in miles for a miles user (issue #582)', () => {
    const text = formatWorkoutText(
      {
        title: 'Run',
        date: 'today',
        notes: null,
        exercises: [
          {
            name: 'Running',
            isCardio: true,
            usesBodyweight: false,
            sets: [set({ weight: 0, reps: 0, durationSec: 1530, distanceM: 8047 })],
          },
        ],
      },
      { ...kg, distanceUnit: 'mi' },
    );
    expect(text).toContain('Running: 25:30 · 5 mi');
  });

  it('appends set notes under their exercise and the session notes last', () => {
    const text = formatWorkoutText(
      {
        title: 'Legs',
        date: 'today',
        notes: '  Felt strong.  ',
        exercises: [
          {
            name: 'Squat',
            isCardio: false,
            usesBodyweight: false,
            sets: [set({ setNumber: 1 }), set({ setNumber: 2, notes: ' Belt on ' })],
          },
          { name: 'Empty', isCardio: false, usesBodyweight: false, sets: [] },
        ],
      },
      kg,
    );
    expect(text).toBe(
      [
        'Legs - today',
        '',
        'Squat: 100 kg x 5, 100 kg x 5',
        '  Set 2: Belt on',
        '',
        'Notes: Felt strong.',
      ].join('\n'),
    );
  });

  it('uses the locale decimal separator', () => {
    const text = formatWorkoutText(
      {
        title: 'Push',
        date: '7 octobre 2026',
        notes: null,
        exercises: [
          {
            name: 'Développé couché',
            isCardio: false,
            usesBodyweight: false,
            sets: [set({ weight: 102.5 })],
          },
        ],
      },
      { ...kg, locale: 'fr-FR' },
    );
    expect(text).toContain('Développé couché: 102,5 kg x 5');
  });
});
