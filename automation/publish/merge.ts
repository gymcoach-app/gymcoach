import { execFileSync } from 'node:child_process';
import {
  BASE_BRANCH,
  CI_APP_ID,
  MAINTAINERS,
  REPO,
  REQUIRED_CHECKS,
} from '@/automation/publish/checks';
import {
  type CheckRun,
  FULL_SHA,
  type GateDecision,
  type PullState,
  type RequiredCheck,
  evaluateMergeGate,
} from '@/automation/publish/gate';
import {
  type IssueComment,
  type ParsedReviews,
  parseReviewComments,
} from '@/automation/review/comment';

// Pinned merge for every PR, loop-authored or external (roadmap milestone 2).
// Fetches the live PR, its check runs for the approved SHA, the repository's
// required checks and the review records posted on the PR, runs the gate, and only then calls the merge endpoint with
// `sha=<approved>`, so GitHub itself also refuses if the head moved.
//
//   npx tsx automation/publish/merge.ts <pr> --sha <approved-40-hex>        # dry run
//   npx tsx automation/publish/merge.ts <pr> --sha <sha> --merge \
//     [--method squash|merge] [--title "..."] [--message "..."] [--keep-branch]
//
// Without --merge it only prints the decision. After a merge it deletes the
// head branch when it lives in this repository (never a fork's), unless
// --keep-branch. Exit codes: 0 mergeable (or merged), 1 refused, 2 usage error,
// 3 gh or network error (the state is unknown: check the PR before retrying).
// gh runs through execFile with an argument array (no shell) and the caller's
// gh authentication. Run it from a tree of freshly fetched origin/main, never
// from the candidate's checkout (see the ship-pr skill, step 5).

export interface Args {
  pr: number;
  sha: string;
  merge: boolean;
  method: 'squash' | 'merge';
  keepBranch: boolean;
  title?: string;
  message?: string;
}

export class UsageError extends Error {}

const VALUE_FLAGS = new Set(['--sha', '--method', '--title', '--message']);
const BOOLEAN_FLAGS = new Set(['--merge', '--keep-branch']);

// Strict: the PR number comes first, every flag is known, a value flag takes
// the next argument and that value may not look like a flag, and no flag
// repeats. Anything else is a usage error rather than a silent default.
export function parseArgs(argv: string[]): Args {
  const [prArg, ...rest] = argv;
  if (!prArg || !/^[1-9][0-9]*$/.test(prArg)) {
    throw new UsageError(`the first argument must be a PR number, got ${prArg ?? 'nothing'}`);
  }
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (VALUE_FLAGS.has(arg)) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`${arg} needs a value`);
      }
      if (values.has(arg)) throw new UsageError(`${arg} given twice`);
      values.set(arg, value);
      i += 1;
    } else if (BOOLEAN_FLAGS.has(arg)) {
      if (flags.has(arg)) throw new UsageError(`${arg} given twice`);
      flags.add(arg);
    } else {
      throw new UsageError(`unknown argument ${arg}`);
    }
  }
  const sha = values.get('--sha');
  if (!sha) throw new UsageError('--sha <approved-sha> is required');
  const method = values.get('--method') ?? 'squash';
  if (method !== 'squash' && method !== 'merge') {
    throw new UsageError(`--method must be squash or merge, got ${method}`);
  }
  return {
    pr: Number(prArg),
    sha,
    merge: flags.has('--merge'),
    method,
    keepBranch: flags.has('--keep-branch'),
    title: values.get('--title'),
    message: values.get('--message'),
  };
}

export class GhError extends Error {}

// `input`, when given, is sent on stdin (use with `--input -`), so a large
// request body never travels as one argv element (MAX_ARG_STRLEN).
export function gh<T>(args: string[], input?: string): T {
  let out: string;
  try {
    out = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      ...(input === undefined
        ? { stdio: ['ignore', 'pipe', 'pipe'] as const }
        : { input, stdio: ['pipe', 'pipe', 'pipe'] as const }),
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    const first = stderr.split('\n').find((line) => line.trim()) ?? 'gh failed';
    throw new GhError(`gh api ${args.filter((a) => !a.startsWith('-')).join(' ')}: ${first}`);
  }
  return (out.trim() ? JSON.parse(out) : {}) as T;
}

export interface RawPull {
  number: number;
  state: string;
  merged: boolean;
  draft: boolean;
  base: { ref: string; sha: string };
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  mergeable_state: string | null;
}

interface RawCheckRuns {
  total_count: number;
  check_runs: {
    id: number;
    name: string;
    head_sha: string;
    status: string;
    conclusion: string | null;
    app: { id: number } | null;
    check_suite: { id: number } | null;
  }[];
}

interface RawRule {
  type: string;
  parameters?: { required_status_checks?: { context: string; integration_id?: number }[] };
}

export interface LivePull {
  pull: PullState;
  // The head branch, when it lives in this repository (null for a fork).
  sameRepoBranch: string | null;
}

export function fetchPull(pr: number): LivePull {
  return toLivePull(gh<RawPull>([`repos/${REPO}/pulls/${pr}`]));
}

// Pure mapping of the pulls API payload. The head branch is only deletable when
// its repository is this one: a fork (even with the same ref name) or a deleted
// fork (head.repo null) never qualifies.
export function toLivePull(raw: RawPull): LivePull {
  return {
    pull: {
      number: raw.number,
      state: raw.state,
      merged: raw.merged,
      draft: raw.draft,
      baseRef: raw.base.ref,
      baseSha: raw.base.sha,
      headSha: raw.head.sha,
      mergeableState: raw.mergeable_state,
    },
    sameRepoBranch: raw.head.repo?.full_name === REPO ? raw.head.ref : null,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// GitHub reports mergeable_state null or unknown while it computes it, usually
// on the first read after a push or a base move. Re-read a bounded number of
// times; a state still unknown after that is left to the gate, which refuses.
export async function fetchSettledPull(
  pr: number,
  read: (pr: number) => LivePull = fetchPull,
  { tries = 5, delayMs = 3000 }: { tries?: number; delayMs?: number } = {},
): Promise<LivePull> {
  let live = read(pr);
  for (let i = 1; i < tries; i += 1) {
    const state = live.pull.mergeableState;
    if (state != null && state !== 'unknown') return live;
    await sleep(delayMs);
    live = read(pr);
  }
  return live;
}

export function fetchCheckRuns(sha: string): CheckRun[] {
  const runs: CheckRun[] = [];
  for (let page = 1; ; page += 1) {
    const raw = gh<RawCheckRuns>([
      `repos/${REPO}/commits/${sha}/check-runs?filter=all&per_page=100&page=${page}`,
    ]);
    for (const r of raw.check_runs) {
      runs.push({
        id: r.id,
        name: r.name,
        headSha: r.head_sha,
        status: r.status,
        conclusion: r.conclusion,
        appId: r.app?.id ?? null,
        suiteId: r.check_suite?.id ?? null,
      });
    }
    if (raw.check_runs.length < 100) return runs;
  }
}

// The required status checks that rulesets apply to the base branch, or null
// when they cannot be read (the decision then rests on the allowlist and the
// pinned CI app, and says so).
export function fetchRequiredChecks(): RequiredCheck[] | null {
  try {
    const rules = gh<RawRule[]>([`repos/${REPO}/rules/branches/${BASE_BRANCH}`]);
    const checks = rules
      .filter((r) => r.type === 'required_status_checks')
      .flatMap((r) => r.parameters?.required_status_checks ?? []);
    return checks.map((c) => ({ context: c.context, integrationId: c.integration_id ?? null }));
  } catch {
    return null;
  }
}

export interface RawComment {
  id: number;
  user: { login: string; id: number } | null;
  body: string | null;
  created_at: string;
  updated_at: string;
}

export const PAGE_SIZE = 100;

// Pure: reads pages until one comes back short (fewer than pageSize items),
// which GitHub's REST pagination uses as the last page.
export function collectPages<T>(fetchPage: (page: number) => T[], pageSize = PAGE_SIZE): T[] {
  const all: T[] = [];
  for (let page = 1; ; page += 1) {
    const items = fetchPage(page);
    all.push(...items);
    if (items.length < pageSize) return all;
  }
}

export function toIssueComment(c: RawComment): IssueComment {
  return {
    id: c.id,
    author: c.user?.login ?? null,
    authorId: c.user?.id ?? null,
    body: c.body ?? '',
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

export function fetchIssueComments(pr: number): IssueComment[] {
  return collectPages((page) =>
    gh<RawComment[]>([`repos/${REPO}/issues/${pr}/comments?per_page=${PAGE_SIZE}&page=${page}`]),
  ).map(toIssueComment);
}

function print(decision: GateDecision, reviews: ParsedReviews) {
  console.log(JSON.stringify(decision, null, 2));
  // A maintainer comment with the marker that did not parse is worth seeing:
  // it is ignored by the gate, which may be why a review seems missing.
  for (const bad of reviews.invalid) {
    console.log(`Ignored review comment ${bad.commentId}: ${bad.reason}`);
  }
}

// The merge call always carries the approved SHA: GitHub refuses the merge if
// the head moved after the gate read it.
export function mergeRequestArgs(args: Args, sha: string): string[] {
  const fields = ['-f', `sha=${sha}`, '-f', `merge_method=${args.method}`];
  if (args.title) fields.push('-f', `commit_title=${args.title}`);
  if (args.message) fields.push('-f', `commit_message=${args.message}`);
  return ['-X', 'PUT', `repos/${REPO}/pulls/${args.pr}/merge`, ...fields];
}

async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const live = await fetchSettledPull(args.pr);
  const reviews = parseReviewComments(fetchIssueComments(args.pr), args.pr, MAINTAINERS);
  const decision = evaluateMergeGate({
    pull: live.pull,
    approvedSha: args.sha,
    // Fetch by the approved SHA: a moved head is refused by the gate, and the
    // checks that count are the ones on the commit that was reviewed.
    checkRuns: FULL_SHA.test(args.sha) ? fetchCheckRuns(args.sha) : [],
    allowlist: REQUIRED_CHECKS,
    requiredChecks: fetchRequiredChecks(),
    ciAppId: CI_APP_ID,
    baseBranch: BASE_BRANCH,
    reviews: reviews.records,
  });
  print(decision, reviews);
  if (!decision.mergeable) return 1;
  if (!args.merge) {
    console.log('Dry run: pass --merge to merge.');
    return 0;
  }
  const result = gh<{ merged: boolean; sha: string; message: string }>(
    mergeRequestArgs(args, decision.sha),
  );
  console.log(JSON.stringify(result));
  if (!result.merged) return 1;
  if (live.sameRepoBranch && !args.keepBranch) {
    // Never a fork's branch. A failure here leaves the merge in place.
    try {
      gh([
        '-X',
        'DELETE',
        `repos/${REPO}/git/refs/heads/${encodeURIComponent(live.sameRepoBranch)}`,
      ]);
      console.log(`Deleted branch ${live.sameRepoBranch}.`);
    } catch (err) {
      console.error(
        `Merged, but could not delete ${live.sameRepoBranch}: ${(err as Error).message}`,
      );
    }
  }
  return 0;
}

async function main() {
  try {
    process.exit(await run(process.argv.slice(2)));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Usage error: ${err.message}`);
      console.error(
        'Usage: merge.ts <pr> --sha <approved-sha> [--merge] [--method squash|merge] [--title ...] [--message ...] [--keep-branch]',
      );
      process.exit(2);
    }
    if (err instanceof GhError) {
      console.error(`${err.message}\nThe PR state is unknown: check it before any retry.`);
      process.exit(3);
    }
    // Anything else (an unexpected payload, a parse failure) is not a refusal:
    // exit 3 with one line, never a stack trace read as exit 1.
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `Unexpected error: ${message.split('\n')[0]}\nThe PR state is unknown: check it before any retry.`,
    );
    process.exit(3);
  }
}

if (process.argv[1]?.endsWith('merge.ts')) void main();
