import { describe, expect, it } from 'vitest';
import {
  TARGET_HR_MAX,
  TARGET_HR_MIN,
  TARGET_RPE_MAX,
  TARGET_RPE_MIN,
  coachCardioTarget,
  formatCardioIntensity,
  formatCardioTarget,
  formatCardioTargetParts,
  formatTargetHeartRate,
  formatTargetRpe,
  heartRateInputsToRange,
  optionalIntInput,
  targetHeartRateRange,
} from '@/lib/cardio-target';
import { AVG_HR_MAX, AVG_HR_MIN } from '@/lib/cardio';
import { programExerciseInputSchema } from '@/lib/schemas/program-exercise';
import { buildPrintSheet } from '@/lib/print-sheet';

// Intensity of the cardio target of a programmed exercise (issue #558,
// slice 2): a target RPE from 1 to 10 and a heart rate range in bpm.

const cardio = { category: 'CARDIO' as const };

describe('bounds of the intensity targets', () => {
  it('uses the 1 to 10 RPE scale and the heart rate window of a logged set', () => {
    expect([TARGET_RPE_MIN, TARGET_RPE_MAX]).toEqual([1, 10]);
    expect([TARGET_HR_MIN, TARGET_HR_MAX]).toEqual([AVG_HR_MIN, AVG_HR_MAX]);
    expect([TARGET_HR_MIN, TARGET_HR_MAX]).toEqual([40, 250]);
  });
});

describe('targetHeartRateRange', () => {
  it('returns the range when both bounds are set and in order', () => {
    expect(targetHeartRateRange({ targetHrMin: 140, targetHrMax: 150 })).toEqual({
      min: 140,
      max: 150,
    });
    expect(targetHeartRateRange({ targetHrMin: 145, targetHrMax: 145 })).toEqual({
      min: 145,
      max: 145,
    });
  });

  it('reads half a range, a reversed range or no range as no target', () => {
    expect(targetHeartRateRange({})).toBeNull();
    expect(targetHeartRateRange({ targetHrMin: null, targetHrMax: null })).toBeNull();
    expect(targetHeartRateRange({ targetHrMin: 140, targetHrMax: null })).toBeNull();
    expect(targetHeartRateRange({ targetHrMin: null, targetHrMax: 150 })).toBeNull();
    expect(targetHeartRateRange({ targetHrMin: 150, targetHrMax: 140 })).toBeNull();
    expect(targetHeartRateRange({ targetHrMin: 0, targetHrMax: 140 })).toBeNull();
  });
});

describe('formatting the intensity', () => {
  it('writes the effort with the untranslated acronym', () => {
    expect(formatTargetRpe(6)).toBe('RPE 6');
    expect(formatTargetRpe(10)).toBe('RPE 10');
  });

  it('writes a heart rate range with a hyphen, and one value when the bounds are equal', () => {
    expect(formatTargetHeartRate({ min: 140, max: 150 })).toBe('140-150 bpm');
    expect(formatTargetHeartRate({ min: 145, max: 145 })).toBe('145 bpm');
  });

  it('lets the caller write the unit in the reader language', () => {
    const ru = (value: string) => `${value} уд/мин`;
    expect(formatTargetHeartRate({ min: 140, max: 150 }, ru)).toBe('140-150 уд/мин');
    expect(
      formatCardioTarget(
        { targetDurationSec: 1200, targetHrMin: 140, targetHrMax: 150 },
        { locale: 'ru', bpm: ru },
      ),
    ).toMatch(/ · 140-150 уд\/мин$/);
  });

  it('reads "20 min · RPE 6 · 140-150 bpm" for a full intensity target', () => {
    expect(
      formatCardioTarget({
        targetDurationSec: 1200,
        targetRpe: 6,
        targetHrMin: 140,
        targetHrMax: 150,
      }),
    ).toBe('20 min · RPE 6 · 140-150 bpm');
  });

  it('puts the intensity after the distance, and each half alone when only one is set', () => {
    expect(
      formatCardioTarget({
        targetDurationSec: 1200,
        targetDistanceM: 5000,
        targetRpe: 6,
        targetHrMin: 140,
        targetHrMax: 150,
      }),
    ).toBe('20 min · 5 km · RPE 6 · 140-150 bpm');
    expect(formatCardioTarget({ targetDurationSec: 1200, targetRpe: 4 })).toBe('20 min · RPE 4');
    expect(formatCardioTarget({ targetDurationSec: 1200, targetHrMin: 120, targetHrMax: 135 })).toBe(
      '20 min · 120-135 bpm',
    );
  });

  it('leaves a target without intensity exactly as slice 1 wrote it', () => {
    expect(formatCardioTarget({ targetDurationSec: 1200 })).toBe('20 min');
    expect(formatCardioTarget({ targetDurationSec: 1200, targetDistanceM: 5000 })).toBe(
      '20 min · 5 km',
    );
    expect(
      formatCardioTarget({
        targetDurationSec: 1200,
        targetRpe: null,
        targetHrMin: null,
        targetHrMax: null,
      }),
    ).toBe('20 min');
  });

  it('shows no intensity without a duration target', () => {
    const noDuration = { targetDurationSec: null, targetRpe: 6, targetHrMin: 140, targetHrMax: 150 };
    expect(formatCardioIntensity(noDuration)).toBeNull();
    expect(formatCardioTarget(noDuration)).toBeNull();
  });

  it('leaves the intensity out of the line when the caller shows it elsewhere', () => {
    const target = {
      targetDurationSec: 1200,
      targetDistanceM: 5000,
      targetRpe: 6,
      targetHrMin: 140,
      targetHrMax: 150,
    };
    expect(formatCardioTarget(target, { intensity: false })).toBe('20 min · 5 km');
    expect(formatCardioTarget(target, { intensity: true })).toBe(
      '20 min · 5 km · RPE 6 · 140-150 bpm',
    );
  });

  it('returns the intensity alone for the set logger', () => {
    expect(
      formatCardioIntensity({
        targetDurationSec: 1200,
        targetDistanceM: 5000,
        targetRpe: 6,
        targetHrMin: 140,
        targetHrMax: 150,
      }),
    ).toBe('RPE 6 · 140-150 bpm');
    expect(formatCardioIntensity({ targetDurationSec: 1200, targetRpe: 6 })).toBe('RPE 6');
    expect(formatCardioIntensity({ targetDurationSec: 1200 })).toBeNull();
  });

  it('ignores an RPE out of the scale and half a heart rate range', () => {
    expect(formatCardioTarget({ targetDurationSec: 1200, targetRpe: 0 })).toBe('20 min');
    expect(formatCardioTarget({ targetDurationSec: 1200, targetRpe: 11 })).toBe('20 min');
    expect(formatCardioTarget({ targetDurationSec: 1200, targetRpe: 6.5 })).toBe('20 min');
    expect(formatCardioTarget({ targetDurationSec: 1200, targetHrMin: 140 })).toBe('20 min');
  });

  it('keeps the duration and distance boxes of the print sheet free of the intensity', () => {
    expect(
      formatCardioTargetParts({
        targetDurationSec: 1200,
        targetDistanceM: 5000,
        targetRpe: 6,
        targetHrMin: 140,
        targetHrMax: 150,
      }),
    ).toEqual({ duration: '20 min', distance: '5 km' });
  });
});

describe('print sheet plan of a cardio row', () => {
  it('prints the intensity in the plan and leaves the boxes as they were', () => {
    const sheet = buildPrintSheet(
      [
        {
          id: 'a',
          order: 1,
          supersetGroup: null,
          exercise: { name: 'Running', category: 'CARDIO' },
          targetSets: 1,
          targetRepsMin: 1,
          targetRepsMax: 1,
          targetRIR: 0,
          restSec: 60,
          tempo: null,
          notes: null,
          targetDurationSec: 1200,
          targetDistanceM: null,
          targetRpe: 6,
          targetHrMin: 140,
          targetHrMax: 150,
        },
      ],
      { bpm: (value) => `${value} ppm` },
    );
    expect(sheet.rows[0]!.cardioTarget).toBe('20 min · RPE 6 · 140-150 ppm');
    expect(sheet.rows[0]!.cells).toEqual([
      { set: 1, kind: 'duration', target: '20 min' },
      { set: 1, kind: 'distance' },
    ]);
  });
});

describe('editor inputs', () => {
  it('reads an optional whole number within bounds', () => {
    expect(optionalIntInput('', 1, 10)).toBeNull();
    expect(optionalIntInput('   ', 1, 10)).toBeNull();
    expect(optionalIntInput('6', 1, 10)).toBe(6);
    expect(optionalIntInput(' 10 ', 1, 10)).toBe(10);
    expect(optionalIntInput('0', 1, 10)).toBeUndefined();
    expect(optionalIntInput('11', 1, 10)).toBeUndefined();
    expect(optionalIntInput('6.5', 1, 10)).toBeUndefined();
    expect(optionalIntInput('-3', 1, 10)).toBeUndefined();
    expect(optionalIntInput('1e1', 1, 10)).toBeUndefined();
    expect(optionalIntInput('abc', 1, 10)).toBeUndefined();
  });

  it('reads the two heart rate fields as a range, both or neither', () => {
    expect(heartRateInputsToRange('', '')).toBeNull();
    expect(heartRateInputsToRange('140', '150')).toEqual({ min: 140, max: 150 });
    expect(heartRateInputsToRange('145', '145')).toEqual({ min: 145, max: 145 });
    expect(heartRateInputsToRange('40', '250')).toEqual({ min: 40, max: 250 });
    // One bound alone, a reversed range and out-of-window values are refused.
    expect(heartRateInputsToRange('140', '')).toBeUndefined();
    expect(heartRateInputsToRange('', '150')).toBeUndefined();
    expect(heartRateInputsToRange('150', '140')).toBeUndefined();
    expect(heartRateInputsToRange('39', '150')).toBeUndefined();
    expect(heartRateInputsToRange('140', '251')).toBeUndefined();
    expect(heartRateInputsToRange('140.5', '150')).toBeUndefined();
  });
});

describe('coach payload', () => {
  it('carries the RPE and the heart rate range as plain numbers', () => {
    expect(
      coachCardioTarget(cardio, {
        targetDurationSec: 1200,
        targetRpe: 6,
        targetHrMin: 140,
        targetHrMax: 150,
      }),
    ).toEqual({ targetDurationMin: 20, targetRpe: 6, targetHrMinBpm: 140, targetHrMaxBpm: 150 });
  });

  it('omits each intensity key that is not set, so slice 1 payloads are unchanged', () => {
    expect(coachCardioTarget(cardio, { targetDurationSec: 1200, targetDistanceM: 5000 })).toEqual({
      targetDurationMin: 20,
      targetDistanceKm: 5,
    });
    expect(
      coachCardioTarget(cardio, {
        targetDurationSec: 1200,
        targetRpe: null,
        targetHrMin: null,
        targetHrMax: null,
      }),
    ).toEqual({ targetDurationMin: 20 });
    expect(coachCardioTarget(cardio, { targetDurationSec: 1200, targetHrMin: 140 })).toEqual({
      targetDurationMin: 20,
    });
  });

  it('adds nothing on a strength row or a cardio row without a duration', () => {
    const intensity = { targetRpe: 6, targetHrMin: 140, targetHrMax: 150 };
    expect(
      coachCardioTarget({ category: 'COMPOUND' }, { targetDurationSec: 1200, ...intensity }),
    ).toEqual({});
    expect(coachCardioTarget(cardio, { targetDurationSec: null, ...intensity })).toEqual({});
  });
});

describe('programExerciseInputSchema: intensity targets', () => {
  const valid = {
    exerciseId: 'ex1',
    targetSets: 1,
    targetRepsMin: 1,
    targetRepsMax: 1,
    targetRIR: 0,
    restSec: 60,
    targetDurationSec: 1200,
  };
  const ok = (extra: Record<string, unknown>) =>
    programExerciseInputSchema.safeParse({ ...valid, ...extra }).success;

  it('accepts a target, null, or absent as three distinct states', () => {
    const set = programExerciseInputSchema.parse({
      ...valid,
      targetRpe: 6,
      targetHrMin: 140,
      targetHrMax: 150,
    });
    expect(set).toMatchObject({ targetRpe: 6, targetHrMin: 140, targetHrMax: 150 });

    const cleared = programExerciseInputSchema.parse({
      ...valid,
      targetRpe: null,
      targetHrMin: null,
      targetHrMax: null,
    });
    expect(cleared.targetRpe).toBeNull();
    expect(cleared.targetHrMin).toBeNull();
    expect(cleared.targetHrMax).toBeNull();

    const absent = programExerciseInputSchema.parse(valid);
    expect(absent.targetRpe).toBeUndefined();
    expect(absent.targetHrMin).toBeUndefined();
    expect(absent.targetHrMax).toBeUndefined();
  });

  it('bounds the RPE to whole numbers from 1 to 10', () => {
    expect(ok({ targetRpe: 1 })).toBe(true);
    expect(ok({ targetRpe: 10 })).toBe(true);
    expect(ok({ targetRpe: 0 })).toBe(false);
    expect(ok({ targetRpe: 11 })).toBe(false);
    expect(ok({ targetRpe: 6.5 })).toBe(false);
    expect(ok({ targetRpe: '6' })).toBe(false);
  });

  it('bounds each heart rate to whole numbers from 40 to 250', () => {
    expect(ok({ targetHrMin: 40, targetHrMax: 250 })).toBe(true);
    expect(ok({ targetHrMin: 39, targetHrMax: 150 })).toBe(false);
    expect(ok({ targetHrMin: 140, targetHrMax: 251 })).toBe(false);
    expect(ok({ targetHrMin: 140.5, targetHrMax: 150 })).toBe(false);
    expect(ok({ targetHrMin: '140', targetHrMax: 150 })).toBe(false);
  });

  it('takes the heart rate as a whole range in order', () => {
    expect(ok({ targetHrMin: 145, targetHrMax: 145 })).toBe(true);
    expect(ok({ targetHrMin: 150, targetHrMax: 140 })).toBe(false);
    expect(ok({ targetHrMin: 140 })).toBe(false);
    expect(ok({ targetHrMax: 150 })).toBe(false);
    expect(ok({ targetHrMin: 140, targetHrMax: null })).toBe(false);
    expect(ok({ targetHrMin: null, targetHrMax: 150 })).toBe(false);
    expect(ok({ targetHrMin: null })).toBe(false);
  });

  it('refuses an intensity sent while the duration is cleared', () => {
    expect(ok({ targetDurationSec: null, targetRpe: 6 })).toBe(false);
    expect(ok({ targetDurationSec: null, targetHrMin: 140, targetHrMax: 150 })).toBe(false);
    expect(
      ok({ targetDurationSec: null, targetRpe: null, targetHrMin: null, targetHrMax: null }),
    ).toBe(true);
  });
});
