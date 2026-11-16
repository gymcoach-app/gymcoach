import { describe, it, expect } from 'vitest';
import { FIT_MAX_BYTES } from '@/lib/import/fit';
import { TCX_MAX_BYTES } from '@/lib/import/tcx';
import { MAX_TRACK_POINTS } from '@/lib/import/track';
import {
  sessionAvgHrSchema,
  sessionHrTrackSchema,
  sessionMaxHrSchema,
  watchFileInputSchema,
} from './watch-file';

describe('watchFileInputSchema (issue #562)', () => {
  it('accepts the three formats in both modes', () => {
    for (const format of ['fit', 'tcx', 'gpx']) {
      for (const mode of ['preview', 'confirm']) {
        expect(watchFileInputSchema.safeParse({ format, file: 'x', mode }).success).toBe(true);
      }
    }
  });

  it('rejects an unknown format or mode, and a missing or empty file', () => {
    expect(
      watchFileInputSchema.safeParse({ format: 'csv', file: 'x', mode: 'preview' }).success,
    ).toBe(false);
    expect(
      watchFileInputSchema.safeParse({ format: 'tcx', file: 'x', mode: 'apply' }).success,
    ).toBe(false);
    expect(watchFileInputSchema.safeParse({ format: 'tcx', mode: 'preview' }).success).toBe(false);
    expect(
      watchFileInputSchema.safeParse({ format: 'tcx', file: '', mode: 'preview' }).success,
    ).toBe(false);
  });

  it('applies the per-format size cap of the cardio imports', () => {
    const text = 'a'.repeat(TCX_MAX_BYTES + 1);
    for (const format of ['tcx', 'gpx']) {
      const res = watchFileInputSchema.safeParse({ format, file: text, mode: 'preview' });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error.issues[0]?.message).toMatch(/limit is 5 MB/);
    }
    // FIT rides base64-encoded: the same string fits under its inflated cap.
    expect(
      watchFileInputSchema.safeParse({ format: 'fit', file: text, mode: 'preview' }).success,
    ).toBe(true);
    const b64 = 'a'.repeat(Math.ceil(FIT_MAX_BYTES * 1.4) + 1);
    expect(
      watchFileInputSchema.safeParse({ format: 'fit', file: b64, mode: 'preview' }).success,
    ).toBe(false);
  });
});

describe('session heart rate bounds (issue #562)', () => {
  it('keeps the average and the peak inside 40..250, integers only', () => {
    for (const schema of [sessionAvgHrSchema, sessionMaxHrSchema]) {
      expect(schema.safeParse(40).success).toBe(true);
      expect(schema.safeParse(250).success).toBe(true);
      expect(schema.safeParse(39).success).toBe(false);
      expect(schema.safeParse(251).success).toBe(false);
      expect(schema.safeParse(120.5).success).toBe(false);
    }
  });

  it('bounds every point of the curve and its length, dropping extra keys', () => {
    expect(sessionHrTrackSchema.parse([{ t: 0, hr: 120, d: 12 }])).toEqual([{ t: 0, hr: 120 }]);
    expect(sessionHrTrackSchema.safeParse([]).success).toBe(false);
    expect(sessionHrTrackSchema.safeParse([{ t: -1, hr: 120 }]).success).toBe(false);
    expect(sessionHrTrackSchema.safeParse([{ t: 0, hr: 251 }]).success).toBe(false);
    expect(sessionHrTrackSchema.safeParse([{ t: 0 }]).success).toBe(false);
    const full = Array.from({ length: MAX_TRACK_POINTS }, (_, t) => ({ t, hr: 120 }));
    expect(sessionHrTrackSchema.safeParse(full).success).toBe(true);
    expect(sessionHrTrackSchema.safeParse([...full, { t: 999, hr: 120 }]).success).toBe(false);
  });
});
