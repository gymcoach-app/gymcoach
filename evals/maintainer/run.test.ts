import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { freshRunTree, gradeInputHashes } from './run';

// The per-run grading tree (run.ts): each run gets a fresh copy of the
// template, and the grade inputs in it are checked against the expected hashes
// before the run starts.
const task = { grader: { hidden: ['lib/a.test.ts'], preserved: ['lib/b.test.ts'] } };
const dirs: string[] = [];

function template(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gymcoach-eval-test-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'lib'));
  mkdirSync(path.join(dir, 'tests'));
  writeFileSync(path.join(dir, 'lib/a.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(dir, 'lib/a.test.ts'), "it('a', () => {});\n");
  writeFileSync(path.join(dir, 'lib/b.test.ts'), "it('b', () => {});\n");
  writeFileSync(path.join(dir, 'tests/setup.ts'), 'export {};\n');
  writeFileSync(path.join(dir, 'vitest.setup.ts'), 'export {};\n');
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('freshRunTree', () => {
  it('hashes grade inputs only, not application code', () => {
    const t = template();
    expect([...gradeInputHashes(t, task).keys()].sort()).toEqual([
      'lib/a.test.ts',
      'lib/b.test.ts',
      'tests/setup.ts',
      'vitest.setup.ts',
    ]);
  });

  it('gives every run its own copy, unaffected by what an earlier run wrote', () => {
    const t = template();
    const expected = gradeInputHashes(t, task);
    const first = freshRunTree(t, expected, task);
    dirs.push(first);
    // A run that managed to write into its own tree changes nothing for the next.
    writeFileSync(path.join(first, 'lib/b.test.ts'), "it('always passes', () => {});\n");
    const second = freshRunTree(t, expected, task);
    dirs.push(second);
    expect(readFileSync(path.join(second, 'lib/b.test.ts'), 'utf8')).toBe("it('b', () => {});\n");
  });

  it('fails closed when a grade input differs from what is expected', () => {
    const t = template();
    const expected = gradeInputHashes(t, task);
    writeFileSync(path.join(t, 'vitest.setup.ts'), "vi.mock('x');\n");
    expect(() => freshRunTree(t, expected, task)).toThrow(/vitest\.setup\.ts/);
    const added = gradeInputHashes(template(), task);
    const t2 = template();
    writeFileSync(path.join(t2, 'tests/extra.ts'), 'export {};\n');
    expect(() => freshRunTree(t2, added, task)).toThrow(/tests\/extra\.ts/);
  });
});
