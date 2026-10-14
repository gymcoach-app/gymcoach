import { describe, expect, it } from 'vitest';
import type { PullState } from './gate';
import { REPO } from './checks';
import {
  collectPages,
  fetchSettledPull,
  mergeRequestArgs,
  parseArgs,
  type RawPull,
  toIssueComment,
  toLivePull,
  UsageError,
} from './merge';

const SHA = 'c'.repeat(40);
const BASE = 'd'.repeat(40);

describe('merge CLI argument parsing', () => {
  it('parses a dry run and a full merge', () => {
    expect(parseArgs(['12', '--sha', SHA])).toMatchObject({
      pr: 12,
      sha: SHA,
      merge: false,
      method: 'squash',
      keepBranch: false,
    });
    expect(
      parseArgs(['12', '--sha', SHA, '--merge', '--method', 'merge', '--title', 'feat: x (#12)']),
    ).toMatchObject({ merge: true, method: 'merge', title: 'feat: x (#12)' });
  });

  it.each([
    [['abc', '--sha', SHA], 'PR number'],
    [['1e2', '--sha', SHA], 'PR number'],
    [['0', '--sha', SHA], 'PR number'],
    [['12'], '--sha'],
    [['12', '--sha', SHA, '--methd', 'merge'], 'unknown argument'],
    [['12', '--sha', SHA, '--dry-run'], 'unknown argument'],
    [['12', '--sha', SHA, '--title', '--merge'], 'needs a value'],
    [['12', '--sha'], 'needs a value'],
    [['12', '--sha', SHA, '--method', 'rebase'], '--method'],
    [['12', '--sha', SHA, '--sha', SHA], 'twice'],
    [['12', '--sha', SHA, '--merge', '--merge'], 'twice'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(UsageError);
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it('never turns a flag-looking title into a merge', () => {
    expect(() => parseArgs(['12', '--sha', SHA, '--title', '--merge'])).toThrow(UsageError);
  });
});

describe('merge request', () => {
  it('always carries the approved SHA', () => {
    const args = parseArgs(['7', '--sha', SHA, '--merge', '--message', 'Closes #3']);
    const request = mergeRequestArgs(args, SHA);
    expect(request.slice(0, 3)).toEqual(['-X', 'PUT', 'repos/gymcoach-app/gymcoach/pulls/7/merge']);
    expect(request).toContain(`sha=${SHA}`);
    expect(request).toContain('merge_method=squash');
    expect(request).toContain('commit_message=Closes #3');
  });
});

describe('mergeable state polling', () => {
  const pull = (mergeableState: string | null): PullState => ({
    number: 7,
    state: 'open',
    merged: false,
    draft: false,
    baseRef: 'main',
    baseSha: BASE,
    headSha: SHA,
    mergeableState,
  });

  it('re-reads while GitHub is still computing, then stops at a settled state', async () => {
    const states = [null, 'unknown', 'clean', 'dirty'];
    let reads = 0;
    const live = await fetchSettledPull(
      7,
      () => ({ pull: pull(states[reads++] ?? null), sameRepoBranch: null }),
      { tries: 5, delayMs: 0 },
    );
    expect(live.pull.mergeableState).toBe('clean');
    expect(reads).toBe(3);
  });

  it('gives up after the bounded number of reads and leaves the refusal to the gate', async () => {
    let reads = 0;
    const live = await fetchSettledPull(
      7,
      () => {
        reads += 1;
        return { pull: pull('unknown'), sameRepoBranch: null };
      },
      { tries: 4, delayMs: 0 },
    );
    expect(live.pull.mergeableState).toBe('unknown');
    expect(reads).toBe(4);
  });
});

describe('head branch deletion eligibility', () => {
  const raw = (repo: { full_name: string } | null): RawPull => ({
    number: 7,
    state: 'open',
    merged: false,
    draft: false,
    base: { ref: 'main', sha: BASE },
    head: { sha: SHA, ref: 'feat/thing', repo },
    mergeable_state: 'clean',
  });

  it('allows deleting the head branch of a same-repo PR', () => {
    expect(toLivePull(raw({ full_name: REPO })).sameRepoBranch).toBe('feat/thing');
  });

  it('never deletes for a fork, even with the same ref name as a local branch', () => {
    expect(toLivePull(raw({ full_name: 'someone/gymcoach' })).sameRepoBranch).toBeNull();
  });

  it('never deletes when the fork was deleted (head.repo null)', () => {
    expect(toLivePull(raw(null)).sameRepoBranch).toBeNull();
  });

  it('maps the pull state fields', () => {
    expect(toLivePull(raw({ full_name: REPO })).pull).toEqual({
      number: 7,
      state: 'open',
      merged: false,
      draft: false,
      baseRef: 'main',
      baseSha: BASE,
      headSha: SHA,
      mergeableState: 'clean',
    });
  });
});

describe('comment pagination', () => {
  const pages = (sizes: number[]) => (page: number) =>
    Array.from({ length: sizes[page - 1] ?? 0 }, (_, i) => `${page}-${i}`);

  it('stops at the first short page', () => {
    const seen: number[] = [];
    const items = collectPages((page) => {
      seen.push(page);
      return pages([3, 3, 1])(page);
    }, 3);
    expect(items).toHaveLength(7);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('reads one more (empty) page when the last full page is exactly full', () => {
    const seen: number[] = [];
    expect(
      collectPages((page) => {
        seen.push(page);
        return pages([3, 3])(page);
      }, 3),
    ).toHaveLength(6);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('maps the author id and timestamps a review comment needs', () => {
    expect(
      toIssueComment({
        id: 5,
        user: { login: 'JulienAu', id: 16043912 },
        body: null,
        created_at: 'a',
        updated_at: 'b',
      }),
    ).toEqual({
      id: 5,
      author: 'JulienAu',
      authorId: 16043912,
      body: '',
      createdAt: 'a',
      updatedAt: 'b',
    });
    expect(
      toIssueComment({ id: 6, user: null, body: 'x', created_at: 'a', updated_at: 'a' }).authorId,
    ).toBeNull();
  });
});
