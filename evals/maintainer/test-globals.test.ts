import { describe, expect, it } from 'vitest';
import { newHits, testGlobalHits } from './test-globals';

const kinds = (content: string) => testGlobalHits('lib/x.ts', content).map((h) => h.key);

describe('testGlobalHits', () => {
  it('reaches a test global through a ternary alias, not through a passed-on value', () => {
    const content = 'const c = cond;\nconst g = c ? globalThis : other;\ng.afterEach(restore);';
    expect(kinds(content)).toEqual(['test global read off the global object: g.afterEach']);
  });

  it('reaches a test global through each alias form by the alias path', () => {
    for (const [content, member] of [
      ['const g = globalThis;\ng.afterEach(r);', 'g.afterEach'],
      ['const g = (0, globalThis);\ng.afterEach(r);', 'g.afterEach'],
      ['const g = maybe ?? globalThis;\ng.afterEach(r);', 'g.afterEach'],
      ['const { window: w } = globalThis;\nw.afterEach(r);', 'w.afterEach'],
      ['let w;\n({ window: w } = globalThis);\nw.afterEach(r);', 'w.afterEach'],
      ['const { defaultView: v } = document;\nv.afterEach(r);', 'v.afterEach'],
    ])
      expect(kinds(content!), content).toEqual([
        `test global read off the global object: ${member}`,
      ]);
  });

  it('marks computed and reflective reads to be blamed on any change', () => {
    const hits = testGlobalHits('lib/x.ts', "const w = document[k];\nReflect.get(document, 'x');");
    expect(hits.map((h) => h.always)).toEqual([true, true]);
  });

  it('blames nothing when the file is unchanged', () => {
    const content = 'const k = name;\nconst w = window[k];\nconst parent = 1;\n';
    expect(testGlobalHits('lib/x.ts', content).length).toBeGreaterThan(0);
    expect(newHits(testGlobalHits, 'lib/x.ts', content, content)).toEqual([]);
  });
});
