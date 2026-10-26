import { randomBytes } from 'node:crypto';
import type { Git } from '@/automation/publish/base-update';
import { FULL_SHA } from '@/automation/publish/gate';

// The paths a PR changes at the approved SHA, for lens routing (roadmap
// milestone 4). Read with git in the trusted gate tree, not from the files
// API: the API lists the PR's current head, which may have moved since the
// approval, while this diffs the approved commit itself against its merge base
// with the base branch (what GitHub shows as the PR diff). Rename detection is
// on, and both the old and the new path of a rename or copy are listed: moving
// a file out of a guarded directory still touches it. Any git failure is an
// error, and the gate refuses on it.

export type ChangedPaths = { paths: string[]; error: null } | { paths: null; error: string };

class GitFailure extends Error {}

function must(git: Git, args: string[]): string {
  const r = git(args);
  if (r.status !== 0) {
    throw new GitFailure(`git ${args.join(' ')}: ${r.stderr.split('\n')[0] || `exit ${r.status}`}`);
  }
  return r.stdout;
}

// Pure: parses `git diff --name-status -z` output. Each entry is a status
// then one path, or two for a rename (R) or copy (C).
export function parseNameStatus(out: string): string[] {
  const fields = out.split('\0').filter((f) => f !== '');
  const paths = new Set<string>();
  for (let i = 0; i < fields.length; ) {
    const status = fields[i]!;
    const count = /^[RC]/.test(status) ? 2 : 1;
    const entry = fields.slice(i + 1, i + 1 + count);
    if (!/^[ACDMRTUX][0-9]*$/.test(status) || entry.length !== count) {
      throw new GitFailure(`unexpected git diff entry: ${JSON.stringify(status)}`);
    }
    for (const p of entry) paths.add(p);
    i += 1 + count;
  }
  return [...paths];
}

// The commits must already be in the local repository.
export function diffPaths(git: Git, baseTip: string, approvedSha: string): ChangedPaths {
  try {
    if (!FULL_SHA.test(approvedSha) || !FULL_SHA.test(baseTip)) {
      throw new GitFailure('approved head and base tip must be full SHAs');
    }
    const mergeBase = must(git, ['merge-base', baseTip, approvedSha]);
    if (!FULL_SHA.test(mergeBase)) throw new GitFailure(`unexpected merge base: ${mergeBase}`);
    const out = must(git, [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--name-status',
      '-z',
      '-M',
      mergeBase,
      approvedSha,
    ]);
    return { paths: parseNameStatus(out), error: null };
  } catch (err) {
    return { paths: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// Fetches the PR head and the base branch into a ref namespace private to this
// run, checks that the approved commit is present (a head that moved off it
// may leave it unfetched: refuse rather than diff something else), diffs, and
// deletes the refs again.
export function collectChangedPaths(
  git: Git,
  pr: number,
  baseBranch: string,
  approvedSha: string,
  baseTip: string,
): ChangedPaths {
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
    if (!FULL_SHA.test(approvedSha)) throw new GitFailure('approved head must be a full SHA');
    must(git, ['cat-file', '-e', `${approvedSha}^{commit}`]);
    return diffPaths(git, baseTip, approvedSha);
  } catch (err) {
    return { paths: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    for (const ref of refs) git(['update-ref', '-d', ref]);
  }
}
