import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FULL_SHA, type BaseUpdateEvidence, type PureBaseUpdate } from '@/automation/publish/gate';

// Pure base updates (lesson L39, roadmap milestone 2). When `main` moves, the
// merge gate refuses a PR whose base is stale until `origin/main` is merged
// into it. That merge commit is a new head, so the review records of the head
// before it would no longer match. They carry over only when the merge added
// nothing but `main`: this module proves it, hop by hop, from the approved
// head backwards. A hop is pure when the commit has exactly two parents, its
// second parent is `main` (the live tip for the newest hop, a commit on `main`
// for an older one), and its tree equals a clean re-merge of its two parents
// computed here, in the trusted gate tree. Tree equality is what keeps code out
// of a "merge": a hand edit, a conflict resolution or an extra file changes the
// tree. Anything else ends the chain, which keeps today's rule (the records of
// the older head are stale). A git failure is reported as an error, and the
// gate refuses on it rather than guess.

export const MAX_HOPS = 5;

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type Git = (args: string[], opts?: { cwd?: string }) => GitResult;

// Hooks and the user's rerere cache must not influence or observe the check.
const SAFE_CONFIG = ['-c', 'core.hooksPath=/dev/null', '-c', 'rerere.enabled=false'];

export function runGit(cwd: string): Git {
  return (args, opts) => {
    const r = spawnSync('git', [...SAFE_CONFIG, ...args], {
      cwd: opts?.cwd ?? cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return {
      status: r.status ?? 1,
      stdout: (r.stdout ?? '').trim(),
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
  must(git, ['worktree', 'add', '--detach', '--quiet', tree, first]);
  try {
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
  }
}

function isAncestor(git: Git, ancestor: string, of: string): boolean {
  const r = git(['merge-base', '--is-ancestor', ancestor, of]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new GitFailure(`git merge-base --is-ancestor: ${r.stderr.split('\n')[0] || `exit ${r.status}`}`);
}

// The pure hops ending at `approvedSha`, newest first. The commits must already
// be in the local repository (see fetchForBaseUpdates).
export function verifyBaseUpdates(git: Git, approvedSha: string, baseTip: string): BaseUpdateEvidence {
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
      const expected = cleanMergeTree(git, first, second);
      if (expected === null) break;
      if (must(git, ['rev-parse', `${head}^{tree}`]) !== expected) break;
      hops.push({ head, reviewedHead: first, base: second });
      head = first;
    }
    return { hops, error: null };
  } catch (err) {
    return { hops: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// Brings the PR head and the base branch into the gate's repository, so the
// commits verifyBaseUpdates walks are present. Fork PRs included: GitHub
// serves every PR head under refs/pull/<n>/head.
export function fetchForBaseUpdates(git: Git, pr: number, baseBranch: string): void {
  must(git, [
    'fetch',
    '--quiet',
    '--no-tags',
    'origin',
    `+refs/pull/${pr}/head:refs/gymcoach-gate/pr-${pr}`,
    `+refs/heads/${baseBranch}:refs/gymcoach-gate/${baseBranch}`,
  ]);
}

export function collectBaseUpdates(
  git: Git,
  pr: number,
  baseBranch: string,
  approvedSha: string,
  baseTip: string,
): BaseUpdateEvidence {
  try {
    fetchForBaseUpdates(git, pr, baseBranch);
  } catch (err) {
    return { hops: [], error: err instanceof Error ? err.message : String(err) };
  }
  return verifyBaseUpdates(git, approvedSha, baseTip);
}
