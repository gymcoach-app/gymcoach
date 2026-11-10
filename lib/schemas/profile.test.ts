import { describe, it, expect } from 'vitest';
import { EffortScale, Sex, TrainingGoal, WeightUnit } from '@/lib/prisma-client';
import { profileUpdateSchema, COACH_NOTE_MAX_LEN } from './profile';

// Validation coverage for the self-service profile update schema (issue #199).
// Asserts the REAL implemented contract (verified against the source): every
// field optional, nullable where the column clears, numeric bounds, int-only
// fields, native enums, and the trimmed/bounded coach note (#188).

describe('profileUpdateSchema', () => {
  it('accepts an empty object (every field is optional)', () => {
    expect(profileUpdateSchema.parse({})).toEqual({});
  });

  it('accepts a valid partial update', () => {
    const parsed = profileUpdateSchema.parse({
      bodyweight: 82.5,
      heightCm: 180,
      weeklyFrequency: 4,
      sex: Sex.MALE,
      goal: TrainingGoal.HYPERTROPHY,
      unit: WeightUnit.KG,
    });
    expect(parsed.bodyweight).toBe(82.5);
    expect(parsed.heightCm).toBe(180);
    expect(parsed.weeklyFrequency).toBe(4);
    expect(parsed.sex).toBe(Sex.MALE);
  });

  it('strips unknown keys rather than rejecting them', () => {
    expect(profileUpdateSchema.parse({ bodyweight: 80, foo: 'bar' })).toEqual({
      bodyweight: 80,
    });
  });

  describe('bodyweight bound (20-300 kg, decimals allowed)', () => {
    it('rejects just below the lower bound', () => {
      expect(profileUpdateSchema.safeParse({ bodyweight: 19.9 }).success).toBe(false);
    });
    it('accepts the lower edge', () => {
      expect(profileUpdateSchema.safeParse({ bodyweight: 20 }).success).toBe(true);
    });
    it('accepts the upper edge', () => {
      expect(profileUpdateSchema.safeParse({ bodyweight: 300 }).success).toBe(true);
    });
    it('rejects just above the upper bound', () => {
      expect(profileUpdateSchema.safeParse({ bodyweight: 300.1 }).success).toBe(false);
    });
    it('clears with null', () => {
      expect(profileUpdateSchema.parse({ bodyweight: null }).bodyweight).toBeNull();
    });
  });

  describe('heightCm bound (100-250, integer only)', () => {
    it('rejects just below the lower bound', () => {
      expect(profileUpdateSchema.safeParse({ heightCm: 99 }).success).toBe(false);
    });
    it('accepts the lower edge', () => {
      expect(profileUpdateSchema.safeParse({ heightCm: 100 }).success).toBe(true);
    });
    it('accepts the upper edge', () => {
      expect(profileUpdateSchema.safeParse({ heightCm: 250 }).success).toBe(true);
    });
    it('rejects just above the upper bound', () => {
      expect(profileUpdateSchema.safeParse({ heightCm: 251 }).success).toBe(false);
    });
    it('rejects a non-integer height', () => {
      expect(profileUpdateSchema.safeParse({ heightCm: 180.5 }).success).toBe(false);
    });
    it('clears with null', () => {
      expect(profileUpdateSchema.parse({ heightCm: null }).heightCm).toBeNull();
    });
  });

  describe('weeklyFrequency bound (1-14, integer only)', () => {
    it('rejects 0 (below the lower bound)', () => {
      expect(profileUpdateSchema.safeParse({ weeklyFrequency: 0 }).success).toBe(false);
    });
    it('accepts the lower edge', () => {
      expect(profileUpdateSchema.safeParse({ weeklyFrequency: 1 }).success).toBe(true);
    });
    it('accepts the upper edge', () => {
      expect(profileUpdateSchema.safeParse({ weeklyFrequency: 14 }).success).toBe(true);
    });
    it('rejects just above the upper bound', () => {
      expect(profileUpdateSchema.safeParse({ weeklyFrequency: 15 }).success).toBe(false);
    });
    it('rejects a non-integer frequency', () => {
      expect(profileUpdateSchema.safeParse({ weeklyFrequency: 3.5 }).success).toBe(false);
    });
  });

  describe('native enums', () => {
    it('accepts every valid Sex value and rejects junk', () => {
      for (const v of Object.values(Sex)) {
        expect(profileUpdateSchema.safeParse({ sex: v }).success).toBe(true);
      }
      expect(profileUpdateSchema.safeParse({ sex: 'martian' }).success).toBe(false);
    });

    it('accepts every valid TrainingGoal value and rejects junk', () => {
      for (const v of Object.values(TrainingGoal)) {
        expect(profileUpdateSchema.safeParse({ goal: v }).success).toBe(true);
      }
      expect(profileUpdateSchema.safeParse({ goal: 'BULK' }).success).toBe(false);
    });

    it('accepts every valid WeightUnit value and rejects junk', () => {
      for (const v of Object.values(WeightUnit)) {
        expect(profileUpdateSchema.safeParse({ unit: v }).success).toBe(true);
      }
      expect(profileUpdateSchema.safeParse({ unit: 'STONE' }).success).toBe(false);
    });

    it('allows clearing the nullable enums with null', () => {
      expect(profileUpdateSchema.safeParse({ sex: null }).success).toBe(true);
      expect(profileUpdateSchema.safeParse({ goal: null }).success).toBe(true);
    });

    it('does not allow null for unit (optional but not nullable)', () => {
      expect(profileUpdateSchema.safeParse({ unit: null }).success).toBe(false);
    });
  });

  describe('coachNote (#188: trimmed, bounded by COACH_NOTE_MAX_LEN)', () => {
    it('accepts a note exactly at COACH_NOTE_MAX_LEN', () => {
      expect(
        profileUpdateSchema.safeParse({ coachNote: 'x'.repeat(COACH_NOTE_MAX_LEN) })
          .success,
      ).toBe(true);
    });

    it('rejects a note one character over COACH_NOTE_MAX_LEN', () => {
      expect(
        profileUpdateSchema.safeParse({ coachNote: 'x'.repeat(COACH_NOTE_MAX_LEN + 1) })
          .success,
      ).toBe(false);
    });

    it('measures length after trimming surrounding whitespace', () => {
      // Padding is trimmed before the max-length check, so a max-length note
      // with surrounding spaces still passes.
      const padded = `  ${'x'.repeat(COACH_NOTE_MAX_LEN)}  `;
      const parsed = profileUpdateSchema.parse({ coachNote: padded });
      expect(parsed.coachNote).toBe('x'.repeat(COACH_NOTE_MAX_LEN));
    });

    it('trims a whitespace-only note to an empty string (the route then coerces to null)', () => {
      // The schema itself yields "" for an all-whitespace note; null-coercion is
      // the route's job, per the schema comment.
      expect(profileUpdateSchema.parse({ coachNote: '   ' }).coachNote).toBe('');
    });

    it('clears the note with null', () => {
      expect(profileUpdateSchema.parse({ coachNote: null }).coachNote).toBeNull();
    });
  });

  describe('displayName (trimmed, 1-80 chars, nullable)', () => {
    it('trims surrounding whitespace', () => {
      expect(profileUpdateSchema.parse({ displayName: '  Bob  ' }).displayName).toBe('Bob');
    });

    it('rejects a whitespace-only name (empty after trim, below min 1)', () => {
      expect(profileUpdateSchema.safeParse({ displayName: '   ' }).success).toBe(false);
    });

    it('rejects a name over 80 characters', () => {
      expect(profileUpdateSchema.safeParse({ displayName: 'a'.repeat(81) }).success).toBe(false);
    });

    it('clears with null', () => {
      expect(profileUpdateSchema.parse({ displayName: null }).displayName).toBeNull();
    });
  });

  it('exposes COACH_NOTE_MAX_LEN as the shared 500-char limit', () => {
    expect(COACH_NOTE_MAX_LEN).toBe(500);
  });
});

describe('profileUpdateSchema effortScale (issue #390)', () => {
  it('accepts both effort scales', () => {
    expect(profileUpdateSchema.parse({ effortScale: EffortScale.RPE }).effortScale).toBe('RPE');
    expect(profileUpdateSchema.parse({ effortScale: EffortScale.RIR }).effortScale).toBe('RIR');
  });

  it('rejects an unknown scale and null (the column is not nullable)', () => {
    for (const bad of ['rpe', 'BORG', 8, null])
      expect(profileUpdateSchema.safeParse({ effortScale: bad }).success).toBe(false);
  });
});
