import { describe, expect, it } from 'vitest';
import { newHits, testGlobalHits } from './test-globals';

const kinds = (content: string) => testGlobalHits('lib/x.ts', content).map((h) => h.key);

describe('testGlobalHits', () => {
  it('reaches a test global through a ternary alias, not through a passed-on value', () => {
    const content = 'const c = cond;\nconst g = c ? globalThis : other;\ng.afterEach(restore);';
    expect(kinds(content)).toContain('test global read off the global object: g.afterEach');
    expect(kinds(content).some((k) => k.startsWith('global object passed on'))).toBe(false);
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
      expect(kinds(content!), content).toContain(
        `test global read off the global object: ${member}`,
      );
  });

  it('reaches an assertion API only through the taint path', () => {
    const KIND = 'assertion API read off an untracked object';
    for (const [content, member] of [
      ['const w = q ?? p[k];\nw.expect(0);', 'w.expect'],
      ['const [w] = [p[k]];\nw.expect(0);', 'w.expect'],
      ['const { [k]: w } = p;\nw.vi.fn();', 'w.vi'],
      ['let w;\n[w] = [p[k]];\nw.expect(0);', 'w.expect'],
      ['const { ...w } = p[k];\nw.expect(0);', 'w.expect'],
      ['const [...w] = [p[k]];\nw.expect(0);', 'w.expect'],
      ['const { a = p[k] } = opts;\na.expect(0);', 'a.expect'],
      ['const o = { a: p[k] };\no.a.expect(0);', 'o.a.expect'],
      ['const o = { ...p[k] };\no.expect(0);', 'o.expect'],
      ['const s = p[k];\nconst o = { s };\no.s.expect(0);', 'o.s.expect'],
      ['let w;\nw ??= p[k];\nw.expect(0);', 'w.expect'],
      ['let w;\nw ||= p[k];\nw.expect(0);', 'w.expect'],
      ['let w = x;\nw &&= p[k];\nw.expect(0);', 'w.expect'],
      ['for (const w of [p[k]]) w.expect(0);', 'w.expect'],
      ['for (const w in p[k]) w.expect(0);', 'w.expect'],
      ['let w;\nfor (w of [p[k]]) w.expect(0);', 'w.expect'],
      ['function f(w = p[k]) {\n  w.expect(0);\n}', 'w.expect'],
      ['try {\n  run(p[k]);\n} catch (w) {\n  w.expect(0);\n}', 'w.expect'],
      ['async function f() {\n  const w = await p[k];\n  w.expect(0);\n}', 'w.expect'],
      ['const o = {};\no.w = p[k];\no.w.expect(0);', 'o.w.expect'],
      ['class C {\n  w = p[k];\n  m() {\n    this.w.expect(0);\n  }\n}', 'this.w.expect'],
      ['class C {\n  m() {\n    this.w = p[k];\n    this.w.chai.use(x);\n  }\n}', 'this.w.chai'],
    ])
      expect(kinds(content!), content).toContain(`${KIND}: ${member}`);
    // Untainted receivers stay accepted.
    for (const content of [
      'const w = q ?? fallback;\nw.expect(0);',
      'const [w] = [res];\nw.expect(200);',
      'try {\n  run();\n} catch (w) {\n  w.expect(0);\n}',
    ])
      expect(kinds(content), content).toEqual([]);
  });

  it('marks computed and reflective reads to be blamed on any change', () => {
    const hits = testGlobalHits('lib/x.ts', "const w = document[k];\nReflect.get(document, 'x');");
    expect(hits.map((h) => h.always)).toEqual([true, true]);
    expect(testGlobalHits('lib/x.ts', 'node[k](fn);').map((h) => h.lineOnly)).toEqual([true]);
  });

  it('blames nothing when the file is unchanged', () => {
    const content = 'const k = name;\nconst w = window[k];\nconst parent = 1;\n';
    expect(testGlobalHits('lib/x.ts', content).length).toBeGreaterThan(0);
    expect(newHits(testGlobalHits, 'lib/x.ts', content, content)).toEqual([]);
  });

  it('reports a read of constructor, the route to the Function constructor (review of #503)', () => {
    const KIND = 'constructor read (reaches the Function constructor)';
    for (const content of [
      'const F = (() => 0).constructor;\nF(code)();',
      "const F = fn['constructor'];",
      'const { constructor: F } = fn;',
      'Object.getPrototypeOf(fn).constructor(code);',
    ])
      expect(
        kinds(content).some((k) => k.startsWith(KIND)),
        content,
      ).toBe(true);
    for (const content of [
      'class A {\n  constructor(private n: number) {}\n}',
      'class B extends A {\n  constructor() {\n    super(1);\n  }\n}',
    ])
      expect(kinds(content), content).toEqual([]);
  });
});
