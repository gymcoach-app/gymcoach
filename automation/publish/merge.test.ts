import { describe, expect, it } from 'vitest';
import type { PullState } from './gate';
import { fetchSettledPull, mergeRequestArgs, parseArgs, UsageError } from './merge';

const SHA = 'c'.repeat(40);

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
