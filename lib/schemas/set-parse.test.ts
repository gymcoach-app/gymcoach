import { describe, it, expect } from 'vitest';
import {
  setParseResultSchema,
  parseSetDescription,
  extractJsonObject,
  PARSE_WEIGHT_MAX,
} from './set-parse';
import { MAX_DURATION_SEC } from '@/lib/cardio';

// Issue #210: this is the NEW, separate parse contract (NOT the <adjustments>
// block). These tests pin it: valid shapes accepted, every junk/out-of-range
// path rejected to "fill nothing".

describe('setParseResultSchema (the parse contract)', () => {
  it('accepts a strength parse with and without rir', () => {
    expect(
      setParseResultSchema.safeParse({ kind: 'strength', weight: 100, reps: 8, rir: 2 })
        .success,
    ).toBe(true);
    expect(
      setParseResultSchema.safeParse({ kind: 'strength', weight: 0, reps: 5 }).success,
    ).toBe(true);
  });

  it('accepts a cardio parse with optional distance/avgHr', () => {
    expect(
      setParseResultSchema.safeParse({
        kind: 'cardio',
        durationSec: 1500,
        distanceM: 5000,
        avgHr: 150,
      }).success,
    ).toBe(true);
    expect(
      setParseResultSchema.safeParse({ kind: 'cardio', durationSec: 600 }).success,
    ).toBe(true);
  });

  it('rejects an unknown kind and a kind/field mismatch', () => {
    expect(setParseResultSchema.safeParse({ kind: 'mystery', weight: 1, reps: 1 }).success).toBe(
      false,
    );
    // A strength kind cannot carry a duration that the strength shape forbids
    // (discriminated union routes by kind, and strength has no durationSec).
    const r = setParseResultSchema.safeParse({
      kind: 'strength',
      durationSec: 1500,
    });
    expect(r.success).toBe(false);
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(setParseResultSchema.safeParse({ kind: 'strength', weight: 100, reps: 0 }).success).toBe(
      false,
    ); // reps must be >= 1
    expect(
      setParseResultSchema.safeParse({ kind: 'strength', weight: 100, reps: 8.5 }).success,
    ).toBe(false);
    expect(
      setParseResultSchema.safeParse({ kind: 'strength', weight: 100, reps: 8, rir: 9 })
        .success,
    ).toBe(false);
    expect(
      setParseResultSchema.safeParse({
        kind: 'strength',
        weight: PARSE_WEIGHT_MAX + 1,
        reps: 8,
      }).success,
    ).toBe(false);
    expect(
      setParseResultSchema.safeParse({
        kind: 'cardio',
        durationSec: MAX_DURATION_SEC + 1,
      }).success,
    ).toBe(false);
  });
});

describe('extractJsonObject', () => {
  it('pulls a JSON object out of fences and surrounding prose', () => {
    expect(extractJsonObject('```json\n{"kind":"strength","weight":1,"reps":1}\n```')).toBe(
      '{"kind":"strength","weight":1,"reps":1}',
    );
    expect(extractJsonObject('here you go: {"a":1} thanks')).toBe('{"a":1}');
    expect(extractJsonObject('no json here')).toBeNull();
  });
});

describe('parseSetDescription (untrusted model output -> typed or fail)', () => {
  it('returns the typed value for a valid strength parse', () => {
    const out = parseSetDescription('{"kind":"strength","weight":100,"reps":8,"rir":2}');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toEqual({ kind: 'strength', weight: 100, reps: 8, rir: 2 });
  });

  it('tolerates code fences and surrounding prose', () => {
    const out = parseSetDescription(
      'Sure!\n```json\n{"kind":"cardio","durationSec":1500,"distanceM":5000}\n```',
    );
    expect(out.ok).toBe(true);
  });

  it('fails closed on a refusal, gibberish, empty, and invalid JSON', () => {
    expect(parseSetDescription('{"error":"unparseable"}').ok).toBe(false);
    expect(parseSetDescription("I can't help with that.").ok).toBe(false);
    expect(parseSetDescription('').ok).toBe(false);
    expect(parseSetDescription('{not valid json}').ok).toBe(false);
    // @ts-expect-error - defensive against a non-string slipping in.
    expect(parseSetDescription(null).ok).toBe(false);
  });

  it('fails closed on out-of-range values (never fills garbage)', () => {
    expect(parseSetDescription('{"kind":"strength","weight":100,"reps":0}').ok).toBe(false);
    expect(parseSetDescription('{"kind":"strength","weight":99999,"reps":8}').ok).toBe(false);
  });

  it('rejects a parse of the wrong kind when an expectedKind is given', () => {
    const strengthText = '{"kind":"strength","weight":100,"reps":8}';
    expect(parseSetDescription(strengthText, 'strength').ok).toBe(true);
    expect(parseSetDescription(strengthText, 'cardio').ok).toBe(false);
  });
});

describe('leading reasoning block (issue #571)', () => {
  const think = '<think>Maybe {"kind":"cardio"}? No: strength.</think>\n';

  it('extracts the object that follows the block, not the braces inside it', () => {
    expect(extractJsonObject(`${think}{"a":1}`)).toBe('{"a":1}');
  });

  it('parses a set prefixed by a block', () => {
    const out = parseSetDescription(`${think}{"kind":"strength","weight":100,"reps":8}`);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toEqual({ kind: 'strength', weight: 100, reps: 8 });
  });

  it('fails closed on an unclosed block', () => {
    expect(parseSetDescription('<think>{"kind":"strength","weight":100,"reps":8}').ok).toBe(false);
  });
});
