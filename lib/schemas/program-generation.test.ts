import { describe, it, expect } from 'vitest';
import { parseGeneratedProgram, extractJsonObject } from './program-generation';

const validProgram = {
  name: 'Upper / Lower',
  description: 'A 4-day split.',
  phase: 'Hypertrophy',
  workouts: [
    {
      name: 'Upper',
      dayOfWeek: 1,
      exercises: [
        {
          name: 'Barbell bench press',
          muscleGroup: 'CHEST',
          category: 'COMPOUND',
          targetSets: 4,
          targetRepsMin: 6,
          targetRepsMax: 10,
          targetRIR: 2,
          restSec: 120,
          autoregulationMode: 'PRESERVE_RIR',
          fatigueRate: 0.75,
          loadAdjustmentPct: 2.5,
          tempo: '3-0-1-0',
        },
      ],
    },
  ],
};

describe('extractJsonObject', () => {
  it('returns the object from raw text', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('strips code fences', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('slices around surrounding prose', () => {
    expect(extractJsonObject('Here you go: {"a":1} done')).toBe('{"a":1}');
  });

  it('returns null when there is no object', () => {
    expect(extractJsonObject('no json here')).toBeNull();
  });
});

describe('parseGeneratedProgram', () => {
  it('parses a valid program', () => {
    const r = parseGeneratedProgram(JSON.stringify(validProgram));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.program.name).toBe('Upper / Lower');
      expect(r.program.workouts[0]!.exercises[0]!.muscleGroup).toBe('CHEST');
      expect(r.program.workouts[0]!.exercises[0]!.autoregulationMode).toBe('PRESERVE_RIR');
    }
  });

  it('parses a fenced response with prose', () => {
    const text = `Sure!\n\`\`\`json\n${JSON.stringify(validProgram)}\n\`\`\``;
    expect(parseGeneratedProgram(text).ok).toBe(true);
  });

  it('rejects invalid JSON', () => {
    const r = parseGeneratedProgram('{ not valid');
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown muscle group', () => {
    const bad = structuredClone(validProgram);
    bad.workouts[0]!.exercises[0]!.muscleGroup = 'WINGS';
    expect(parseGeneratedProgram(JSON.stringify(bad)).ok).toBe(false);
  });

  it('rejects targetRepsMax below targetRepsMin', () => {
    const bad = structuredClone(validProgram);
    bad.workouts[0]!.exercises[0]!.targetRepsMin = 12;
    bad.workouts[0]!.exercises[0]!.targetRepsMax = 8;
    expect(parseGeneratedProgram(JSON.stringify(bad)).ok).toBe(false);
  });

  it('rejects an empty workouts array', () => {
    const bad = { ...validProgram, workouts: [] };
    expect(parseGeneratedProgram(JSON.stringify(bad)).ok).toBe(false);
  });

  it('rejects autoregulation coefficients outside their safe bounds', () => {
    const bad = structuredClone(validProgram);
    bad.workouts[0]!.exercises[0]!.fatigueRate = 3;
    expect(parseGeneratedProgram(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe('leading reasoning block (issue #571)', () => {
  const think = '<think>Plan: {"days": 4}\n```json\n{"draft": true}\n```\n</think>\n\n';

  it('extracts the object that follows the block, not the braces inside it', () => {
    expect(extractJsonObject(`${think}{"a":1}`)).toBe('{"a":1}');
    expect(extractJsonObject(`${think}\`\`\`json\n{"a":1}\n\`\`\``)).toBe('{"a":1}');
  });

  it('parses a program prefixed by one or several blocks', () => {
    const json = JSON.stringify(validProgram);
    const one = parseGeneratedProgram(`${think}${json}`);
    expect(one.ok).toBe(true);
    const several = parseGeneratedProgram(`${think}<reasoning>more {</reasoning>\n${json}`);
    expect(several.ok).toBe(true);
    if (several.ok) expect(several.program.name).toBe('Upper / Lower');
  });

  it('fails with the existing error on an unclosed block', () => {
    const out = parseGeneratedProgram(`<think>thinking ${JSON.stringify(validProgram)}`);
    expect(out).toEqual({ ok: false, error: 'No JSON object found in the model response.' });
  });

  it('keeps a block inside a string value', () => {
    const withTag = { ...validProgram, description: '<think>kept</think> A 4-day split.' };
    const out = parseGeneratedProgram(JSON.stringify(withTag));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.program.description).toBe('<think>kept</think> A 4-day split.');
  });
});
