import type { Maintainer } from '@/automation/publish/checks';
import {
  STOPPING_SEVERITIES,
  type StructuredReview,
  structuredReviewSchema,
} from '@/automation/review/schema';

// How a structured review travels: a PR comment holding a short human summary,
// the marker below, and the record as one fenced JSON block. Parsing is strict
// and only trusts comments authored by a maintainer account: anyone can post a
// comment that looks like a review, so the author, not the content, decides
// whether it counts.

export const REVIEW_MARKER = '<!-- gymcoach-review v1 -->';

export function formatReviewComment(review: StructuredReview): string {
  const counts = ['blocking', 'major', 'minor', 'nit']
    .map((s) => [s, review.findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`);
  const lines = [
    `**Review record: ${review.verdict}** (head \`${review.headSha.slice(0, 12)}\`, base \`${review.baseSha.slice(0, 12)}\`)`,
    '',
    `Lenses: ${review.lenses.join(', ')}. Findings: ${counts.length ? counts.join(', ') : 'none'}.` +
      (review.filesNotReadInFull.length
        ? ` Not read in full: ${review.filesNotReadInFull.length} file(s).`
        : ''),
    '',
    'Machine-readable record for the merge gate (`automation/review/`):',
    '',
    REVIEW_MARKER,
    '```json',
    JSON.stringify(review, null, 2),
    '```',
  ];
  return lines.join('\n');
}

export interface IssueComment {
  id: number;
  author: string | null;
  // GitHub's numeric user id of the author; null for a deleted user.
  authorId: number | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewEvidence {
  commentId: number;
  author: string;
  review: StructuredReview;
}

export interface ParsedReviews {
  // Valid records, in comment order (oldest first).
  records: ReviewEvidence[];
  // Maintainer comments carrying the marker that did not parse, with why.
  invalid: { commentId: number; reason: string }[];
}

const FENCE = /```json\n([\s\S]*?)\n```/;

// Reads the review records out of a PR's comments. A comment counts only when
// its author is a maintainer (by numeric user id), it was never edited, it
// carries exactly one marker, and the fenced JSON right after the marker
// validates against the schema for this PR. An edited comment is refused
// rather than ranked: an edit would change a record in place while keeping the
// position it earned when first posted; post a new record instead.
export function parseReviewComments(
  comments: IssueComment[],
  pr: number,
  maintainers: readonly Maintainer[],
): ParsedReviews {
  const records: ReviewEvidence[] = [];
  const invalid: ParsedReviews['invalid'] = [];
  const ordered = [...comments].sort((a, b) => a.id - b.id);
  for (const comment of ordered) {
    const maintainer = maintainers.find((m) => m.id === comment.authorId);
    if (!maintainer) continue;
    const parts = comment.body.split(REVIEW_MARKER);
    if (parts.length === 1) continue;
    if (comment.updatedAt !== comment.createdAt) {
      invalid.push({ commentId: comment.id, reason: 'the comment was edited after posting' });
      continue;
    }
    if (parts.length > 2) {
      invalid.push({ commentId: comment.id, reason: 'more than one review marker' });
      continue;
    }
    const fenced = FENCE.exec(parts[1]!.replace(/\r\n/g, '\n'));
    if (!fenced) {
      invalid.push({ commentId: comment.id, reason: 'no fenced json block after the marker' });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(fenced[1]!);
    } catch {
      invalid.push({ commentId: comment.id, reason: 'the json block does not parse' });
      continue;
    }
    const parsed = structuredReviewSchema.safeParse(json);
    if (!parsed.success) {
      invalid.push({
        commentId: comment.id,
        reason: `schema: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`,
      });
      continue;
    }
    if (parsed.data.pr !== pr) {
      invalid.push({
        commentId: comment.id,
        reason: `record is for PR #${parsed.data.pr}, not #${pr}`,
      });
      continue;
    }
    records.push({ commentId: comment.id, author: maintainer.login, review: parsed.data });
  }
  return { records, invalid };
}

export function stoppingFindings(review: StructuredReview) {
  return review.findings.filter((f) => STOPPING_SEVERITIES.includes(f.severity));
}
