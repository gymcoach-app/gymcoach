import { readFileSync } from 'node:fs';
import { MAINTAINERS, REPO } from '@/automation/publish/checks';
import type { PullState } from '@/automation/publish/gate';
import { GhError, fetchPull, gh } from '@/automation/publish/merge';
import { formatReviewComment } from '@/automation/review/comment';
import { type StructuredReview, structuredReviewSchema } from '@/automation/review/schema';

// Posts a structured review record on a PR as the comment the merge gate reads
// (roadmap milestones 2 and 4).
//
//   npx tsx automation/review/record.ts <pr> --file review.json [--dry-run]
//
// It validates the record, refuses when its head or base SHA is not the PR's
// live head and base (the reviewer read something else), refuses when the gh
// account is not a maintainer (the gate would ignore the comment), and only
// then posts. Exit codes: 0 posted (or valid on --dry-run), 1 refused,
// 2 usage error, 3 gh or network error.

export class UsageError extends Error {}

export interface RecordArgs {
  pr: number;
  file: string;
  dryRun: boolean;
}

export function parseRecordArgs(argv: string[]): RecordArgs {
  const [prArg, ...rest] = argv;
  if (!prArg || !/^[1-9][0-9]*$/.test(prArg)) {
    throw new UsageError(`the first argument must be a PR number, got ${prArg ?? 'nothing'}`);
  }
  let file: string | undefined;
  let dryRun = false;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === '--file') {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--'))
        throw new UsageError('--file needs a path');
      if (file !== undefined) throw new UsageError('--file given twice');
      file = value;
      i += 1;
    } else if (arg === '--dry-run') {
      if (dryRun) throw new UsageError('--dry-run given twice');
      dryRun = true;
    } else {
      throw new UsageError(`unknown argument ${arg}`);
    }
  }
  if (!file) throw new UsageError('--file <review.json> is required');
  return { pr: Number(prArg), file, dryRun };
}

export type RecordRefusal =
  | 'invalid-record'
  | 'wrong-pr'
  | 'pr-not-open'
  | 'head-mismatch'
  | 'base-mismatch'
  | 'not-maintainer';

// Pure: whether a validated record may be posted on the live PR by `login`.
export function checkRecord(
  review: StructuredReview,
  pr: number,
  live: PullState,
  login: string,
  maintainers: readonly string[],
): { code: RecordRefusal; detail: string }[] {
  const refusals: { code: RecordRefusal; detail: string }[] = [];
  if (review.pr !== pr) {
    refusals.push({ code: 'wrong-pr', detail: `record is for PR #${review.pr}, not #${pr}` });
  }
  if (live.state !== 'open' || live.merged) {
    refusals.push({ code: 'pr-not-open', detail: `PR #${pr} is not open` });
  }
  if (review.headSha !== live.headSha) {
    refusals.push({
      code: 'head-mismatch',
      detail: `record head ${review.headSha}, live head ${live.headSha}`,
    });
  }
  if (review.baseSha !== live.baseSha) {
    refusals.push({
      code: 'base-mismatch',
      detail: `record base ${review.baseSha}, live base ${live.baseSha}`,
    });
  }
  if (!maintainers.includes(login)) {
    refusals.push({
      code: 'not-maintainer',
      detail: `gh is authenticated as ${login}; the gate only counts records from ${maintainers.join(', ')}`,
    });
  }
  return refusals;
}

function run(argv: string[]): number {
  const args = parseRecordArgs(argv);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(args.file, 'utf8'));
  } catch (err) {
    throw new UsageError(`cannot read ${args.file} as JSON: ${(err as Error).message}`);
  }
  const parsed = structuredReviewSchema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      console.error(`invalid-record: ${issue.path.join('.') || '(root)'} ${issue.message}`);
    }
    return 1;
  }
  const live = fetchPull(args.pr).pull;
  const login = gh<{ login: string }>(['user']).login;
  const refusals = checkRecord(parsed.data, args.pr, live, login, MAINTAINERS);
  for (const r of refusals) console.error(`${r.code}: ${r.detail}`);
  if (refusals.length) return 1;
  const body = formatReviewComment(parsed.data);
  if (args.dryRun) {
    console.log(body);
    console.log('Dry run: not posted.');
    return 0;
  }
  const posted = gh<{ id: number; html_url: string }>([
    '-X',
    'POST',
    `repos/${REPO}/issues/${args.pr}/comments`,
    '-f',
    `body=${body}`,
  ]);
  console.log(`Posted review record ${posted.id}: ${posted.html_url}`);
  return 0;
}

function main() {
  try {
    process.exit(run(process.argv.slice(2)));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Usage error: ${err.message}`);
      console.error('Usage: record.ts <pr> --file <review.json> [--dry-run]');
      process.exit(2);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${err instanceof GhError ? '' : 'Unexpected error: '}${message.split('\n')[0]}`);
    process.exit(3);
  }
}

if (process.argv[1]?.endsWith('record.ts')) main();
