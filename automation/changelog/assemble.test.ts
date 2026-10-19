import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type Fragment,
  UsageError,
  assemble,
  fragmentFiles,
  orderFragments,
  parseAssembleArgs,
  parseFragment,
  run,
} from './assemble';

function frag(section: string, body: string): string {
  return `---\nsection: ${section}\n---\n${body}`;
}

function ok(name: string, text: string): Fragment {
  const parsed = parseFragment(name, text);
  if ('errors' in parsed) throw new Error(parsed.errors.join('; '));
  return parsed.fragment;
}

function errorsOf(name: string, text: string): string[] {
  const parsed = parseFragment(name, text);
  return 'errors' in parsed ? parsed.errors : [];
}

const CHANGELOG = [
  '# Changelog',
  '',
  'Intro.',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '- Old added entry,',
  '  wrapped.',
  '',
  '### Fixed',
  '',
  '- Old fix.',
  '',
  '## [1.0.0] - 2026-10-05',
  '',
  '### Added',
  '',
  '- Released.',
  '',
].join('\n');

describe('parseFragment', () => {
  it('reads the section and the entry lines', () => {
    expect(ok('376-mcp-cap.md', frag('Fixed', 'First line\nsecond line (#376).\n'))).toEqual({
      name: '376-mcp-cap.md',
      section: 'Fixed',
      lines: ['First line', 'second line (#376).'],
    });
  });

  it('accepts CRLF line endings and trims trailing blank lines', () => {
    const text = '---\r\nsection: Added\r\n---\r\nOne line.\r\n\r\n';
    expect(ok('1-a.md', text).lines).toEqual(['One line.']);
  });

  it('refuses a bad name, an unknown section, an empty body and dashes', () => {
    expect(errorsOf('Fix.md', frag('Fixed', 'x'))[0]).toMatch(/name must be/);
    expect(errorsOf('1-a.md', frag('Improved', 'x'))[0]).toMatch(/unknown section Improved/);
    expect(errorsOf('1-a.md', frag('Fixed', '\n\n'))[0]).toMatch(/entry text is empty/);
    expect(errorsOf('1-a.md', frag('Fixed', 'a \u2014 b'))[0]).toMatch(/em or en dash/);
    expect(errorsOf('1-a.md', frag('Fixed', 'a \u2013 b'))[0]).toMatch(/em or en dash/);
  });

  it('refuses a missing front matter, a bullet and a second entry', () => {
    expect(errorsOf('1-a.md', 'Fixed\nx')[0]).toMatch(/front matter/);
    expect(errorsOf('1-a.md', frag('Fixed', '- x'))[0]).toMatch(/without its "- " bullet/);
    expect(errorsOf('1-a.md', frag('Fixed', 'a\n\nb'))[0]).toMatch(/one entry per fragment/);
  });
});

describe('assemble', () => {
  it('puts fragments at the top of their existing section and keeps the rest', () => {
    const out = assemble(CHANGELOG, [
      ok('10-a.md', frag('Fixed', 'New fix,\nwrapped.')),
      ok('11-b.md', frag('Added', 'New added.')),
    ]);
    expect(out).toBe(
      CHANGELOG.replace('### Added\n\n- Old', '### Added\n\n- New added.\n- Old').replace(
        '### Fixed\n\n- Old fix.',
        '### Fixed\n\n- New fix,\n  wrapped.\n- Old fix.',
      ),
    );
  });

  it('orders a batch newest first by number, ties by name', () => {
    const names = orderFragments([
      ok('9-z.md', frag('Fixed', 'x')),
      ok('120-b.md', frag('Fixed', 'x')),
      ok('120-a.md', frag('Fixed', 'x')),
      ok('15-c.md', frag('Fixed', 'x')),
    ]).map((f) => f.name);
    expect(names).toEqual(['120-a.md', '120-b.md', '15-c.md', '9-z.md']);
    const out = assemble(CHANGELOG, [
      ok('9-old.md', frag('Fixed', 'Nine.')),
      ok('12-new.md', frag('Fixed', 'Twelve.')),
    ]);
    expect(out).toContain('### Fixed\n\n- Twelve.\n- Nine.\n- Old fix.');
  });

  it('creates a missing section at its Keep a Changelog position', () => {
    const out = assemble(CHANGELOG, [
      ok('1-c.md', frag('Changed', 'Changed.')),
      ok('2-s.md', frag('Security', 'Secured.')),
    ]);
    // Changed goes before the first later section that exists (Fixed);
    // Security has no later section, so it closes Unreleased.
    expect(out).toContain(
      '- Old added entry,\n  wrapped.\n\n### Changed\n\n- Changed.\n\n### Fixed\n\n- Old fix.\n\n### Security\n\n- Secured.\n\n## [1.0.0]',
    );
    // The released section is untouched.
    expect(out.slice(out.indexOf('## [1.0.0]'))).toBe(CHANGELOG.slice(CHANGELOG.indexOf('## [1.0.0]')));
  });

  it('creates an Unreleased block when there is none', () => {
    const released = CHANGELOG.slice(0, CHANGELOG.indexOf('## [Unreleased]')) +
      CHANGELOG.slice(CHANGELOG.indexOf('## [1.0.0]'));
    const out = assemble(released, [ok('3-x.md', frag('Fixed', 'Fix.'))]);
    expect(out).toContain('Intro.\n\n## [Unreleased]\n\n### Fixed\n\n- Fix.\n\n## [1.0.0]');
  });

  it('is the identity with no fragments', () => {
    expect(assemble(CHANGELOG, [])).toBe(CHANGELOG);
  });

  it('skips an entry already folded, so a rerun adds no duplicate', () => {
    const fragments = [
      ok('10-a.md', frag('Fixed', 'New fix,\nwrapped.')),
      ok('11-s.md', frag('Security', 'Secured.')),
    ];
    const once = assemble(CHANGELOG, fragments);
    expect(assemble(once, fragments)).toBe(once);
    // Only the missing one is added when the first fold was partial.
    expect(assemble(assemble(CHANGELOG, [fragments[0]!]), fragments)).toBe(once);
  });

  it('keeps CRLF line endings', () => {
    const crlf = CHANGELOG.replace(/\n/g, '\r\n');
    const fragments = [ok('10-a.md', frag('Fixed', 'New fix.'))];
    expect(assemble(crlf, fragments)).toBe(assemble(CHANGELOG, fragments).replace(/\n/g, '\r\n'));
  });

  it('keeps a blank line before the next heading when the section was empty', () => {
    const empty = CHANGELOG.replace('### Fixed\n\n- Old fix.\n', '### Fixed\n');
    expect(empty).toContain('### Fixed\n\n## [1.0.0]');
    const out = assemble(empty, [ok('3-x.md', frag('Fixed', 'Fix.'))]);
    expect(out).toContain('### Fixed\n\n- Fix.\n\n## [1.0.0]');
    const between = '## [Unreleased]\n\n### Added\n\n### Fixed\n\n- Old.\n';
    expect(assemble(between, [ok('4-y.md', frag('Added', 'New.'))])).toBe(
      '## [Unreleased]\n\n### Added\n\n- New.\n\n### Fixed\n\n- Old.\n',
    );
  });
});

describe('CLI arguments', () => {
  it('parses its arguments strictly', () => {
    expect(parseAssembleArgs([])).toEqual({
      check: false,
      dir: 'changelog.d',
      changelog: 'CHANGELOG.md',
    });
    expect(parseAssembleArgs(['--check', '--dir', 'd', '--changelog', 'C.md'])).toEqual({
      check: true,
      dir: 'd',
      changelog: 'C.md',
    });
    expect(() => parseAssembleArgs(['--check', '--check'])).toThrow(UsageError);
    expect(() => parseAssembleArgs(['--dir'])).toThrow(UsageError);
    expect(() => parseAssembleArgs(['--dir', '--check'])).toThrow(UsageError);
    expect(() => parseAssembleArgs(['--write'])).toThrow(UsageError);
  });

  it('skips the README and non-markdown files', () => {
    expect(fragmentFiles(['README.md', 'b-2.txt', '2-b.md', '1-a.md'])).toEqual(['1-a.md', '2-b.md']);
  });
});

describe('run', () => {
  let root: string;
  let dir: string;
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function setup(files: Record<string, string>) {
    root = mkdtempSync(join(tmpdir(), 'changelog-'));
    dir = join(root, 'changelog.d');
    mkdirSync(dir);
    writeFileSync(join(root, 'CHANGELOG.md'), CHANGELOG);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    return ['--dir', dir, '--changelog', join(root, 'CHANGELOG.md')];
  }

  it('folds the fragments and deletes only them', () => {
    const args = setup({ 'README.md': 'readme', '5-a.md': frag('Fixed', 'A fix.') });
    expect(run(args)).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(['README.md']);
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toContain('### Fixed\n\n- A fix.\n- Old fix.');
  });

  it('writes nothing and deletes nothing when a fragment is invalid', () => {
    const args = setup({ '5-a.md': frag('Fixed', 'A fix.'), '6-b.md': frag('Nope', 'x') });
    expect(run(args)).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(['5-a.md', '6-b.md']);
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(CHANGELOG);
  });

  it('only validates with --check', () => {
    const args = setup({ '5-a.md': frag('Fixed', 'A fix.') });
    expect(run(['--check', ...args])).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(['5-a.md']);
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(CHANGELOG);
  });
});

// The repository's own fragments must be valid, so a malformed one fails the
// unit tier as well as the --check step of the green gate.
describe('changelog.d in this repository', () => {
  const dir = join(__dirname, '..', '..', 'changelog.d');
  it('holds only valid fragments', () => {
    const errors = fragmentFiles(readdirSync(dir)).flatMap((name) =>
      errorsOf(name, readFileSync(join(dir, name), 'utf8')),
    );
    expect(errors).toEqual([]);
  });
});
