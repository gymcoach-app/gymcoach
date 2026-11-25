import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GIT_ENV,
  type Git,
  MAX_CARRY_MERGES,
  runGit,
  verifyBaseUpdates,
  verifyIdenticalDiff,
} from './base-update';

// Real git in a throwaway repository: the hops are what git proves, so the
// cases are built as an author would build them. The harness, like the gate,
// ignores the host's global and system git config, so a user identity or a
// merge driver configured on this machine cannot hide a bug.
let repo: string;
let git: Git;

const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];

function raw(args: string[]) {
  return spawnSync('git', [...IDENTITY, '-c', 'commit.gpgsign=false', ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
  });
}

function sh(...args: string[]): string {
  const r = raw(args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(file: string, content: string) {
  const path = join(repo, file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function commitFile(file: string, content: string, message: string): string {
  write(file, content);
  sh('add', file);
  sh('commit', '-q', '-m', message);
  return sh('rev-parse', 'HEAD');
}

// A new commit on main, which becomes the live tip.
let mainCounter = 0;
function advanceMain(): string {
  sh('checkout', '-q', 'main');
  mainCounter += 1;
  return commitFile(`main-${mainCounter}.ts`, `export const m = ${mainCounter};\n`, `main ${mainCounter}`);
}

// `count` new commits on main in one git process (fast-import), without
// checking main out: the same commits advanceMain makes one at a time, four
// processes each. The caller must not be on main, whose work tree this leaves
// behind. Returns the new commits, oldest first; the last is the live tip.
function advanceMainBy(count: number): string[] {
  const marks = join(repo, '.git', 'advance-main.marks');
  let stream = '';
  for (let i = 1; i <= count; i += 1) {
    mainCounter += 1;
    const message = `main ${mainCounter}`;
    const content = `export const m = ${mainCounter};\n`;
    stream +=
      `commit refs/heads/main\nmark :${i}\n` +
      `committer Test <test@example.com> ${1_700_000_000 + mainCounter} +0000\n` +
      `data ${Buffer.byteLength(message)}\n${message}\n` +
      (i === 1 ? 'from refs/heads/main^0\n' : '') +
      `M 100644 inline main-${mainCounter}.ts\ndata ${Buffer.byteLength(content)}\n${content}\n`;
  }
  const r = spawnSync('git', ['fast-import', '--quiet', `--export-marks=${marks}`], {
    cwd: repo,
    encoding: 'utf8',
    input: stream,
    env: { ...process.env, ...GIT_ENV },
  });
  if (r.status !== 0) throw new Error(`git fast-import: ${r.stderr}`);
  const byMark = new Map(
    readFileSync(marks, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split(' ') as [string, string]),
  );
  return Array.from({ length: count }, (_, index) => byMark.get(`:${index + 1}`)!);
}

// Merges `other` into `branch` (created at `from` when given), optionally with
// a hand edit before the merge commit is written.
function mergeInto(branch: string, other: string, opts: { from?: string; edit?: () => void } = {}) {
  if (opts.from) sh('branch', '-f', branch, opts.from);
  sh('checkout', '-q', branch);
  const r = raw(['merge', '-q', '--no-ff', '--no-commit', other]);
  if (r.status !== 0 && !opts.edit) throw new Error(`merge failed: ${r.stderr}`);
  opts.edit?.();
  sh('add', '-A');
  sh('commit', '-q', '--no-edit', '-m', `merge ${other}`);
  return sh('rev-parse', 'HEAD');
}

function worktreeCount(): number {
  return sh('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;
}

let base: string;
let head: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'gymcoach-base-update-'));
  git = runGit(repo);
  sh('init', '-q', '-b', 'main');
  base = commitFile('CHANGELOG.md', 'top\n\nmiddle\n\nbottom\n', 'base');
  sh('checkout', '-q', '-b', 'feature');
  head = commitFile('feature.ts', 'export const a = 1;\n', 'feature');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('pure base update verification', () => {
  it('proves a clean merge of the live tip into the reviewed head', () => {
    const tip = advanceMain();
    const merged = mergeInto('pure', tip, { from: head });
    expect(verifyBaseUpdates(git, merged, tip)).toEqual({
      hops: [{ head: merged, reviewedHead: head, base: tip }],
      basesOnMain: [],
      error: null,
    });
    // The throwaway worktrees are gone.
    expect(worktreeCount()).toBe(1);
  });

  it('rejects a merge commit carrying a hand edit', () => {
    const tip = advanceMain();
    const merged = mergeInto('edited', tip, {
      from: head,
      edit: () => write('feature.ts', 'export const a = 1;\nexport const sneaky = true;\n'),
    });
    expect(verifyBaseUpdates(git, merged, tip).hops).toEqual([]);
  });

  it('rejects a merge that needed a conflict resolution', () => {
    // A side branch stands in for a main that touched the same file, so the
    // later cases still merge cleanly into the real main.
    sh('checkout', '-q', '-b', 'conflict-main', advanceMain());
    const tip = commitFile('feature.ts', 'export const a = 3;\n', 'main touches it too');
    const merged = mergeInto('conflicted', tip, {
      from: head,
      edit: () => write('feature.ts', 'export const a = 1;\n'),
    });
    expect(verifyBaseUpdates(git, merged, tip).hops).toEqual([]);
  });

  it('rejects a merge whose second parent is not the live tip', () => {
    const tip = advanceMain();
    sh('checkout', '-q', '-b', 'stranger', base);
    const stranger = commitFile('stranger.ts', 'export const c = 3;\n', 'not on main');
    const merged = mergeInto('foreign', stranger, { from: head });
    expect(verifyBaseUpdates(git, merged, tip).hops).toEqual([]);
  });

  it('rejects swapped parents (the head merged into main, not main into the head)', () => {
    const tip = advanceMain();
    // First parent main, second the reviewed head.
    const swapped = mergeInto('swapped', head, { from: tip });
    expect(verifyBaseUpdates(git, swapped, tip).hops).toEqual([]);
  });

  it('rejects an octopus merge', () => {
    const tip = advanceMain();
    sh('checkout', '-q', '-b', 'octo-side', base);
    const side = commitFile('side.ts', 'export const s = 1;\n', 'side');
    sh('branch', '-f', 'octopus', head);
    sh('checkout', '-q', 'octopus');
    sh('merge', '-q', '--no-ff', '-m', 'octopus', tip, side);
    const octopus = sh('rev-parse', 'HEAD');
    expect(sh('rev-list', '--parents', '-n', '1', octopus).split(' ')).toHaveLength(4);
    expect(verifyBaseUpdates(git, octopus, tip).hops).toEqual([]);
  });

  it('rejects a plain commit (a fixup, not a base update)', () => {
    expect(verifyBaseUpdates(git, head, advanceMain()).hops).toEqual([]);
  });

  it('ends the chain when the reviewed head changes .gitattributes', () => {
    // With `merge=union`, a conflicting update would re-merge "cleanly": the
    // reviewed head must not choose how the re-merge resolves.
    sh('checkout', '-q', '-b', 'attributes', head);
    const withAttrs = commitFile('.gitattributes', '*.md merge=union\n', 'attributes');
    const tip = advanceMain();
    const merged = mergeInto('attributes', tip);
    expect(verifyBaseUpdates(git, merged, tip).hops).toEqual([]);
    // Nested attributes files count too.
    sh('checkout', '-q', '-b', 'nested-attributes', head);
    commitFile('lib/.gitattributes', '*.ts merge=union\n', 'nested attributes');
    const tip2 = advanceMain();
    const nested = mergeInto('nested-attributes', tip2);
    expect(verifyBaseUpdates(git, nested, tip2).hops).toEqual([]);
    // A path git quotes in plain ls-tree output (non-ASCII) is compared too.
    sh('checkout', '-q', '-b', 'quoted-attributes', head);
    commitFile('café/.gitattributes', '*.ts merge=union\n', 'quoted-path attributes');
    const tip3 = advanceMain();
    const quoted = mergeInto('quoted-attributes', tip3);
    expect(verifyBaseUpdates(git, quoted, tip3).hops).toEqual([]);
    expect(withAttrs).toMatch(/^[0-9a-f]{40}$/);
  });

  it('follows two pure updates, the older one merging a commit on main', () => {
    const tip = advanceMain();
    const first = mergeInto('twice', tip, { from: head });
    const tip2 = advanceMain();
    const second = mergeInto('twice', tip2);
    expect(verifyBaseUpdates(git, second, tip2).hops).toEqual([
      { head: second, reviewedHead: first, base: tip2 },
      { head: first, reviewedHead: head, base: tip },
    ]);
  });

  it('ends the chain at an older hop whose second parent is not on main', () => {
    sh('checkout', '-q', '-b', 'off-main', base);
    const offMain = commitFile('off-main.ts', 'export const o = 1;\n', 'never merged');
    const first = mergeInto('older-off-main', offMain, { from: head });
    const tip = advanceMain();
    const second = mergeInto('older-off-main', tip);
    // Only the newest hop is proven; the older one brought in an unmerged branch.
    expect(verifyBaseUpdates(git, second, tip).hops).toEqual([
      { head: second, reviewedHead: first, base: tip },
    ]);
  });

  it('follows at most five hops', () => {
    // Six updates of main, each merged into the branch. Built with as few git
    // processes as the history allows (15 instead of 55): starting a process
    // is what this file's time is made of, and this test, the longest, went
    // past its limit on a busy machine (issue #593). The merges are still
    // real `git merge` commits.
    sh('checkout', '-q', '-B', 'many', head);
    const tips = advanceMainBy(6);
    const heads = [head];
    for (const mainTip of tips) {
      sh('merge', '-q', '--no-ff', '-m', `merge ${mainTip}`, mainTip);
      heads.push(sh('rev-parse', 'HEAD'));
    }
    const tip = tips.at(-1)!;
    // The same shape mergeInto builds: two parents, the reviewed head first.
    expect(sh('rev-list', '--parents', '-n', '1', heads[6]!)).toBe(
      `${heads[6]} ${heads[5]} ${tip}`,
    );
    const { hops } = verifyBaseUpdates(git, heads[6]!, tip);
    // Six pure hops exist; the walk stops after five (MAX_HOPS).
    expect(hops).toHaveLength(5);
    expect(hops.at(-1)!.reviewedHead).toBe(heads[1]);
  });

  it('proves which record bases are on main', () => {
    const tip = advanceMain();
    sh('checkout', '-q', '-b', 'stack-parent', base);
    const stackTip = commitFile('stack.ts', 'export const p = 1;\n', 'parent PR, never merged');
    const result = verifyBaseUpdates(git, head, tip, [base, stackTip, base]);
    expect(result.basesOnMain).toEqual([base]);
    expect(result.error).toBeNull();
  });

  it('treats a record base absent from the repository as not on main', () => {
    // A stacked PR's old parent tip is never fetched; all of main is, so an
    // absent base cannot be on main. Not an error: the other bases still count.
    const tip = advanceMain();
    const absent = '1'.repeat(40);
    expect(verifyBaseUpdates(git, head, tip, [absent, base])).toEqual({
      hops: [],
      basesOnMain: [base],
      error: null,
    });
  });

  it('fails closed when git cannot answer', () => {
    const tip = advanceMain();
    const missing = '0'.repeat(40);
    const result = verifyBaseUpdates(git, missing, tip);
    expect(result).toMatchObject({ hops: [], basesOnMain: [] });
    expect(result.error).toMatch(/git rev-list/);
    // Checking a record base fails for another reason than absence: an error,
    // never "not on main".
    const catFileBroken: Git = (args, opts) =>
      args[0] === 'cat-file'
        ? { status: 128, stdout: '', stderr: 'fatal: bad object' }
        : git(args, opts);
    expect(verifyBaseUpdates(catFileBroken, head, tip, [base]).error).toMatch(/cat-file/);
    // A record base that exists but is not a commit (a blob): merge-base
    // cannot answer, which is an error too, never "not on main".
    const blob = sh('rev-parse', `${head}:feature.ts`);
    expect(verifyBaseUpdates(git, head, tip, [blob]).error).toMatch(/merge-base/);
    const mergeBaseBroken: Git = (args, opts) =>
      args[0] === 'merge-base'
        ? { status: 128, stdout: '', stderr: 'fatal: bad revision' }
        : git(args, opts);
    expect(verifyBaseUpdates(mergeBaseBroken, head, tip, [base]).error).toMatch(/merge-base/);
    const broken: Git = () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' });
    expect(verifyBaseUpdates(broken, head, tip)).toEqual({
      hops: [],
      basesOnMain: [],
      error: expect.stringContaining('not a git repository'),
    });
  });
});

// Identical-diff carry-over (#582): a record pinned to (base, head) counts for
// a newer head when only merges of main were added and the PR's diff is the
// same, blob for blob. Same throwaway repository, same real git. The cases
// build many real merges (twenty-one for the limit), which is slow when the
// whole suite runs in parallel: hence the timeout.
describe('identical-diff carry-over', { timeout: 60_000 }, () => {
  const pin = () => ({ baseSha: base, headSha: head });
  const CHANGELOG = 'top\n\nmiddle\n\nbottom\n';

  // A PR that edits a file main already has, so main (or a merge) can touch
  // the same file.
  function changelogPr(branch: string, content: string): string {
    sh('checkout', '-q', '-b', branch, base);
    return commitFile('CHANGELOG.md', content, `${branch} edits the changelog`);
  }

  // A side branch standing in for a main that also edited the changelog, so
  // the real main stays free of it for the other cases.
  function mainEditingChangelog(branch: string, content: string): string {
    sh('checkout', '-q', '-b', branch, advanceMain());
    return commitFile('CHANGELOG.md', content, `${branch}: main edits the changelog`);
  }

  it('carries a record over a clean merge of main and says why', () => {
    const tip = advanceMain();
    const merged = mergeInto('idc-clean', tip, { from: head });
    const result = verifyIdenticalDiff(git, pin(), merged, tip);
    expect(result).toMatchObject({
      recordHead: head,
      recordBase: base,
      head: merged,
      base: tip,
      carried: true,
    });
    expect(result.detail).toContain('1 merge(s) of the base branch');
    expect(result.detail).toContain("the PR's 1 file(s)");
    expect(result.detail).toMatch(/patch-id --stable [0-9a-f]{12} is identical/);
  });

  it('carries across more merges than the pure-update walk follows, and skips a pin the hops carry', () => {
    sh('branch', '-f', 'idc-many', head);
    const heads = [head];
    let tip = '';
    for (let i = 0; i < 6; i += 1) {
      tip = advanceMain();
      heads.push(mergeInto('idc-many', tip));
    }
    const evidence = verifyBaseUpdates(
      git,
      heads[6]!,
      tip,
      [base],
      [pin(), pin(), { baseSha: base, headSha: heads[3]! }, { baseSha: base, headSha: heads[6]! }],
    );
    expect(evidence.error).toBeNull();
    // Six pure hops exist; the walk proves five, so `head` is out of its reach.
    expect(evidence.hops).toHaveLength(5);
    // One proof for the pin the hops do not reach; none for the one they
    // carry (heads[3]) nor for the approved head itself.
    expect(evidence.identicalDiffs).toHaveLength(1);
    expect(evidence.identicalDiffs![0]).toMatchObject({ recordHead: head, carried: true });
    expect(evidence.identicalDiffs![0]!.detail).toContain('6 merge(s)');
  });

  it('examines no pin when every record is for the approved head or hop-carried', () => {
    const tip = advanceMain();
    const merged = mergeInto('idc-hop', tip, { from: head });
    const evidence = verifyBaseUpdates(git, merged, tip, [base], [pin()]);
    expect(evidence).toEqual({
      hops: [{ head: merged, reviewedHead: head, base: tip }],
      basesOnMain: [base],
      error: null,
    });
  });

  it('refuses when a non-merge commit was added after or before the merge', () => {
    const tip = advanceMain();
    mergeInto('idc-extra', tip, { from: head });
    const after = commitFile('extra.ts', 'export const x = 1;\n', 'fixup after the merge');
    const afterResult = verifyIdenticalDiff(git, pin(), after, tip);
    expect(afterResult.carried).toBe(false);
    expect(afterResult.detail).toContain('is not a merge of the base branch (1 parent(s))');
    sh('checkout', '-q', '-b', 'idc-fixup-first', head);
    const fixup = commitFile('extra.ts', 'export const x = 1;\n', 'fixup before the merge');
    const merged = mergeInto('idc-fixup-first', tip);
    const beforeResult = verifyIdenticalDiff(git, pin(), merged, tip);
    expect(beforeResult.carried).toBe(false);
    expect(beforeResult.detail).toContain(`${fixup.slice(0, 12)} is not a merge`);
  });

  it('refuses when the merge resolution changed the diff', () => {
    const prHead = changelogPr('idc-conflict-pr', 'top\n\nmiddle from the PR\n\nbottom\n');
    const tip = mainEditingChangelog('idc-conflict-main', 'top\n\nmiddle from main\n\nbottom\n');
    const merged = mergeInto('idc-conflict-pr', tip, {
      edit: () => write('CHANGELOG.md', 'top\n\nmiddle from the PR and main\n\nbottom\n'),
    });
    const result = verifyIdenticalDiff(git, { baseSha: base, headSha: prHead }, merged, tip);
    expect(result.carried).toBe(false);
    expect(result.detail).toContain('git patch-id --stable differs');
    // Keeping the PR's side verbatim is still another diff: main's line is
    // now what the PR removes.
    const kept = mergeInto('idc-conflict-kept', tip, {
      from: prHead,
      edit: () => write('CHANGELOG.md', 'top\n\nmiddle from the PR\n\nbottom\n'),
    });
    expect(verifyIdenticalDiff(git, { baseSha: base, headSha: prHead }, kept, tip)).toMatchObject({
      carried: false,
      detail: expect.stringContaining('git patch-id --stable differs'),
    });
  });

  it('refuses a whitespace-only edit in the merge, which patch-id does not see', () => {
    const prHead = changelogPr('idc-space-pr', 'top\n\nrm -rf build/tmp\n\nbottom\n');
    const tip = advanceMain();
    const merged = mergeInto('idc-space-pr', tip, {
      edit: () => write('CHANGELOG.md', 'top\n\nrm -rf build/ tmp\n\nbottom\n'),
    });
    const result = verifyIdenticalDiff(git, { baseSha: base, headSha: prHead }, merged, tip);
    expect(result.carried).toBe(false);
    expect(result.detail).toContain('does not have the same blobs');
    // The clean merge of the same PR carries.
    const clean = mergeInto('idc-space-clean', tip, { from: prHead });
    expect(verifyIdenticalDiff(git, { baseSha: base, headSha: prHead }, clean, tip).carried).toBe(
      true,
    );
  });

  it('leaves a PR file that main also changed to the pure-update proof', () => {
    // The PR edits the first line, main the last: a clean merge and the same
    // patch-id, but not the blobs the reviewers read.
    const prHead = changelogPr('idc-both-pr', 'top from the PR\n\nmiddle\n\nbottom\n');
    const tip = mainEditingChangelog('idc-both-main', 'top\n\nmiddle\n\nbottom from main\n');
    const merged = mergeInto('idc-both-pr', tip);
    const record = { baseSha: base, headSha: prHead };
    const result = verifyIdenticalDiff(git, record, merged, tip);
    expect(result.carried).toBe(false);
    expect(result.detail).toContain('does not have the same blobs');
    // The hop proof (a clean re-merge) still carries it.
    expect(verifyBaseUpdates(git, merged, tip, [base], [record])).toEqual({
      hops: [{ head: merged, reviewedHead: prHead, base: tip }],
      basesOnMain: [base],
      error: null,
    });
    expect(CHANGELOG).toBe(sh('show', `${base}:CHANGELOG.md`) + '\n');
  });

  it('refuses when the merge commit adds a file', () => {
    const tip = advanceMain();
    const merged = mergeInto('idc-sneaky', tip, {
      from: head,
      edit: () => write('sneaky.ts', 'export const sneaky = true;\n'),
    });
    expect(verifyIdenticalDiff(git, pin(), merged, tip)).toMatchObject({
      carried: false,
      detail: "the PR's file list changed since the reviewed head",
    });
  });

  it('refuses when the other parent is not on main', () => {
    sh('checkout', '-q', '-b', 'idc-stranger', base);
    const stranger = commitFile('idc-stranger.ts', 'export const c = 3;\n', 'not on main');
    const first = mergeInto('idc-foreign', stranger, { from: head });
    const tip = advanceMain();
    const merged = mergeInto('idc-foreign', tip);
    const result = verifyIdenticalDiff(git, pin(), merged, tip);
    expect(result.carried).toBe(false);
    expect(result.detail).toContain(
      `${first.slice(0, 12)} merges ${stranger.slice(0, 12)}, which is not on the base branch`,
    );
    // Swapped parents: main first, the reviewed head second.
    const swapped = mergeInto('idc-swapped', head, { from: tip });
    expect(verifyIdenticalDiff(git, pin(), swapped, tip)).toMatchObject({
      carried: false,
      detail: expect.stringContaining('which is not on the base branch'),
    });
    // An octopus merge is not a merge of main alone.
    sh('branch', '-f', 'idc-octopus', head);
    sh('checkout', '-q', 'idc-octopus');
    sh('merge', '-q', '--no-ff', '-m', 'octopus', tip, stranger);
    expect(verifyIdenticalDiff(git, pin(), sh('rev-parse', 'HEAD'), tip)).toMatchObject({
      carried: false,
      detail: expect.stringContaining('(3 parent(s))'),
    });
  });

  it('refuses when the reviewed head is not an ancestor of the approved head', () => {
    sh('checkout', '-q', '-b', 'idc-elsewhere', base);
    const elsewhere = commitFile('feature.ts', 'export const a = 1;\n', 'same change, other commit');
    const tip = advanceMain();
    const merged = mergeInto('idc-ancestor', tip, { from: head });
    const refused = {
      carried: false,
      detail: `the reviewed head is not an ancestor of ${merged.slice(0, 12)}`,
    };
    expect(
      verifyIdenticalDiff(git, { baseSha: base, headSha: elsewhere }, merged, tip),
    ).toMatchObject(refused);
    // A head that is not in the repository (a force-pushed PR's old head) is
    // not an ancestor either: a refusal, not an error.
    const absent = '1'.repeat(40);
    expect(verifyBaseUpdates(git, merged, tip, [base], [{ baseSha: base, headSha: absent }])).toMatchObject({
      identicalDiffs: [{ recordHead: absent, ...refused }],
      error: null,
    });
    expect(verifyIdenticalDiff(git, { baseSha: base, headSha: 'main' }, merged, tip).carried).toBe(
      false,
    );
  });

  it('refuses a record base that is not on main, and an approved head without the live tip', () => {
    sh('checkout', '-q', '-b', 'idc-stack-parent', base);
    const stackTip = commitFile('idc-stack.ts', 'export const p = 1;\n', 'parent PR, never merged');
    const older = advanceMain();
    const merged = mergeInto('idc-behind', older, { from: head });
    expect(
      verifyIdenticalDiff(git, { baseSha: stackTip, headSha: head }, merged, older),
    ).toMatchObject({ carried: false, detail: 'the record base is not on the base branch' });
    expect(verifyIdenticalDiff(git, pin(), merged, older).carried).toBe(true);
    // main moved on: the approved head merged an older commit of main.
    const tip = advanceMain();
    expect(verifyIdenticalDiff(git, pin(), merged, tip)).toMatchObject({
      carried: false,
      detail: `${merged.slice(0, 12)} does not contain the live tip of the base branch`,
    });
  });

  it('stops after MAX_CARRY_MERGES merges', () => {
    sh('branch', '-f', 'idc-long', head);
    let tip = '';
    let merged = '';
    for (let i = 0; i <= MAX_CARRY_MERGES; i += 1) {
      tip = advanceMain();
      merged = mergeInto('idc-long', tip);
    }
    expect(verifyIdenticalDiff(git, pin(), merged, tip)).toMatchObject({
      carried: false,
      detail: `more than ${MAX_CARRY_MERGES} commits were added since the reviewed head`,
    });
  });

  it('fails closed when git cannot answer', () => {
    // A hand-edited merge: no hop, so the pin is examined.
    const tip = advanceMain();
    const merged = mergeInto('idc-broken', tip, {
      from: head,
      edit: () => write('feature.ts', 'export const a = 1;\nexport const b = 2;\n'),
    });
    expect(verifyBaseUpdates(git, merged, tip, [base], [pin()])).toMatchObject({
      hops: [],
      identicalDiffs: [{ carried: false }],
      error: null,
    });
    for (const command of ['patch-id', 'diff', 'merge-base', 'rev-list', 'cat-file']) {
      // The first rev-list call is the hop walk's; the carry-over walk's own
      // call is the one that must fail closed.
      let revLists = 0;
      const broken: Git = (args, opts) =>
        args[0] === command && !(command === 'rev-list' && (revLists += 1) === 1)
          ? { status: 128, stdout: '', stderr: `fatal: ${command} is broken` }
          : git(args, opts);
      const evidence = verifyBaseUpdates(broken, merged, tip, [], [pin()]);
      expect(evidence.error, command).toContain(command);
      expect(evidence).toMatchObject({ hops: [], basesOnMain: [] });
      expect(evidence.identicalDiffs, command).toBeUndefined();
    }
    // An unexpected entry in the raw diff is an error too, never a guess.
    const garbled: Git = (args, opts) =>
      args.includes('--raw') ? { status: 0, stdout: 'not a raw entry\0path\0', stderr: '' } : git(args, opts);
    expect(verifyBaseUpdates(garbled, merged, tip, [], [pin()]).error).toContain(
      'unexpected git diff entry',
    );
    expect(() => verifyIdenticalDiff(garbled, pin(), mergeInto('idc-garbled', tip, { from: head }), tip)).toThrow(
      'unexpected git diff entry',
    );
  });
});
