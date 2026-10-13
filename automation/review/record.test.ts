import { describe, expect, it } from 'vitest';
import type { PullState } from '../publish/gate';
import { UsageError, checkRecord, parseRecordArgs } from './record';
import type { StructuredReview } from './schema';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const MAINTAINERS = [{ login: 'JulienAu', id: 16043912 }];
const ME = { login: 'JulienAu', id: 16043912 };

const live: PullState = {
  number: 7,
  state: 'open',
  merged: false,
  draft: false,
  baseRef: 'main',
  baseSha: BASE,
  headSha: HEAD,
  mergeableState: 'clean',
};

const review: StructuredReview = {
  schemaVersion: 1,
  pr: 7,
  baseSha: BASE,
  headSha: HEAD,
  reviewer: { kind: 'agent', model: 'claude-opus-5-5' },
  lenses: ['correctness'],
  filesInspected: ['lib/a.ts'],
  filesNotReadInFull: [],
  findings: [],
  verdict: 'ready',
  createdAt: '2026-10-13T12:00:00Z',
};

describe('record CLI', () => {
  it('parses its arguments strictly', () => {
    expect(parseRecordArgs(['7', '--file', 'r.json'])).toEqual({
      pr: 7,
      file: 'r.json',
      dryRun: false,
    });
    expect(parseRecordArgs(['7', '--dry-run', '--file', 'r.json']).dryRun).toBe(true);
    for (const bad of [
      [],
      ['x', '--file', 'r.json'],
      ['7'],
      ['7', '--file'],
      ['7', '--file', '--dry-run'],
      ['7', '--file', 'a', '--file', 'b'],
      ['7', '--file', 'a', '--post'],
    ]) {
      expect(() => parseRecordArgs(bad)).toThrow(UsageError);
    }
  });

  it('posts a record that matches the live head and base', () => {
    expect(checkRecord(review, 7, live, ME, MAINTAINERS)).toEqual([]);
  });

  it('refuses a record for another head, another base or another PR', () => {
    const codes = (r: StructuredReview, pr = 7) =>
      checkRecord(r, pr, live, ME, MAINTAINERS).map((x) => x.code);
    expect(codes({ ...review, headSha: 'c'.repeat(40) })).toEqual(['head-mismatch']);
    expect(codes({ ...review, baseSha: 'c'.repeat(40) })).toEqual(['base-mismatch']);
    expect(codes(review, 8)).toEqual(['wrong-pr']);
  });

  it('refuses a closed PR and a non-maintainer gh account', () => {
    expect(
      checkRecord(review, 7, { ...live, state: 'closed' }, ME, MAINTAINERS).map((x) => x.code),
    ).toEqual(['pr-not-open']);
    expect(
      checkRecord(review, 7, live, { login: 'someone', id: 999 }, MAINTAINERS).map((x) => x.code),
    ).toEqual(['not-maintainer']);
  });
});
