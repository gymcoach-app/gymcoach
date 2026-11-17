import { describe, expect, it } from 'vitest';
import { extractAdjustments } from './coach-adjustments';

describe('extractAdjustments', () => {
  it('returns the original markdown when no tag is present', () => {
    const md = '## Recap\n\nGood volume this week.';
    const r = extractAdjustments(md);
    expect(r.cleaned).toBe(md);
    expect(r.adjustments).toEqual([]);
    expect(r.parseErrors).toEqual([]);
  });

  it('strips the adjustments block and parses a valid array', () => {
    const md = `## Recap

Great progression on the squat.

<adjustments>
[
  {
    "exerciseName": "Squat",
    "summary": "Move up to 82.5 kg",
    "suggestedLoad": 82.5,
    "currentLoad": 80
  },
  {
    "exerciseName": "Barbell curl",
    "summary": "Lower the rep range to 8-12",
    "suggestedRepsMin": 8,
    "suggestedRepsMax": 12,
    "rationale": "You have been stuck at 12 reps for 3 weeks."
  }
]
</adjustments>`;
    const r = extractAdjustments(md);
    expect(r.cleaned).not.toContain('<adjustments>');
    expect(r.cleaned).toContain('## Recap');
    expect(r.adjustments).toHaveLength(2);
    expect(r.adjustments[0]).toMatchObject({
      exerciseName: 'Squat',
      summary: 'Move up to 82.5 kg',
      suggestedLoad: 82.5,
    });
    expect(r.adjustments[1]?.suggestedRepsMin).toBe(8);
    expect(r.parseErrors).toEqual([]);
  });

  it('returns parseErrors when JSON is malformed (markdown still cleaned)', () => {
    const md = `Some text
<adjustments>
[ { "exerciseName": "Squat" }
</adjustments>`;
    const r = extractAdjustments(md);
    expect(r.cleaned).toBe('Some text');
    expect(r.adjustments).toEqual([]);
    expect(r.parseErrors[0]).toMatch(/Invalid JSON/);
  });

  it('returns parseErrors when schema validation fails', () => {
    const md = `Text
<adjustments>
[
  { "exerciseName": "", "summary": "empty" }
]
</adjustments>`;
    const r = extractAdjustments(md);
    expect(r.adjustments).toEqual([]);
    expect(r.parseErrors[0]).toMatch(/Invalid schema/);
  });

  it('handles an empty adjustments tag', () => {
    const md = `Text\n<adjustments></adjustments>`;
    const r = extractAdjustments(md);
    expect(r.adjustments).toEqual([]);
    expect(r.parseErrors[0]).toMatch(/Empty/);
  });

  it('clamps RIR and reps to the documented bounds', () => {
    const md = `<adjustments>
[
  { "exerciseName": "Squat", "summary": "x", "suggestedRIR": 9 }
]
</adjustments>`;
    const r = extractAdjustments(md);
    expect(r.adjustments).toEqual([]);
    expect(r.parseErrors).toHaveLength(1);
  });
});

describe('extractAdjustments with a leading reasoning block (issue #571)', () => {
  const block = '<adjustments>[{"exerciseName":"Squat","summary":"Move up to 82.5 kg"}]</adjustments>';

  it('drops the block and reads the real adjustments, not a draft in the thinking', () => {
    const r = extractAdjustments(
      `<think>Draft: <adjustments>[{"nope":1}]</adjustments></think>\n## Recap\n\nGood week.\n\n${block}`,
    );
    expect(r.cleaned).toBe('## Recap\n\nGood week.');
    expect(r.parseErrors).toEqual([]);
    expect(r.adjustments).toEqual([{ exerciseName: 'Squat', summary: 'Move up to 82.5 kg' }]);
  });

  it('returns nothing to show or apply for an unclosed block', () => {
    const r = extractAdjustments(`<think>never closed ${block}`);
    expect(r).toEqual({ cleaned: '', adjustments: [], parseErrors: [] });
  });

  it('keeps a reasoning tag that is not leading', () => {
    const r = extractAdjustments(`## Recap\n\n<think>kept</think>\n\n${block}`);
    expect(r.cleaned).toBe('## Recap\n\n<think>kept</think>');
    expect(r.adjustments).toHaveLength(1);
  });
});
