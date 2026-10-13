import { describe, expect, it } from 'vitest';
import {
  type IssueComment,
  REVIEW_MARKER,
  formatReviewComment,
  parseReviewComments,
} from './comment';
import { type StructuredReview, structuredReviewSchema } from './schema';

const MAINTAINERS = ['JulienAu', 'Julien-Au'];

function review(over: Partial<StructuredReview> = {}): StructuredReview {
  return {
    schemaVersion: 1,
    pr: 7,
    baseSha: 'b'.repeat(40),
    headSha: 'a'.repeat(40),
    reviewer: { kind: 'agent', model: 'claude-opus-5-5' },
    lenses: ['correctness', 'security'],
    filesInspected: ['lib/a.ts'],
    filesNotReadInFull: [],
    findings: [{ severity: 'minor', file: 'lib/a.ts', line: 4, claim: 'naming' }],
    verdict: 'ready',
    createdAt: '2026-10-13T12:00:00Z',
    ...over,
  };
}

function comment(id: number, body: string, author: string | null = 'JulienAu'): IssueComment {
  return { id, author, body };
}

describe('structured review schema', () => {
  it('accepts a complete record', () => {
    expect(structuredReviewSchema.safeParse(review()).success).toBe(true);
  });

  it('rejects a ready verdict with a blocking or major finding', () => {
    for (const severity of ['blocking', 'major'] as const) {
      const bad = review({ findings: [{ severity, file: null, line: null, claim: 'x' }] });
      expect(structuredReviewSchema.safeParse(bad).success).toBe(false);
    }
    const needsChanges = review({
      verdict: 'needs-changes',
      findings: [{ severity: 'blocking', file: null, line: null, claim: 'x' }],
    });
    expect(structuredReviewSchema.safeParse(needsChanges).success).toBe(true);
  });

  it('rejects short or uppercase SHAs, unknown fields and an empty lens list', () => {
    expect(structuredReviewSchema.safeParse(review({ headSha: 'a'.repeat(12) })).success).toBe(
      false,
    );
    expect(structuredReviewSchema.safeParse(review({ baseSha: 'B'.repeat(40) })).success).toBe(
      false,
    );
    expect(structuredReviewSchema.safeParse({ ...review(), extra: 1 }).success).toBe(false);
    expect(structuredReviewSchema.safeParse(review({ lenses: [] })).success).toBe(false);
  });
});

describe('review comments', () => {
  it('round-trips a record through the posted comment', () => {
    const body = formatReviewComment(review());
    expect(body).toContain(REVIEW_MARKER);
    const parsed = parseReviewComments([comment(1, body)], 7, MAINTAINERS);
    expect(parsed.invalid).toEqual([]);
    expect(parsed.records).toEqual([{ commentId: 1, author: 'JulienAu', review: review() }]);
  });

  it('ignores a record posted by anyone but a maintainer', () => {
    const body = formatReviewComment(review());
    const parsed = parseReviewComments(
      [comment(1, body, 'someone'), comment(2, body, null)],
      7,
      MAINTAINERS,
    );
    expect(parsed).toEqual({ records: [], invalid: [] });
  });

  it('skips maintainer comments without the marker', () => {
    const parsed = parseReviewComments([comment(1, 'Thanks, merged.')], 7, MAINTAINERS);
    expect(parsed).toEqual({ records: [], invalid: [] });
  });

  it('reports malformed maintainer records instead of counting them', () => {
    const noFence = `${REVIEW_MARKER}\nno json here`;
    const badJson = `${REVIEW_MARKER}\n\`\`\`json\n{ not json\n\`\`\``;
    const badSchema = `${REVIEW_MARKER}\n\`\`\`json\n${JSON.stringify({ ...review(), verdict: 'maybe' })}\n\`\`\``;
    const twoMarkers = `${formatReviewComment(review())}\n${REVIEW_MARKER}`;
    const otherPr = formatReviewComment(review({ pr: 8 }));
    const parsed = parseReviewComments(
      [
        comment(1, noFence),
        comment(2, badJson),
        comment(3, badSchema),
        comment(4, twoMarkers),
        comment(5, otherPr),
      ],
      7,
      MAINTAINERS,
    );
    expect(parsed.records).toEqual([]);
    expect(parsed.invalid.map((i) => i.commentId)).toEqual([1, 2, 3, 4, 5]);
    expect(parsed.invalid[4]!.reason).toContain('PR #8');
  });

  it('only reads the fenced block after the marker', () => {
    // A json block quoted before the marker (e.g. an example) is not the record.
    const decoy = `\`\`\`json\n${JSON.stringify(review({ verdict: 'needs-changes' }))}\n\`\`\`\n`;
    const parsed = parseReviewComments(
      [comment(1, decoy + formatReviewComment(review()))],
      7,
      MAINTAINERS,
    );
    expect(parsed.records[0]!.review.verdict).toBe('ready');
  });

  it('returns records oldest first whatever the input order', () => {
    const a = formatReviewComment(review({ verdict: 'ready' }));
    const b = formatReviewComment(review({ verdict: 'needs-changes', findings: [] }));
    const parsed = parseReviewComments([comment(20, b), comment(10, a)], 7, MAINTAINERS);
    expect(parsed.records.map((r) => r.commentId)).toEqual([10, 20]);
  });

  it('tolerates CRLF line endings in a posted comment', () => {
    const body = formatReviewComment(review()).replace(/\n/g, '\r\n');
    expect(parseReviewComments([comment(1, body)], 7, MAINTAINERS).records).toHaveLength(1);
  });
});
