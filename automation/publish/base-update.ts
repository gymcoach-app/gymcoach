import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FULL_SHA,
  type BaseUpdateEvidence,
  type IdenticalDiffCarry,
  type PureBaseUpdate,
} from '@/automation/publish/gate';

// Pure base updates (lesson L39, roadmap milestone 2). When `main` moves, the
// merge gate refuses a PR whose base is stale until `origin/main` is merged
// into it. That merge commit is a new head, so the review records of the head
// before it would no longer match. They carry over only when the merge added
// nothing but `main`: this module proves it, hop by hop, from the approved
// head backwards. A hop is pure when the commit has exactly two parents, its
// second parent is `main` (the live tip for the newest hop, a commit on `main`
// for an older one), both parents carry the same .gitattributes files, and
// its tree equals a clean re-merge of its two parents computed here, in the
// trusted gate tree. Tree equality is what keeps code out of a "merge": a
// hand edit, a conflict resolution or an extra file changes the tree. The
// attributes rule keeps the reviewed head from choosing how the re-merge
// resolves (a built-in `merge=union` makes a conflicting update look clean).
// Anything else ends the chain, which keeps the older rule (the records of
// the older head are stale). It also proves which review record bases are on
// `main`: a record bound to another branch (a stacked PR later retargeted)
// never carries; a base absent locally is not on `main`. Any other git failure
// is reported as an error, and the gate refuses on it rather than guess.
//
// Identical-diff carry-over (#582) is the second proof made here, for the
// record pins the hops do not reach (GitHub's update-branch wrote a merge this
// git re-merges differently, more than MAX_HOPS updates, an attributes
// mismatch): see verifyIdenticalDiff below.

export const MAX_HOPS = 5;

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

// `input` is sent on stdin; `exact` keeps stdout untrimmed (a patch may end
// with a blank context line).
export type Git = (
  args: string[],
  opts?: { cwd?: string; input?: string; exact?: boolean },
) => GitResult;

// The re-merge must not depend on, or be steered through, the host's git
// configuration: no global or system config (no user filters, merge drivers,
// rerere or url rewrites), no system or user attributes file, hooks off, and a
// fixed identity because `git merge` wants one even when it writes no commit.
export const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_ATTR_NOSYSTEM: '1',
} as const;
const SAFE_CONFIG = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.attributesFile=/dev/null',
  '-c',
  'rerere.enabled=false',
  '-c',
  'user.name=merge-gate',
  '-c',
  'user.email=merge-gate@invalid',
];

export function runGit(cwd: string): Git {
  return (args, opts) => {
    const r = spawnSync('git', [...SAFE_CONFIG, ...args], {
      cwd: opts?.cwd ?? cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...GIT_ENV, GIT_TERMINAL_PROMPT: '0' },
      ...(opts?.input === undefined ? {} : { input: opts.input }),
    });
    return {
      status: r.status ?? 1,
      stdout: opts?.exact ? (r.stdout ?? '') : (r.stdout ?? '').trim(),
      stderr: (r.stderr ?? '').trim(),
    };
  };
}

class GitFailure extends Error {}

function must(git: Git, args: string[], cwd?: string): string {
  const r = git(args, cwd ? { cwd } : undefined);
  if (r.status !== 0) {
    throw new GitFailure(`git ${args.join(' ')}: ${r.stderr.split('\n')[0] || `exit ${r.status}`}`);
  }
  return r.stdout;
}

// Re-merges `second` into `first` in a throwaway worktree and returns the
// resulting tree, or null when the merge does not apply cleanly.
function cleanMergeTree(git: Git, first: string, second: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'gymcoach-gate-merge-'));
  const tree = join(dir, 'tree');
  try {
    must(git, ['worktree', 'add', '--detach', '--quiet', tree, first]);
    const merged = git(['merge', '--no-ff', '--no-commit', '--quiet', second], { cwd: tree });
    if (merged.status !== 0) {
      // A conflict leaves unmerged index entries; anything else is a failure.
      const unmerged = must(git, ['ls-files', '--unmerged'], tree);
      if (unmerged) return null;
      throw new GitFailure(`git merge ${second}: ${merged.stderr.split('\n')[0] || 'failed'}`);
    }
    return must(git, ['write-tree'], tree);
  } finally {
    git(['worktree', 'remove', '--force', tree]);
    rmSync(dir, { recursive: true, force: true });
    git(['worktree', 'prune']);
  }
}

// Whether the object is in the local repository. Exit 1 is "absent"; any
// other failure is an error.
function hasObject(git: Git, sha: string): boolean {
  const r = git(['cat-file', '-e', sha]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new GitFailure(`git cat-file -e: ${r.stderr.split('\n')[0] || `exit ${r.status}`}`);
}

function isAncestor(git: Git, ancestor: string, of: string): boolean {
  const r = git(['merge-base', '--is-ancestor', ancestor, of]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new GitFailure(`git merge-base --is-ancestor: ${r.stderr.split('\n')[0] || `exit ${r.status}`}`);
}

// Every .gitattributes file of a commit, as NUL-joined "path blob" entries.
// NUL-separated output (`-z`) keeps paths unquoted: without it git quotes a
// path with non-ASCII or special characters, and a nested attributes file
// there would slip past the comparison. NUL is also the join, since a path may
// contain a newline but never a NUL.
function attributesOf(git: Git, commit: string): string {
  return must(git, ['ls-tree', '-r', '-z', commit])
    .split('\0')
    .map((entry) => {
      const tab = entry.indexOf('\t');
      return { path: entry.slice(tab + 1), blob: entry.slice(0, tab).split(' ')[2] };
    })
    .filter(({ path }) => /(^|\/)\.gitattributes$/.test(path))
    .map(({ path, blob }) => `${path} ${blob}`)
    .sort()
    .join('\0');
}

export const MAX_CARRY_MERGES = 20;

export interface RecordPin {
  baseSha: string;
  headSha: string;
}

interface PrDiff {
  // "status path" per changed file, NUL-joined: the PR's file list.
  files: string;
  // The same entries with both modes and both blob ids.
  raw: string;
  count: number;
  // `git patch-id --stable` of the diff; empty for an empty diff.
  patchId: string;
}

const RAW_ENTRY = /^:[0-7]{6} [0-7]{6} [0-9a-f]{40} [0-9a-f]{40} ([ADMT])$/;
// The same fixed options for both sides: no rename guessing, no external or
// textconv driver.
const DIFF_OPTIONS = ['--no-ext-diff', '--no-textconv', '--no-color', '--no-renames'];

// What a PR changes: the diff from `from` (the merge base with the base
// branch) to `to` (the PR head), as a file list, exact blobs and a patch-id.
function prDiff(git: Git, from: string, to: string): PrDiff {
  const raw = must(git, ['diff', ...DIFF_OPTIONS, '--raw', '--no-abbrev', '-z', from, to]);
  // A path that is not valid UTF-8 was decoded lossily: never compare it.
  if (raw.includes('\uFFFD')) throw new GitFailure('a changed path is not valid UTF-8');
  const fields = raw.split('\0').filter((f) => f !== '');
  if (fields.length % 2 !== 0) throw new GitFailure('unexpected git diff --raw output');
  const files: string[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const status = RAW_ENTRY.exec(fields[i]!)?.[1];
    if (!status) throw new GitFailure(`unexpected git diff entry: ${JSON.stringify(fields[i])}`);
    files.push(`${status} ${fields[i + 1]!}`);
  }
  // A binary file is one "Binary files differ" line here: its content is
  // compared through the blob ids of `raw`, like every other file's.
  const patch = git(['diff', ...DIFF_OPTIONS, '-U3', from, to], { exact: true });
  if (patch.status !== 0) {
    throw new GitFailure(`git diff ${from} ${to}: ${patch.stderr.split('\n')[0] || 'failed'}`);
  }
  const id = git(['patch-id', '--stable'], { input: patch.stdout });
  if (id.status !== 0) {
    throw new GitFailure(`git patch-id: ${id.stderr.split('\n')[0] || `exit ${id.status}`}`);
  }
  return { files: files.join('\0'), raw, count: files.length, patchId: id.stdout };
}

const short = (sha: string) => sha.slice(0, 12);

// Identical-diff carry-over (#582): whether a review record pinned to
// (pin.baseSha, pin.headSha) still describes the PR at `approvedSha`, with
// `baseTip` the live tip of `main`. Carried only when all of this holds:
//   (a) the reviewed head is an ancestor of the approved head;
//   (b) every commit added since, walking first parents from the approved head
//       down to the reviewed head, is a two-parent merge whose second parent
//       is on `main`: no plain commit, no merge of another branch, no octopus,
//       at most MAX_CARRY_MERGES of them;
//   (c) `git patch-id --stable` of the PR diff (merge base with the base
//       branch to the head) is the same for the record and for the live PR;
//   (d) the PR's file list is the same;
//   and, beyond what patch-id sees (it ignores whitespace, line numbers and
//   a binary file's content), every file of the PR has the same mode and
//   blob on both sides of both diffs. `main` therefore changed none of the
//   PR's files since the review, and the approved tree is the live tip plus
//   exactly the blobs the reviewers read. A PR file that `main` also changed
//   is left to the pure-update proof above (a clean re-merge) or to a fresh
//   review.
// The record base must be on `main` (a retargeted stack never carries) and the
// approved head must contain the live tip. A hand-resolved conflict changes
// the diff, so (c) fails. Returns `carried: false` with the first rule that
// failed; a git failure throws, and the gate refuses on it.
export function verifyIdenticalDiff(
  git: Git,
  pin: RecordPin,
  approvedSha: string,
  baseTip: string,
  liveDiff: () => PrDiff = () => prDiff(git, baseTip, approvedSha),
): IdenticalDiffCarry {
  const { baseSha: recordBase, headSha: recordHead } = pin;
  const result = (carried: boolean, detail: string): IdenticalDiffCarry => ({
    recordHead,
    recordBase,
    head: approvedSha,
    base: baseTip,
    carried,
    detail,
  });
  const no = (detail: string) => result(false, detail);
  if (!FULL_SHA.test(recordHead) || !FULL_SHA.test(recordBase)) {
    return no('the record head and base must be full SHAs');
  }
  // Every ancestor of the fetched PR head is local, so an absent commit is
  // not an ancestor (a force-pushed PR's old head, say): no, not an error.
  if (!hasObject(git, recordHead) || !isAncestor(git, recordHead, approvedSha)) {
    return no(`the reviewed head is not an ancestor of ${short(approvedSha)}`);
  }
  if (!hasObject(git, recordBase) || !isAncestor(git, recordBase, baseTip)) {
    return no('the record base is not on the base branch');
  }
  let at = approvedSha;
  let merges = 0;
  while (at !== recordHead) {
    if (merges === MAX_CARRY_MERGES) {
      return no(`more than ${MAX_CARRY_MERGES} commits were added since the reviewed head`);
    }
    const [commit, ...parents] = must(git, ['rev-list', '--parents', '-n', '1', at]).split(' ');
    if (commit !== at) throw new GitFailure(`unexpected git rev-list output for ${at}`);
    if (parents.length !== 2) {
      return no(
        `${short(at)} is not a merge of the base branch (${parents.length} parent(s)): a commit was added since the reviewed head`,
      );
    }
    const [first, second] = parents as [string, string];
    if (!isAncestor(git, second, baseTip)) {
      return no(`${short(at)} merges ${short(second)}, which is not on the base branch`);
    }
    at = first;
    merges += 1;
  }
  if (!isAncestor(git, baseTip, approvedSha)) {
    return no(`${short(approvedSha)} does not contain the live tip of the base branch`);
  }
  // Exit 1 is "no merge base"; any other failure is an error.
  const found = git(['merge-base', '--all', recordBase, recordHead]);
  if (found.status !== 0 && found.status !== 1) {
    throw new GitFailure(`git merge-base --all: ${found.stderr.split('\n')[0] || 'failed'}`);
  }
  const mergeBases = found.stdout.split('\n');
  if (found.status === 1 || mergeBases.length !== 1 || !FULL_SHA.test(mergeBases[0]!)) {
    return no('the reviewed head has no single merge base with its record base');
  }
  const reviewed = prDiff(git, mergeBases[0]!, recordHead);
  // The live tip is in the approved head, so it is the live merge base.
  const live = liveDiff();
  if (reviewed.files !== live.files) {
    return no("the PR's file list changed since the reviewed head");
  }
  if (reviewed.patchId === '' || reviewed.patchId !== live.patchId) {
    return no(
      "the PR's diff changed since the reviewed head (git patch-id --stable differs or is empty)",
    );
  }
  if (reviewed.raw !== live.raw) {
    return no(
      'a file of the PR does not have the same blobs as when it was reviewed (the base branch changed it too, or the merge edited it)',
    );
  }
  return result(
    true,
    `${merges} merge(s) of the base branch since ${short(recordHead)}, no other commit; the PR's ${live.count} file(s) and their blobs are unchanged, git patch-id --stable ${short(live.patchId)} is identical`,
  );
}

// The pure hops ending at `approvedSha`, newest first, which of the given
// review record bases are on `main` (ancestors of the live tip), and the
// identical-diff proof for each record pin of another head. The commits
// must already be in the local repository (see collectBaseUpdates).
export function verifyBaseUpdates(
  git: Git,
  approvedSha: string,
  baseTip: string,
  recordBases: readonly string[] = [],
  recordPins: readonly RecordPin[] = [],
): BaseUpdateEvidence {
  const hops: PureBaseUpdate[] = [];
  try {
    if (!FULL_SHA.test(approvedSha) || !FULL_SHA.test(baseTip)) {
      throw new GitFailure('approved head and base tip must be full SHAs');
    }
    let head = approvedSha;
    for (let i = 0; i < MAX_HOPS; i += 1) {
      const [commit, ...parents] = must(git, ['rev-list', '--parents', '-n', '1', head]).split(' ');
      if (commit !== head || parents.length !== 2) break;
      const [first, second] = parents as [string, string];
      // The newest hop must bring in the live tip itself; an older one, a
      // commit that is on `main`. Never an unmerged branch.
      if (i === 0 ? second !== baseTip : !isAncestor(git, second, baseTip)) break;
      if (attributesOf(git, first) !== attributesOf(git, second)) break;
      const expected = cleanMergeTree(git, first, second);
      if (expected === null) break;
      if (must(git, ['rev-parse', `${head}^{tree}`]) !== expected) break;
      hops.push({ head, reviewedHead: first, base: second });
      head = first;
    }
    // The whole of `main` is fetched, so a record base absent from the local
    // repository cannot be on `main`: it counts as "not on main" rather than
    // as an error (a stacked PR's old parent tip is never fetched).
    const basesOnMain = [...new Set(recordBases)].filter(
      (b) => FULL_SHA.test(b) && hasObject(git, b) && isAncestor(git, b, baseTip),
    );
    // A pin the hops already carry (its head on the chain, its base on
    // `main`) needs no second proof.
    const hopHeads = new Set(hops.map((h) => h.reviewedHead));
    const pins = new Map<string, RecordPin>();
    for (const pin of recordPins) {
      if (pin.headSha === approvedSha) continue;
      if (hopHeads.has(pin.headSha) && basesOnMain.includes(pin.baseSha)) continue;
      pins.set(`${pin.baseSha} ${pin.headSha}`, pin);
    }
    let live: PrDiff | undefined;
    const liveDiff = () => (live ??= prDiff(git, baseTip, approvedSha));
    const identicalDiffs = [...pins.values()].map((pin) =>
      verifyIdenticalDiff(git, pin, approvedSha, baseTip, liveDiff),
    );
    return {
      hops,
      basesOnMain,
      ...(identicalDiffs.length ? { identicalDiffs } : {}),
      error: null,
    };
  } catch (err) {
    return { hops: [], basesOnMain: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// Fetches the PR head and the base branch into a ref namespace private to this
// run (two gate runs never contend for one ref lock), verifies, and deletes
// the refs again. Fork PRs included: GitHub serves every PR head under
// refs/pull/<n>/head.
export function collectBaseUpdates(
  git: Git,
  pr: number,
  baseBranch: string,
  approvedSha: string,
  baseTip: string,
  recordBases: readonly string[],
  recordPins: readonly RecordPin[] = [],
): BaseUpdateEvidence {
  const ns = `refs/gymcoach-gate/${process.pid}-${randomBytes(4).toString('hex')}`;
  const refs = [`${ns}/pr-${pr}`, `${ns}/${baseBranch}`];
  try {
    must(git, [
      'fetch',
      '--quiet',
      '--no-tags',
      'origin',
      `+refs/pull/${pr}/head:${refs[0]}`,
      `+refs/heads/${baseBranch}:${refs[1]}`,
    ]);
    return verifyBaseUpdates(git, approvedSha, baseTip, recordBases, recordPins);
  } catch (err) {
    return { hops: [], basesOnMain: [], error: err instanceof Error ? err.message : String(err) };
  } finally {
    for (const ref of refs) git(['update-ref', '-d', ref]);
  }
}
