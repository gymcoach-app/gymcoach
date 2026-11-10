import { describe, expect, it } from 'vitest';
import {
  effortOptions,
  effortToRir,
  effortTone,
  effortValue,
  formatEffort,
  formatEffortValue,
  rirToRpe,
  rpeToRir,
} from './effort';
import { rpeToRir as shorthandRpeToRir } from './set-shorthand';

describe('effort scale conversion', () => {
  it('converts RIR to RPE as 10 - RIR', () => {
    expect([0, 1, 2, 3, 4, 5].map(rirToRpe)).toEqual([10, 9, 8, 7, 6, 5]);
  });

  it('stores RPE 8 as RIR 2 and round-trips every level', () => {
    expect(rpeToRir(8)).toBe(2);
    for (const rir of [0, 1, 2, 3, 4, 5]) expect(rpeToRir(rirToRpe(rir))).toBe(rir);
  });

  it('rounds half steps and clamps out-of-range RPE to the accepted RIR', () => {
    // Math.round rounds .5 up, so RPE 8.5 (RIR 1.5) stores RIR 2.
    expect(rpeToRir(8.5)).toBe(2);
    expect(rpeToRir(9.6)).toBe(0);
    expect(rpeToRir(11)).toBe(0);
    expect(rpeToRir(2)).toBe(5);
  });

  it('agrees with the shorthand parser conversion', () => {
    for (const rpe of [4, 5, 6.5, 7, 8, 8.5, 9, 10, 12])
      expect(rpeToRir(rpe)).toBe(shorthandRpeToRir(rpe));
  });

  it('shows and reads a value on the chosen scale', () => {
    expect(effortValue('RIR', 2)).toBe(2);
    expect(effortValue('RPE', 2)).toBe(8);
    expect(effortToRir('RIR', 2)).toBe(2);
    expect(effortToRir('RPE', 8)).toBe(2);
  });

  it('formats a cell and a labelled value, with a dash for no effort', () => {
    expect(formatEffortValue('RPE', 1)).toBe('9');
    expect(formatEffortValue('RIR', 1)).toBe('1');
    expect(formatEffortValue('RPE', 0)).toBe('10');
    expect(formatEffortValue('RPE', null)).toBe('-');
    expect(formatEffortValue('RIR', undefined)).toBe('-');
    expect(formatEffort('RIR', 2)).toBe('RIR 2');
    expect(formatEffort('RPE', 2)).toBe('RPE 8');
  });

  it('orders the options so both scales read upwards', () => {
    expect(effortOptions('RIR', [0, 1, 2, 3])).toEqual([0, 1, 2, 3]);
    // Stored RIR 3, 2, 1, 0 reads RPE 7, 8, 9, 10.
    expect(effortOptions('RPE', [0, 1, 2, 3])).toEqual([3, 2, 1, 0]);
    expect(effortOptions('RPE', [0, 1, 2, 3]).map(rirToRpe)).toEqual([7, 8, 9, 10]);
  });

  it('bands effort by the stored RIR', () => {
    expect([0, 1, 2, 3, 5].map(effortTone)).toEqual(['max', 'hard', 'moderate', 'easy', 'easy']);
  });
});
