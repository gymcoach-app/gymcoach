import { execFileSync } from 'node:child_process';
import { BASE_BRANCH, REPO, REQUIRED_CHECKS } from '@/automation/publish/checks';
import {
  type CheckRun,
  type GateDecision,
  type PullState,
  type RequiredCheck,
  evaluateMergeGate,
} from '@/automation/publish/gate';

// Pinned merge for every PR, loop-authored or external (roadmap milestone 2).
// Fetches the live PR, its check runs for the approved SHA and the repository's
// required checks, runs the gate, and only then calls the merge endpoint with
// `sha=<approved>`, so GitHub itself also refuses if the head moved.
//
//   npx tsx automation/publish/merge.ts <pr> --sha <approved-40-hex>        # dry run
//   npx tsx automation/publish/merge.ts <pr> --sha <sha> --merge \
//     [--method squash|merge] [--title "..."] [--message "..."]
//
// Without --merge it only prints the decision. Exit code: 0 mergeable (or
// merged), 1 refused or failed, 2 usage error. gh runs through execFile with an
// argument array (no shell) and the caller's gh authentication.

interface Args {
  pr: number;
  sha: string;
  merge: boolean;
  method: 'squash' | 'merge';
  title?: string;
  message?: string;
}

function parseArgs(argv: string[]): Args {
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pr = Number(argv[0]);
  const sha = value('sha');
  const method = value('method') ?? 'squash';
  if (!Number.isInteger(pr) || pr <= 0 || !sha || (method !== 'squash' && method !== 'merge')) {
    console.error(
      'Usage: merge.ts <pr> --sha <approved-sha> [--merge] [--method squash|merge] [--title ...] [--message ...]',
    );
    process.exit(2);
  }
  return {
    pr,
    sha,
    merge: argv.includes('--merge'),
    method,
    title: value('title'),
    message: value('message'),
  };
}

function gh<T>(args: string[]): T {
  const out = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(out) as T;
}

interface RawPull {
  number: number;
  state: string;
  merged: boolean;
  draft: boolean;
  base: { ref: string };
  head: { sha: string };
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
  }[];
}

interface RawRule {
  type: string;
  parameters?: { required_status_checks?: { context: string; integration_id?: number }[] };
}

export function fetchPull(pr: number): PullState {
  const raw = gh<RawPull>([`repos/${REPO}/pulls/${pr}`]);
  return {
    number: raw.number,
    state: raw.state,
    merged: raw.merged,
    draft: raw.draft,
    baseRef: raw.base.ref,
    headSha: raw.head.sha,
    mergeableState: raw.mergeable_state,
  };
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
      });
    }
    if (raw.check_runs.length < 100) return runs;
  }
}

// The required status checks that rulesets apply to the base branch, or null
// when they cannot be read (the decision then reports the allowlist alone).
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

function print(decision: GateDecision) {
  console.log(JSON.stringify(decision, null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pull = fetchPull(args.pr);
  const decision = evaluateMergeGate({
    pull,
    approvedSha: args.sha,
    // Fetch by the approved SHA: a moved head is refused by the gate, and the
    // checks that count are the ones on the commit that was reviewed.
    checkRuns: /^[0-9a-f]{40}$/.test(args.sha) ? fetchCheckRuns(args.sha) : [],
    allowlist: REQUIRED_CHECKS,
    requiredChecks: fetchRequiredChecks(),
    baseBranch: BASE_BRANCH,
  });
  print(decision);
  if (!decision.mergeable) process.exit(1);
  if (!args.merge) {
    console.log('Dry run: pass --merge to merge.');
    return;
  }
  const fields = ['-f', `sha=${decision.sha}`, '-f', `merge_method=${args.method}`];
  if (args.title) fields.push('-f', `commit_title=${args.title}`);
  if (args.message) fields.push('-f', `commit_message=${args.message}`);
  const result = gh<{ merged: boolean; sha: string; message: string }>([
    '-X',
    'PUT',
    `repos/${REPO}/pulls/${args.pr}/merge`,
    ...fields,
  ]);
  console.log(JSON.stringify(result));
  if (!result.merged) process.exit(1);
}

if (process.argv[1]?.endsWith('merge.ts')) main();
