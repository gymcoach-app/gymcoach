import { describe, expect, it } from 'vitest';
import {
  applyBodyweight,
  best1RM,
  classifyWeeklySets,
  dailyConditioning,
  effectiveWeight,
  estimate1RM,
  estimateRepMax,
  exerciseProgress,
  isoWeekKey,
  isoWeekStart,
  isStalled,
  resolveVolumeBand,
  setVolume,
  STALL_LOOKBACK_SESSIONS,
  STALL_TOLERANCE,
  totalVolume,
  trainingConsistency,
  weeklyConditioning,
  weeklyFrequencyByMuscleGroup,
  weeklySetsByMuscleGroup,
  weeklyVolumeByMuscleGroup,
  WEEKLY_SETS_MEV,
  WEEKLY_SETS_MRV,
} from './stats';

describe('setVolume / totalVolume', () => {
  it('returns weight × reps for a working set', () => {
    expect(setVolume({ weight: 80, reps: 10, isWarmup: false })).toBe(800);
  });
  it('returns 0 for warmup', () => {
    expect(setVolume({ weight: 80, reps: 10, isWarmup: true })).toBe(0);
  });
  it('sums working sets only', () => {
    expect(
      totalVolume([
        { weight: 80, reps: 10, isWarmup: false },
        { weight: 80, reps: 8, isWarmup: false },
        { weight: 40, reps: 10, isWarmup: true },
      ]),
    ).toBe(80 * 10 + 80 * 8);
  });
});

describe('estimate1RM (Epley)', () => {
  it('matches the formula weight * (1 + reps/30)', () => {
    expect(estimate1RM(100, 5)).toBeCloseTo(116.667, 2);
    expect(estimate1RM(80, 10)).toBeCloseTo(106.667, 2);
  });
  it('returns 0 for bodyweight', () => {
    expect(estimate1RM(0, 12)).toBe(0);
  });
  it('returns 0 for zero reps', () => {
    expect(estimate1RM(80, 0)).toBe(0);
  });
});

describe('estimateRepMax (Epley inverse)', () => {
  it('derives the load for a target rep count from the estimated 1RM', () => {
    // 100 kg x 10 -> e1RM 133.33 -> 10RM 100, 5RM 114.29.
    expect(estimateRepMax(100, 10, 10)).toBeCloseTo(100, 6);
    expect(estimateRepMax(100, 10, 5)).toBeCloseTo(114.286, 2);
    expect(estimateRepMax(80, 5, 10)).toBeCloseTo(70, 6);
  });
  it('maps a set back to its own weight at its own rep count', () => {
    expect(estimateRepMax(62.5, 8, 8)).toBeCloseTo(62.5, 6);
  });
  it('stays consistent with estimate1RM', () => {
    expect(estimateRepMax(90, 6, 10) * (1 + 10 / 30)).toBeCloseTo(
      estimate1RM(90, 6),
      6,
    );
  });
  it('returns 0 for bodyweight, zero reps or a non-positive target', () => {
    expect(estimateRepMax(0, 12, 10)).toBe(0);
    expect(estimateRepMax(80, 0, 10)).toBe(0);
    expect(estimateRepMax(80, 8, 0)).toBe(0);
    expect(estimateRepMax(80, 8, -5)).toBe(0);
  });
});

describe('best1RM', () => {
  it('picks the set with the highest estimated 1RM', () => {
    const sets = [
      { weight: 80, reps: 10, isWarmup: false }, // 106.67
      { weight: 100, reps: 5, isWarmup: false }, // 116.67 (best)
      { weight: 60, reps: 12, isWarmup: false }, // 84
      { weight: 120, reps: 1, isWarmup: true }, // ignored
    ];
    expect(best1RM(sets)).toBeCloseTo(116.667, 2);
  });
  it('returns 0 when no working set exists', () => {
    expect(best1RM([{ weight: 80, reps: 10, isWarmup: true }])).toBe(0);
  });
});

describe('isoWeekKey / isoWeekStart', () => {
  it('returns the ISO week key for a Wednesday', () => {
    // 2026-04-29 is a Wednesday in week 18 of 2026
    expect(isoWeekKey(new Date('2026-04-29T12:00:00Z'))).toBe('2026-W18');
  });
  it('returns the ISO week start (monday)', () => {
    const start = isoWeekStart(new Date('2026-04-29T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-04-27T00:00:00.000Z');
  });
  it('handles year boundaries (early January belongs to previous year week)', () => {
    // 2027-01-01 is a Friday → ISO week 53 of 2026
    expect(isoWeekKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
  });
});

describe('exerciseProgress', () => {
  it('produces one point per session sorted by date', () => {
    const sets = [
      {
        weight: 80,
        reps: 10,
        isWarmup: false,
        sessionId: 's1',
        sessionStartedAt: new Date('2026-04-20T10:00:00Z'),
      },
      {
        weight: 80,
        reps: 9,
        isWarmup: false,
        sessionId: 's1',
        sessionStartedAt: new Date('2026-04-20T10:00:00Z'),
      },
      {
        weight: 82.5,
        reps: 8,
        isWarmup: false,
        sessionId: 's2',
        sessionStartedAt: new Date('2026-04-27T10:00:00Z'),
      },
      // warmup ignored
      {
        weight: 40,
        reps: 5,
        isWarmup: true,
        sessionId: 's2',
        sessionStartedAt: new Date('2026-04-27T10:00:00Z'),
      },
    ];
    const points = exerciseProgress(sets);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      date: '2026-04-20',
      maxWeight: 80,
      topSetReps: 10,
      totalVolume: 80 * 10 + 80 * 9,
    });
    expect(points[1]).toMatchObject({
      date: '2026-04-27',
      maxWeight: 82.5,
      topSetReps: 8,
    });
  });
});

describe('weeklyVolumeByMuscleGroup', () => {
  it('aggregates by ISO week and muscle group', () => {
    const sets = [
      // week 18 (Monday 2026-04-27)
      {
        weight: 80,
        reps: 10,
        isWarmup: false,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-04-27T10:00:00Z'),
      },
      {
        weight: 60,
        reps: 12,
        isWarmup: false,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-04-29T10:00:00Z'),
      },
      {
        weight: 100,
        reps: 8,
        isWarmup: false,
        muscleGroup: 'BACK_WIDTH',
        sessionStartedAt: new Date('2026-04-29T10:00:00Z'),
      },
      // week 19 (Monday 2026-05-04)
      {
        weight: 82.5,
        reps: 10,
        isWarmup: false,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-05-04T10:00:00Z'),
      },
      // warmup ignored
      {
        weight: 40,
        reps: 8,
        isWarmup: true,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-05-04T10:00:00Z'),
      },
    ];
    const points = weeklyVolumeByMuscleGroup(sets);
    expect(points).toHaveLength(2);
    const w18 = points[0]!;
    const w19 = points[1]!;
    expect(w18.weekKey).toBe('2026-W18');
    expect(w18.byMuscleGroup.CHEST).toBe(80 * 10 + 60 * 12);
    expect(w18.byMuscleGroup.BACK_WIDTH).toBe(100 * 8);
    expect(w18.total).toBe(80 * 10 + 60 * 12 + 100 * 8);
    expect(w19.weekKey).toBe('2026-W19');
    expect(w19.byMuscleGroup.CHEST).toBe(82.5 * 10);
  });
});

describe('weeklySetsByMuscleGroup', () => {
  it('counts working sets per ISO week and muscle group', () => {
    const sets = [
      // week 18 (Monday 2026-04-27): 2 chest + 1 back
      {
        isWarmup: false,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-04-27T10:00:00Z'),
      },
      {
        isWarmup: false,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-04-29T10:00:00Z'),
      },
      {
        isWarmup: false,
        muscleGroup: 'BACK_WIDTH',
        sessionStartedAt: new Date('2026-04-29T10:00:00Z'),
      },
      // week 19 (Monday 2026-05-04): 1 chest working + 1 warmup ignored
      {
        isWarmup: false,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-05-04T10:00:00Z'),
      },
      {
        isWarmup: true,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-05-04T10:00:00Z'),
      },
    ];
    const points = weeklySetsByMuscleGroup(sets);
    expect(points).toHaveLength(2);
    const w18 = points[0]!;
    const w19 = points[1]!;
    expect(w18.weekKey).toBe('2026-W18');
    expect(w18.byMuscleGroup.CHEST).toBe(2);
    expect(w18.byMuscleGroup.BACK_WIDTH).toBe(1);
    expect(w18.total).toBe(3);
    expect(w19.weekKey).toBe('2026-W19');
    expect(w19.byMuscleGroup.CHEST).toBe(1);
    expect(w19.total).toBe(1);
  });

  it('returns an empty list when there are no working sets', () => {
    expect(
      weeklySetsByMuscleGroup([
        {
          isWarmup: true,
          muscleGroup: 'CHEST',
          sessionStartedAt: new Date('2026-05-04T10:00:00Z'),
        },
      ]),
    ).toEqual([]);
  });
});

describe('weeklyFrequencyByMuscleGroup (issue #225)', () => {
  it('counts distinct training days per muscle group and ISO week', () => {
    const sets = [
      // week 18: chest trained on two distinct days (Mon + Wed) -> 2;
      // two chest sets the same day (Mon) still count as one day.
      {
        isWarmup: false,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-04-27T10:00:00Z'),
      },
      {
        isWarmup: false,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-04-27T18:00:00Z'),
      },
      {
        isWarmup: false,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-04-29T10:00:00Z'),
      },
      // back trained once that week -> 1
      {
        isWarmup: false,
        muscleGroup: 'BACK_WIDTH',
        sessionStartedAt: new Date('2026-04-29T10:00:00Z'),
      },
      // week 19: chest once more -> 1
      {
        isWarmup: false,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-05-04T10:00:00Z'),
      },
    ];
    const points = weeklyFrequencyByMuscleGroup(sets);
    expect(points).toHaveLength(2);
    const w18 = points[0]!;
    const w19 = points[1]!;
    expect(w18.weekKey).toBe('2026-W18');
    expect(w18.byMuscleGroup.CHEST).toBe(2);
    expect(w18.byMuscleGroup.BACK_WIDTH).toBe(1);
    expect(w19.weekKey).toBe('2026-W19');
    expect(w19.byMuscleGroup.CHEST).toBe(1);
  });

  it('excludes warmups and cardio sets (consistent with the volume card)', () => {
    const sets = [
      // one real working day for chest
      {
        isWarmup: false,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-04-27T10:00:00Z'),
      },
      // a warmup on a different day must NOT add a chest day
      {
        isWarmup: true,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-04-29T10:00:00Z'),
      },
      // a cardio set (durationSec != null) on a different day must NOT count
      {
        isWarmup: false,
        durationSec: 1800,
        muscleGroup: 'CHEST',
        sessionStartedAt: new Date('2026-04-30T10:00:00Z'),
      },
    ];
    const points = weeklyFrequencyByMuscleGroup(sets);
    expect(points).toHaveLength(1);
    expect(points[0]!.byMuscleGroup.CHEST).toBe(1);
  });

  it('returns an empty list for a week with no working sets', () => {
    expect(
      weeklyFrequencyByMuscleGroup([
        {
          isWarmup: true,
          muscleGroup: 'CHEST',
          sessionStartedAt: new Date('2026-05-04T10:00:00Z'),
        },
      ]),
    ).toEqual([]);
  });
});

describe('classifyWeeklySets (MEV/MRV band)', () => {
  it('uses the documented defaults of 10 (MEV) and 20 (MRV)', () => {
    expect(WEEKLY_SETS_MEV).toBe(10);
    expect(WEEKLY_SETS_MRV).toBe(20);
  });

  it('classifies at the band boundaries', () => {
    expect(classifyWeeklySets(0)).toBe('BELOW_MEV');
    expect(classifyWeeklySets(9)).toBe('BELOW_MEV');
    expect(classifyWeeklySets(10)).toBe('WITHIN'); // MEV inclusive
    expect(classifyWeeklySets(15)).toBe('WITHIN');
    expect(classifyWeeklySets(20)).toBe('WITHIN'); // MRV inclusive
    expect(classifyWeeklySets(21)).toBe('ABOVE_MRV');
  });

  it('honours overridden thresholds', () => {
    expect(classifyWeeklySets(8, 6, 12)).toBe('WITHIN');
    expect(classifyWeeklySets(5, 6, 12)).toBe('BELOW_MEV');
    expect(classifyWeeklySets(13, 6, 12)).toBe('ABOVE_MRV');
  });
});

describe('resolveVolumeBand (issue #211)', () => {
  it('returns the defaults when no targets are passed', () => {
    expect(resolveVolumeBand('CHEST')).toEqual({
      mev: WEEKLY_SETS_MEV,
      mrv: WEEKLY_SETS_MRV,
      custom: false,
    });
  });

  it('returns the defaults for a muscle group without a custom target', () => {
    expect(resolveVolumeBand('BICEPS', { CHEST: { mev: 8, mrv: 16 } })).toEqual({
      mev: WEEKLY_SETS_MEV,
      mrv: WEEKLY_SETS_MRV,
      custom: false,
    });
  });

  it('returns the user band, flagged custom, when one is set', () => {
    expect(resolveVolumeBand('CHEST', { CHEST: { mev: 12, mrv: 22 } })).toEqual({
      mev: 12,
      mrv: 22,
      custom: true,
    });
  });

  it('falls back to defaults for an internally inconsistent stored band', () => {
    // A hand-tampered row (mrv <= mev or mev < 1) is ignored, not trusted.
    expect(resolveVolumeBand('CHEST', { CHEST: { mev: 18, mrv: 10 } }).custom).toBe(
      false,
    );
    expect(resolveVolumeBand('CHEST', { CHEST: { mev: 0, mrv: 10 } }).custom).toBe(
      false,
    );
  });
});

describe('effectiveWeight', () => {
  it('returns setWeight as-is for non-bodyweight exercises', () => {
    expect(effectiveWeight(80, false, 70)).toBe(80);
  });
  it('adds the bodyweight for bodyweight exercises', () => {
    expect(effectiveWeight(0, true, 70)).toBe(70);
    expect(effectiveWeight(10, true, 70)).toBe(80); // weighted pull-ups +10 kg
  });
  it('handles negative loads (assisted machines)', () => {
    expect(effectiveWeight(-15, true, 70)).toBe(55);
  });
  it('falls back to setWeight when bodyweight is missing or zero', () => {
    expect(effectiveWeight(0, true, null)).toBe(0);
    expect(effectiveWeight(0, true, undefined)).toBe(0);
    expect(effectiveWeight(0, true, 0)).toBe(0);
  });
});

describe('applyBodyweight', () => {
  it('only enriches sets flagged usesBodyweight', () => {
    const sets = [
      { weight: 80, reps: 10, isWarmup: false, usesBodyweight: false }, // squat
      { weight: 0, reps: 10, isWarmup: false, usesBodyweight: true }, // bodyweight pull-ups
      { weight: 5, reps: 8, isWarmup: false, usesBodyweight: true }, // pull-ups +5 kg
    ];
    const out = applyBodyweight(sets, 70);
    expect(out[0]?.weight).toBe(80); // unchanged
    expect(out[1]?.weight).toBe(70);
    expect(out[2]?.weight).toBe(75);
  });
  it('returns the original list when bodyweight is missing', () => {
    const sets = [{ weight: 0, reps: 10, isWarmup: false, usesBodyweight: true }];
    expect(applyBodyweight(sets, null)).toEqual(sets);
    expect(applyBodyweight(sets, 0)).toEqual(sets);
  });
  it('lets totalVolume compute the right effective tonnage', () => {
    const sets = [
      { weight: 0, reps: 10, isWarmup: false, usesBodyweight: true }, // 70 × 10
      { weight: 0, reps: 8, isWarmup: false, usesBodyweight: true }, // 70 × 8
    ];
    expect(totalVolume(applyBodyweight(sets, 70))).toBe(70 * 10 + 70 * 8);
  });
});

describe('trainingConsistency', () => {
  // Fixed reference point: Wednesday 2026-06-10, 12:00 UTC.
  const now = new Date('2026-06-10T12:00:00Z');
  // Monday 00:00 UTC of the ISO week containing `now`.
  const currentMonday = isoWeekStart(now);

  // A date inside the ISO week that is `weeksAgo` weeks before the current week,
  // offset by `dayOffset` days from that week's Monday.
  function dayInWeek(weeksAgo: number, dayOffset = 0): Date {
    const d = new Date(currentMonday);
    d.setUTCDate(d.getUTCDate() - weeksAgo * 7 + dayOffset);
    d.setUTCHours(10, 0, 0, 0);
    return d;
  }

  it('returns a zero streak and no crash for empty history', () => {
    const out = trainingConsistency([], { now, windowWeeks: 12 });
    expect(out.currentStreak).toBe(0);
    expect(out.weeks).toHaveLength(12);
    expect(out.weeks.every((w) => w.trainedDays === 0)).toBe(true);
    expect(out.weeks[out.weeks.length - 1]?.isCurrent).toBe(true);
  });

  it('counts an unbroken run of weeks (one session per week)', () => {
    const dates = [
      dayInWeek(0), // current week
      dayInWeek(1),
      dayInWeek(2),
      dayInWeek(3),
    ];
    const out = trainingConsistency(dates, { now, windowWeeks: 12 });
    expect(out.currentStreak).toBe(4);
  });

  it('breaks the streak on a missed week', () => {
    const dates = [
      dayInWeek(0),
      dayInWeek(1),
      // week 2 missed
      dayInWeek(3),
    ];
    const out = trainingConsistency(dates, { now, windowWeeks: 12 });
    expect(out.currentStreak).toBe(2);
  });

  it('de-duplicates multiple sessions on the same calendar day', () => {
    const sameDay = dayInWeek(0, 1);
    const sameDayLater = new Date(sameDay);
    sameDayLater.setUTCHours(18, 0, 0, 0);
    const out = trainingConsistency([sameDay, sameDayLater], { now, windowWeeks: 12 });
    const current = out.weeks[out.weeks.length - 1];
    expect(current?.trainedDays).toBe(1);
  });

  it('does not break the streak when the current week is still empty', () => {
    // No session this week, but a solid run in the prior two weeks.
    const dates = [dayInWeek(1), dayInWeek(2)];
    const out = trainingConsistency(dates, { now, windowWeeks: 12 });
    expect(out.weeks[out.weeks.length - 1]?.trainedDays).toBe(0);
    expect(out.currentStreak).toBe(2);
  });

  it('respects the weeklyFrequency target when present', () => {
    // Two trained days in the current and previous week, one in the week before.
    const dates = [
      dayInWeek(0, 0),
      dayInWeek(0, 2),
      dayInWeek(1, 0),
      dayInWeek(1, 3),
      dayInWeek(2, 0), // only one day this week -> below target of 2
    ];
    const out = trainingConsistency(dates, {
      now,
      windowWeeks: 12,
      weeklyFrequency: 2,
    });
    expect(out.weeklyFrequency).toBe(2);
    // current + previous meet the target; the one-day week does not.
    expect(out.currentStreak).toBe(2);
  });

  it('ignores a target of zero or negative and falls back to >=1 day', () => {
    const out = trainingConsistency([dayInWeek(0), dayInWeek(1)], {
      now,
      windowWeeks: 12,
      weeklyFrequency: 0,
    });
    expect(out.weeklyFrequency).toBeNull();
    expect(out.currentStreak).toBe(2);
  });

  it('clamps the window to the requested number of weeks', () => {
    const out = trainingConsistency([], { now, windowWeeks: 4 });
    expect(out.weeks).toHaveLength(4);
  });
});

describe('isStalled', () => {
  it('uses a default lookback of 3 sessions', () => {
    expect(STALL_LOOKBACK_SESSIONS).toBe(3);
  });

  it('flags a flat lift over the lookback window', () => {
    // Reached 100 earlier, then held flat: the last 3 sessions never beat the
    // prior best of 100.
    expect(isStalled([95, 100, 100, 100, 100])).toBe(true);
  });

  it('flags a strictly declining lift', () => {
    expect(isStalled([110, 105, 100])).toBe(true);
  });

  it('does not flag a clearly progressing lift', () => {
    expect(isStalled([100, 105, 110])).toBe(false);
  });

  it('does not flag when the latest session beats the prior best', () => {
    // Prior best 100; the window dips then exceeds it -> still progressing.
    expect(isStalled([100, 98, 102])).toBe(false);
  });

  it('does not flag with fewer than the lookback number of sessions', () => {
    expect(isStalled([100, 100])).toBe(false);
    expect(isStalled([100])).toBe(false);
    expect(isStalled([])).toBe(false);
  });

  it('treats sub-tolerance growth as no improvement (still stalled)', () => {
    // +0.4% < 0.5% tolerance -> noise, not progress.
    const within = 100 * (1 + STALL_TOLERANCE * 0.8);
    expect(isStalled([100, within, within])).toBe(true);
  });

  it('treats above-tolerance growth as improvement (not stalled)', () => {
    // +0.6% > 0.5% tolerance -> a genuine gain.
    const above = 100 * (1 + STALL_TOLERANCE * 1.2);
    expect(isStalled([100, 100, above])).toBe(false);
  });

  it('honours a custom lookback', () => {
    // Lookback 2: the window [100, 100] must beat the prior best (100) to count
    // as progress; it does not, so the lift is stalled. With a higher final
    // session it would improve and clear the flag.
    expect(isStalled([100, 100, 100], 2)).toBe(true);
    expect(isStalled([100, 100, 105], 2)).toBe(false);
  });

  it('never flags with a lookback below 2', () => {
    expect(isStalled([100, 100, 100], 1)).toBe(false);
  });
});

// Cardio exclusion (issue #133): conditioning sets (durationSec != null) are
// skipped by every lifting aggregation, even with a deliberately non-zero
// weight/reps payload (the API normalizes them to 0/1, but the guard must not
// depend on that convention).
describe('cardio set exclusion', () => {
  const cardio = { weight: 100, reps: 10, isWarmup: false, durationSec: 750 };
  const strength = { weight: 100, reps: 10, isWarmup: false };

  it('setVolume / totalVolume count cardio sets as 0', () => {
    expect(setVolume(cardio)).toBe(0);
    expect(totalVolume([cardio, strength])).toBe(1000);
  });

  it('best1RM ignores cardio sets', () => {
    expect(best1RM([cardio])).toBe(0);
    expect(best1RM([cardio, { weight: 80, reps: 5, isWarmup: false }])).toBeCloseTo(
      estimate1RM(80, 5),
    );
  });

  it('exerciseProgress produces no point from cardio-only sessions', () => {
    const d = new Date('2026-06-01T10:00:00Z');
    const points = exerciseProgress([
      { ...cardio, sessionId: 's1', sessionStartedAt: d },
    ]);
    expect(points).toHaveLength(0);
  });

  it('weeklyVolumeByMuscleGroup and weeklySetsByMuscleGroup skip cardio sets', () => {
    const d = new Date('2026-06-01T10:00:00Z');
    const volume = weeklyVolumeByMuscleGroup([
      { ...cardio, muscleGroup: 'OTHER', sessionStartedAt: d },
      { ...strength, muscleGroup: 'CHEST', sessionStartedAt: d },
    ]);
    expect(volume).toHaveLength(1);
    expect(volume[0]!.byMuscleGroup).toEqual({ CHEST: 1000 });
    expect(volume[0]!.total).toBe(1000);

    const counts = weeklySetsByMuscleGroup([
      { isWarmup: false, durationSec: 750, muscleGroup: 'OTHER', sessionStartedAt: d },
      { isWarmup: false, muscleGroup: 'CHEST', sessionStartedAt: d },
    ]);
    expect(counts).toHaveLength(1);
    expect(counts[0]!.byMuscleGroup).toEqual({ CHEST: 1 });
    expect(counts[0]!.total).toBe(1);
  });
});

describe('weeklyConditioning (issue #135)', () => {
  const NOW = new Date('2026-06-11T10:00:00Z'); // Thursday, ISO week 2026-W24
  const run = (over: Record<string, unknown> = {}) => ({
    durationSec: 1800,
    distanceM: 5000,
    isWarmup: false,
    sessionId: 's1',
    sessionStartedAt: new Date('2026-06-09T07:00:00Z'), // same ISO week as NOW
    ...over,
  });

  it('returns a zero-filled window ending at the current week', () => {
    const points = weeklyConditioning([], { windowWeeks: 8, now: NOW });
    expect(points).toHaveLength(8);
    expect(points[7]!.weekKey).toBe(isoWeekKey(NOW));
    expect(points.every((p) => p.minutes === 0 && p.distanceKm === 0 && p.sessions === 0)).toBe(
      true,
    );
    // Oldest first, consecutive weeks.
    expect(points[0]!.weekStart.getTime()).toBeLessThan(points[7]!.weekStart.getTime());
  });

  it('aggregates minutes, distance and distinct sessions per ISO week', () => {
    const points = weeklyConditioning(
      [
        run(),
        run({ sessionId: 's1', durationSec: 600, distanceM: null }), // same session
        run({ sessionId: 's2', durationSec: 900, distanceM: 2500 }),
      ],
      { windowWeeks: 4, now: NOW },
    );
    const current = points[3]!;
    expect(current.minutes).toBe(Math.round((1800 + 600 + 900) / 60));
    expect(current.distanceKm).toBe(7.5);
    expect(current.sessions).toBe(2);
  });

  it('handles duration-only sets (distance stays 0)', () => {
    const points = weeklyConditioning([run({ distanceM: null })], {
      windowWeeks: 1,
      now: NOW,
    });
    expect(points[0]!.minutes).toBe(30);
    expect(points[0]!.distanceKm).toBe(0);
  });

  it('buckets sets into their own ISO weeks and ignores non-cardio or warmup sets', () => {
    const points = weeklyConditioning(
      [
        run(),
        run({ sessionId: 's0', sessionStartedAt: new Date('2026-06-01T07:00:00Z') }), // prior week
        run({ isWarmup: true, sessionId: 's3' }), // warmup: ignored
        run({ durationSec: null, sessionId: 's4' }), // not cardio: ignored
      ],
      { windowWeeks: 2, now: NOW },
    );
    expect(points[0]!.minutes).toBe(30);
    expect(points[0]!.sessions).toBe(1);
    expect(points[1]!.minutes).toBe(30);
    expect(points[1]!.sessions).toBe(1);
  });

  it('drops cardio sets older than the window', () => {
    const points = weeklyConditioning(
      [run({ sessionStartedAt: new Date('2026-01-05T07:00:00Z') })],
      { windowWeeks: 4, now: NOW },
    );
    expect(points.every((p) => p.minutes === 0)).toBe(true);
  });

  // Issue #561: the week's average heart rate, weighted by duration.
  it('weights the average heart rate by duration, over the sets that carry one', () => {
    const points = weeklyConditioning(
      [
        run({ durationSec: 3600, avgHr: 140 }),
        run({ durationSec: 600, avgHr: 175, sessionId: 's2' }),
        run({ durationSec: 1800, sessionId: 's3' }), // no heart rate: not in the average
        run({ durationSec: 1800, avgHr: 100, isWarmup: true, sessionId: 's4' }), // warmup: ignored
        run({ avgHr: 120, sessionStartedAt: new Date('2026-06-01T07:00:00Z'), sessionId: 's0' }),
      ],
      { windowWeeks: 2, now: NOW },
    );
    // (140 * 3600 + 175 * 600) / 4200 = 145, not the plain mean of 157.5.
    expect(points[1]!.avgHr).toBe(145);
    expect(points[1]!.minutes).toBe(100);
    expect(points[0]!.avgHr).toBe(120);
  });

  it('omits the heart rate key when no set of the week carries one', () => {
    const points = weeklyConditioning([run(), run({ avgHr: null, sessionId: 's2' })], {
      windowWeeks: 2,
      now: NOW,
    });
    expect('avgHr' in points[1]!).toBe(false);
    // A zero-filled week has none either.
    expect('avgHr' in points[0]!).toBe(false);
  });
});

describe('dailyConditioning (issue #153)', () => {
  const NOW = new Date('2026-06-11T10:00:00Z'); // Thursday, ISO week 2026-W24 (Mon 06-08)
  const run = (over: Record<string, unknown> = {}) => ({
    durationSec: 1800,
    distanceM: 5000,
    isWarmup: false,
    sessionStartedAt: new Date('2026-06-09T07:00:00Z'), // Tuesday of the current week
    ...over,
  });

  it('returns an empty array for a zero-cardio week (days omitted, not zero-filled)', () => {
    expect(dailyConditioning([], { now: NOW })).toEqual([]);
    // A strength-only set is not cardio: still empty.
    expect(dailyConditioning([run({ durationSec: null })], { now: NOW })).toEqual([]);
  });

  it('aggregates minutes and km per UTC calendar day, ascending', () => {
    const days = dailyConditioning(
      [
        run({ sessionStartedAt: new Date('2026-06-10T18:00:00Z'), durationSec: 600, distanceM: null }),
        run(), // Tuesday 30 min / 5 km
        run({ sessionStartedAt: new Date('2026-06-09T18:30:00Z'), durationSec: 900, distanceM: 2500 }),
      ],
      { now: NOW },
    );
    expect(days).toEqual([
      { date: '2026-06-09', minutes: 45, km: 7.5 },
      { date: '2026-06-10', minutes: 10, km: 0 },
    ]);
  });

  it('only covers the current ISO week and ignores warmup or non-cardio sets', () => {
    const days = dailyConditioning(
      [
        run(),
        run({ sessionStartedAt: new Date('2026-06-07T07:00:00Z') }), // Sunday of the prior week
        run({ sessionStartedAt: new Date('2026-06-15T07:00:00Z') }), // Monday of the next week
        run({ isWarmup: true, sessionStartedAt: new Date('2026-06-12T07:00:00Z') }),
        run({ durationSec: null, sessionStartedAt: new Date('2026-06-12T07:00:00Z') }),
      ],
      { now: NOW },
    );
    expect(days).toEqual([{ date: '2026-06-09', minutes: 30, km: 5 }]);
  });

  it('includes the Monday boundary of the current week', () => {
    const days = dailyConditioning(
      [run({ sessionStartedAt: new Date('2026-06-08T00:00:00Z'), durationSec: 1200, distanceM: null })],
      { now: NOW },
    );
    expect(days).toEqual([{ date: '2026-06-08', minutes: 20, km: 0 }]);
  });

  // Issue #561: heart rate is the intensity half of the interference signal.
  it('adds the weighted average and the peak heart rate of each day', () => {
    const days = dailyConditioning(
      [
        run({ durationSec: 3600, distanceM: 10000, avgHr: 140, maxHr: 158 }),
        run({ durationSec: 600, distanceM: 2000, avgHr: 175, maxHr: 186 }),
        run({ sessionStartedAt: new Date('2026-06-10T18:00:00Z'), avgHr: 151 }), // no peak
        run({ sessionStartedAt: new Date('2026-06-11T06:00:00Z'), maxHr: 170 }), // no average
      ],
      { now: NOW },
    );
    expect(days).toEqual([
      { date: '2026-06-09', minutes: 70, km: 12, avgHr: 145, maxHr: 186 },
      { date: '2026-06-10', minutes: 30, km: 5, avgHr: 151 },
      { date: '2026-06-11', minutes: 30, km: 5, maxHr: 170 },
    ]);
    expect('maxHr' in days[1]!).toBe(false);
    expect('avgHr' in days[2]!).toBe(false);
  });

  it('keeps a day without heart rate byte-identical, and ignores warmup heart rate', () => {
    const days = dailyConditioning(
      [run(), run({ isWarmup: true, avgHr: 180, maxHr: 195 }), run({ avgHr: null, maxHr: null })],
      { now: NOW },
    );
    expect(JSON.stringify(days)).toBe('[{"date":"2026-06-09","minutes":60,"km":10}]');
  });

  it('covers only the sets that recorded a heart rate when coverage is partial', () => {
    const days = dailyConditioning(
      [run({ durationSec: 1200, avgHr: 160 }), run({ durationSec: 6000 })],
      { now: NOW },
    );
    // The long set without a heart rate does not pull the average down.
    expect(days).toEqual([{ date: '2026-06-09', minutes: 120, km: 10, avgHr: 160 }]);
  });
});
