import { describe, it, expect } from 'vitest';
import {
  BODYWEIGHT_MAX_KG,
  BODYWEIGHT_MIN_KG,
  bodyweightEntryInputSchema,
  bodyweightKgSchema,
} from './bodyweight';

describe('bodyweightEntryInputSchema', () => {
  it('accepts a plain weight in kg', () => {
    const parsed = bodyweightEntryInputSchema.parse({ weightKg: 82.4 });
    expect(parsed.weightKg).toBe(82.4);
    expect(parsed.note).toBeUndefined();
  });

  it('accepts an optional note', () => {
    const parsed = bodyweightEntryInputSchema.parse({
      weightKg: 80,
      note: 'morning, fasted',
    });
    expect(parsed.note).toBe('morning, fasted');
  });

  it('coerces a numeric string', () => {
    expect(bodyweightEntryInputSchema.parse({ weightKg: '75.5' }).weightKg).toBe(75.5);
  });

  it.each([0, -5, 19.9, 301, 'abc', null, undefined])(
    'rejects invalid weight %p',
    (weightKg) => {
      expect(bodyweightEntryInputSchema.safeParse({ weightKg }).success).toBe(false);
    },
  );

  it('accepts the profile-route bounds (20-300 kg)', () => {
    expect(bodyweightEntryInputSchema.safeParse({ weightKg: 20 }).success).toBe(true);
    expect(bodyweightEntryInputSchema.safeParse({ weightKg: 300 }).success).toBe(true);
  });

  it('rejects an oversized note', () => {
    const res = bodyweightEntryInputSchema.safeParse({
      weightKg: 80,
      note: 'x'.repeat(501),
    });
    expect(res.success).toBe(false);
  });
});

describe('bodyweightKgSchema (shared with the MCP tool, issue #478)', () => {
  it('uses the profile-route bounds', () => {
    expect(BODYWEIGHT_MIN_KG).toBe(20);
    expect(BODYWEIGHT_MAX_KG).toBe(300);
  });

  it.each([20, 81.4, 300])('accepts %p kg', (kg) => {
    expect(bodyweightKgSchema.safeParse(kg).success).toBe(true);
  });

  it.each([19.9, 300.1, '80', null])('rejects %p (no coercion)', (kg) => {
    expect(bodyweightKgSchema.safeParse(kg).success).toBe(false);
  });
});
