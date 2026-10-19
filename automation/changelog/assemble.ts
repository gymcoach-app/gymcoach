import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Folds changelog fragments into CHANGELOG.md (lesson L47, roadmap milestone 4).
//
//   npx tsx automation/changelog/assemble.ts [--check] [--dir changelog.d] [--changelog CHANGELOG.md]
//
// A PR adds one file under changelog.d/ instead of editing CHANGELOG.md, so two
// PRs never touch the same lines and a merge of main into a branch stays a pure
// base update that the merge gate can prove (automation/publish/base-update.ts).
// Without --check it inserts every fragment at the top of its section under
// `## [Unreleased]` and deletes the folded files. --check only validates them.
// Exit codes: 0 done (or every fragment valid), 1 an invalid fragment, 2 usage
// error.

export class UsageError extends Error {}

// Keep a Changelog order, used only to place a section that does not exist yet.
export const SECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'] as const;
export type Section = (typeof SECTIONS)[number];

export interface Fragment {
  name: string;
  section: Section;
  // The entry text without its bullet, one element per line.
  lines: string[];
}

export const FRAGMENT_NAME = /^[1-9][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const DASHES = /[\u2013\u2014]/;

// Pure: a fragment file's name and content to a fragment, or the reasons it is
// not one.
export function parseFragment(
  name: string,
  text: string,
): { fragment: Fragment } | { errors: string[] } {
  const errors: string[] = [];
  if (!FRAGMENT_NAME.test(name)) {
    errors.push(`${name}: name must be <issue-or-pr>-<slug>.md in lowercase, e.g. 123-rest-timer.md`);
  }
  if (DASHES.test(text)) errors.push(`${name}: contains an em or en dash; use a hyphen`);
  const match = /^---\nsection: *([A-Za-z]+) *\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!match) {
    errors.push(`${name}: must start with a front matter block: ---, section: <Section>, ---`);
    return { errors };
  }
  const section = match[1] as Section;
  if (!SECTIONS.includes(section)) {
    errors.push(`${name}: unknown section ${match[1]}; use one of ${SECTIONS.join(', ')}`);
  }
  const lines = match[2]!.split('\n').map((l) => l.trimEnd());
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (!lines.length) errors.push(`${name}: the entry text is empty`);
  else if (lines.includes('')) errors.push(`${name}: one entry per fragment, without blank lines`);
  else if (/^[-*] /.test(lines[0]!)) errors.push(`${name}: write the entry without its "- " bullet`);
  if (errors.length) return { errors };
  return { fragment: { name, section, lines: lines.map((l) => l.trim()) } };
}

// Newest first, like the hand-written entries: a higher issue or PR number goes
// higher, ties by name, so the result never depends on directory order.
export function orderFragments(fragments: Fragment[]): Fragment[] {
  const num = (f: Fragment) => Number(f.name.split('-')[0]);
  return [...fragments].sort((a, b) => num(b) - num(a) || a.name.localeCompare(b.name));
}

function bullet(f: Fragment): string[] {
  return f.lines.map((l, i) => (i === 0 ? `- ${l}` : `  ${l}`));
}

// Pure: the changelog with the fragments inserted. Existing entries, sections
// and their order are kept; a missing section is created at its Keep a
// Changelog position among the sections that exist.
export function assemble(changelog: string, fragments: Fragment[]): string {
  const lines = changelog.split('\n');
  let start = lines.indexOf('## [Unreleased]');
  if (start === -1) {
    const firstRelease = lines.findIndex((l) => l.startsWith('## '));
    const at = firstRelease === -1 ? lines.length : firstRelease;
    lines.splice(at, 0, '## [Unreleased]', '');
    start = at;
  }
  const ordered = orderFragments(fragments);
  for (const section of SECTIONS) {
    const entries = ordered.filter((f) => f.section === section).flatMap(bullet);
    if (!entries.length) continue;
    let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
    if (end === -1) end = lines.length;
    const heading = lines.findIndex((l, i) => i > start && i < end && l === `### ${section}`);
    if (heading !== -1) {
      let at = heading + 1;
      while (at < end && lines[at] === '') at += 1;
      lines.splice(at, 0, ...entries);
      continue;
    }
    const later = SECTIONS.slice(SECTIONS.indexOf(section) + 1);
    let at = lines.findIndex(
      (l, i) => i > start && i < end && later.some((s) => l === `### ${s}`),
    );
    if (at === -1) {
      at = end;
      while (at - 1 > start && lines[at - 1] === '') at -= 1;
      lines.splice(at, 0, '', `### ${section}`, '', ...entries);
    } else {
      lines.splice(at, 0, `### ${section}`, '', ...entries, '');
    }
  }
  return lines.join('\n');
}

export interface AssembleArgs {
  check: boolean;
  dir: string;
  changelog: string;
}

export function parseAssembleArgs(argv: string[]): AssembleArgs {
  const args: AssembleArgs = { check: false, dir: 'changelog.d', changelog: 'CHANGELOG.md' };
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (seen.has(arg)) throw new UsageError(`${arg} given twice`);
    seen.add(arg);
    if (arg === '--check') {
      args.check = true;
    } else if (arg === '--dir' || arg === '--changelog') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a path`);
      if (arg === '--dir') args.dir = value;
      else args.changelog = value;
      i += 1;
    } else {
      throw new UsageError(`unknown argument ${arg}`);
    }
  }
  return args;
}

// The fragment files of a directory: every .md file but its README.
export function fragmentFiles(names: string[]): string[] {
  return names.filter((n) => n.endsWith('.md') && n !== 'README.md').sort();
}

function run(argv: string[]): number {
  const args = parseAssembleArgs(argv);
  const names = fragmentFiles(readdirSync(args.dir));
  const fragments: Fragment[] = [];
  let invalid = 0;
  for (const name of names) {
    const parsed = parseFragment(name, readFileSync(join(args.dir, name), 'utf8'));
    if ('errors' in parsed) {
      for (const e of parsed.errors) console.error(`invalid-fragment: ${e}`);
      invalid += 1;
    } else {
      fragments.push(parsed.fragment);
    }
  }
  if (invalid) return 1;
  if (args.check) {
    console.log(`${fragments.length} changelog fragment(s) valid.`);
    return 0;
  }
  if (!fragments.length) {
    console.log('No changelog fragments to fold.');
    return 0;
  }
  writeFileSync(args.changelog, assemble(readFileSync(args.changelog, 'utf8'), fragments));
  for (const f of fragments) unlinkSync(join(args.dir, f.name));
  console.log(`Folded ${fragments.length} fragment(s) into ${args.changelog}.`);
  return 0;
}

function main() {
  try {
    process.exit(run(process.argv.slice(2)));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Usage error: ${err.message}`);
      console.error(
        'Usage: assemble.ts [--check] [--dir changelog.d] [--changelog CHANGELOG.md]',
      );
      process.exit(2);
    }
    console.error(`Unexpected error: ${(err as Error).message ?? String(err)}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('assemble.ts')) main();
