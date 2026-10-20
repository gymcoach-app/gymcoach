import { describe, it, expect } from 'vitest';
import { csvEscape, HISTORY_CSV_HEADERS } from './csv';

describe('HISTORY_CSV_HEADERS', () => {
  it('pins the column order: pre-cardio columns byte-identical, cardio columns trailing', () => {
    // Downstream scripts key on column positions. Never reorder or insert;
    // new columns may only be appended after the last entry.
    expect([...HISTORY_CSV_HEADERS]).toEqual([
      'session_id',
      'session_date',
      'session_started_at',
      'session_finished_at',
      'duration_min',
      'program',
      'workout',
      'exercise',
      'muscle_group',
      'uses_bodyweight',
      'set_number',
      'external_load_kg',
      'effective_weight_kg',
      'reps',
      'rir',
      'is_warmup',
      'is_drop_set',
      'volume_kg',
      'estimated_1rm_kg',
      'set_notes',
      'duration_sec',
      'distance_m',
      'avg_hr',
      'max_hr',
      'block',
    ]);
  });
});

describe('csvEscape', () => {
  it('passes plain values through unchanged', () => {
    expect(csvEscape('Bench press')).toBe('Bench press');
    expect(csvEscape('100')).toBe('100');
    expect(csvEscape('')).toBe('');
  });

  it('quotes fields containing separators and doubles inner quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
  });

  it('neutralizes every leading formula character', () => {
    expect(csvEscape('=cmd|calc')).toBe("'=cmd|calc");
    expect(csvEscape('+1+1')).toBe("'+1+1");
    expect(csvEscape('-2+3')).toBe("'-2+3");
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvEscape('\timport')).toBe("'\timport");
    expect(csvEscape('\rimport')).toBe('"\'\rimport"');
  });

  it('quotes a neutralized field that also contains separators', () => {
    expect(csvEscape('=HYPERLINK("http://x"),click')).toBe(
      '"\'=HYPERLINK(""http://x""),click"',
    );
  });

  it('does not touch formula characters inside the value', () => {
    expect(csvEscape('weighted dips +20kg')).toBe('weighted dips +20kg');
    expect(csvEscape('a=b')).toBe('a=b');
  });
});
