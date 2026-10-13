import { createHash } from 'node:crypto';
import path from 'node:path';
import { agents, type AgentKind, type EvalTask, type Outcome, type TestRun } from './schema';

// Pure parts of the replay runner (run.ts does the I/O). Kept apart so the
// rules that decide an outcome are unit-tested without a snapshot, a container
// or a database.

export interface RunArgs {
  task: string;
  agent: AgentKind;
  budgetUsd: number | null;
  out: string | null;
  keep: boolean;
  acceptCredentialRisk: boolean;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[]): RunArgs {
  const args: RunArgs = {
    task: '',
    agent: 'dry',
    budgetUsd: null,
    out: null,
    keep: false,
    acceptCredentialRisk: false,
  };
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--keep' || flag === '--i-accept-credential-risk') {
      if (seen.has(flag)) throw new UsageError(`${flag} given twice`);
      seen.add(flag);
      if (flag === '--keep') args.keep = true;
      else args.acceptCredentialRisk = true;
      continue;
    }
    if (!['--task', '--agent', '--budget-usd', '--out'].includes(flag)) {
      throw new UsageError(`unknown argument ${flag}`);
    }
    if (seen.has(flag)) throw new UsageError(`${flag} given twice`);
    seen.add(flag);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--'))
      throw new UsageError(`${flag} needs a value`);
    if (flag === '--task') args.task = value;
    if (flag === '--agent') {
      if (!(agents as readonly string[]).includes(value)) {
        throw new UsageError(`--agent must be one of ${agents.join(', ')}`);
      }
      args.agent = value as AgentKind;
    }
    if (flag === '--budget-usd') {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0)
        throw new UsageError('--budget-usd must be a positive number');
      args.budgetUsd = n;
    }
    if (flag === '--out') args.out = value;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(args.task)) throw new UsageError('--task <id> is required');
  return args;
}

// The paid agent is hard-disabled by this constant. The containment it needed
// (issue #453: egress limited to the model API, grading in containers, tamper
// hardening, credential handling) is in place and proven by probe-isolation.ts;
// what remains is the operator's decision. Only the operator flips it, in a
// reviewed PR, after accepting the credential risk described in
// evals/maintainer/README.md and setting a budget.
export const PAID_AGENT_ENABLED = false;

export const PAID_AGENT_DISABLED_REASON =
  '--agent claude is disabled: PAID_AGENT_ENABLED in evals/maintainer/runner.ts is false. ' +
  'The operator enables it in a reviewed PR after accepting the credential risk ' +
  '(evals/maintainer/README.md) and setting a budget';

// A paid run needs an explicit cap, an operator approval in the environment and
// an explicit acknowledgement of the credential risk, so no loop can start one
// by passing a flag alone; and even then it is refused while PAID_AGENT_ENABLED
// is false. `enabled` exists for tests only.
export function claudeRunAllowed(
  args: Pick<RunArgs, 'agent' | 'budgetUsd' | 'acceptCredentialRisk'>,
  env: Record<string, string | undefined>,
  enabled: boolean = PAID_AGENT_ENABLED,
): { allowed: true } | { allowed: false; reason: string } {
  if (args.agent !== 'claude') return { allowed: true };
  if (args.budgetUsd === null)
    return { allowed: false, reason: '--agent claude needs --budget-usd' };
  if (env.EVAL_BUDGET_APPROVED !== '1') {
    return {
      allowed: false,
      reason: '--agent claude needs EVAL_BUDGET_APPROVED=1 set by the operator',
    };
  }
  if (!args.acceptCredentialRisk) {
    return {
      allowed: false,
      reason:
        '--agent claude needs --i-accept-credential-risk (the agent can read the copy of ' +
        'the Claude credential it runs with; see evals/maintainer/README.md)',
    };
  }
  if (!enabled) return { allowed: false, reason: PAID_AGENT_DISABLED_REASON };
  return { allowed: true };
}

// Git blob id of a file's bytes, computed in-process: after the agent ran, no
// git command is run inside its workspace (a planted .git/config or
// .gitattributes could make git execute a program: core.fsmonitor, filters).
export function gitBlobId(content: Buffer): string {
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

// One entry of a workspace walk: a regular file with its blob id, or any other
// kind (symlink, socket, device) with no content hash.
export interface TreeEntry {
  kind: 'file' | 'symlink' | 'other';
  blob: string | null;
}

// Top-level paths a tree walk skips: the install (mounted read-only in every
// container, absent from the host workspace) and the snapshot's own history.
export const WALK_SKIP = new Set(['node_modules', '.git']);

export interface Change {
  file: string;
  // added, modified or deleted relative to the snapshot taken before the agent.
  status: 'added' | 'modified' | 'deleted';
  kind: TreeEntry['kind'] | null;
}

// What the agent changed: every path whose kind or blob differs between the
// walk before and the walk after, including git-ignored paths (the walk is not
// git, so nothing is hidden from it).
export function diffTrees(
  before: ReadonlyMap<string, TreeEntry>,
  after: ReadonlyMap<string, TreeEntry>,
): Change[] {
  const out: Change[] = [];
  for (const [file, entry] of after) {
    const old = before.get(file);
    if (!old) out.push({ file, status: 'added', kind: entry.kind });
    else if (old.kind !== entry.kind || old.blob !== entry.blob)
      out.push({ file, status: 'modified', kind: entry.kind });
  }
  for (const file of before.keys())
    if (!after.has(file)) out.push({ file, status: 'deleted', kind: null });
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

// The lines of `after` that are not in `before` (as a multiset): what the agent
// added to a file. The static tamper check inspects only these, so a pattern
// already present in the base never blames the agent, and a new occurrence of
// one always does.
export function addedLines(before: string, after: string): string {
  const pool = new Map<string, number>();
  for (const line of before.split('\n')) pool.set(line, (pool.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of after.split('\n')) {
    const left = pool.get(line) ?? 0;
    if (left > 0) pool.set(line, left - 1);
    else added.push(line);
  }
  return added.join('\n');
}

// Static tamper check on the agent's changes. Grade inputs are never taken from
// the agent (planGrade), but application code still runs inside the test
// process at grading time and could sabotage it, for example by disabling
// chai's assert from the module under test or a module the test setup imports.
// No application file of this repo needs any of the patterns below, so a
// changed non-test file that contains one fails the run (fail closed: a false
// positive costs a re-review of the task, a false negative a wrong score).
const TAMPER_RULES: { why: string; pattern: RegExp }[] = [
  {
    why: 'imports a test framework (vitest, chai or @vitest/*)',
    pattern:
      /(?:\bfrom|\bimport|\brequire\s*\()\s*\(?\s*['"`](?:vitest|chai|@vitest\/[^'"`]*)(?:\/[^'"`]*)?['"`]/,
  },
  {
    why: 'loads a module by a non-literal or aliased require',
    // `require` anywhere except a direct call with one plain string literal.
    pattern: /\brequire\b(?!\s*\(\s*(['"])[^'"`$\\]*\1\s*\))/,
  },
  {
    why: 'loads a module by a non-literal dynamic import',
    pattern: /\bimport\s*\(\s*(?!(['"])[^'"`$\\]*\1\s*\))/,
  },
  {
    why: 'reaches the module system directly (createRequire, module internals, vm, eval)',
    pattern:
      /\bcreateRequire\b|\bgetBuiltinModule\b|\bmodule\s*\.\s*require\b|\bModule\s*\.\s*_load\b|\bprocess\s*\.\s*(?:mainModule|binding|dlopen)\b|['"`](?:node:)?(?:module|vm)['"`]|\beval\s*\(|\bnew\s+Function\s*\(/,
  },
  {
    why: 'names a path inside node_modules',
    pattern: /['"`][^'"`\n]*node_modules[^'"`\n]*['"`]/,
  },
  {
    why: 'touches test framework internals (matcher state, vitest globals)',
    pattern: /jest-matchers|__vitest|\bSymbol\s*\.\s*for\s*\(\s*['"`][^'"`]*(?:jest|vitest|chai)/,
  },
  {
    why: 'reassigns a built-in or a global',
    pattern:
      /\b(?:Object|Array|Function|Promise|String|Number|Boolean|JSON|Math|Reflect|Symbol|Error|Map|Set|RegExp|Date|globalThis|global)\s*\.\s*(?:prototype\s*\.\s*)?[A-Za-z_$][\w$]*\s*=(?!=)|\bObject\s*\.\s*(?:defineProperty|defineProperties|setPrototypeOf|assign)\s*\(\s*(?:Object|Array|Function|Promise|JSON|Math|Reflect|globalThis|global|process)\b/,
  },
  {
    why: 'hooks the process exit or its output streams',
    pattern:
      /\bprocess\s*\.\s*(?:on|once|prependListener|addListener)\s*\(\s*['"`](?:exit|beforeExit)['"`]|\bprocess\s*\.\s*(?:exit|exitCode|reallyExit|stdout|stderr)\s*=(?!=)|\bprocess\s*\.\s*(?:stdout|stderr)\s*\.\s*write\s*=(?!=)/,
  },
];

export function tamperViolations(
  changed: (Change & { content: string | null })[],
  task: Pick<EvalTask, 'grader'>,
): string[] {
  const out: string[] = [];
  for (const { file, kind, content, status } of changed) {
    if (file.startsWith('prisma/generated/')) {
      out.push(`${file}: edits the generated Prisma client`);
      continue;
    }
    if (status !== 'deleted' && kind !== 'file') {
      out.push(`${file}: the agent created a ${kind} (only regular files are accepted)`);
      continue;
    }
    if (isGradeInput(file, task) || content === null) continue;
    for (const rule of TAMPER_RULES)
      if (rule.pattern.test(content)) out.push(`${file}: application code ${rule.why}`);
  }
  return out;
}

// Results go outside the repository so a replay can never commit or publish them
// by accident, and so the agent's workspace cannot read earlier results.
export function assertOutsideRepo(out: string, repoRoot: string): void {
  const rel = path.relative(path.resolve(repoRoot), path.resolve(out));
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new UsageError(`--out must be outside the repository (${out})`);
  }
}

export function tierOf(file: string): 'unit' | 'integration' {
  return file.startsWith('tests/integration/') ? 'integration' : 'unit';
}

export function groupByTier(files: string[]): { tier: 'unit' | 'integration'; files: string[] }[] {
  const groups: { tier: 'unit' | 'integration'; files: string[] }[] = [];
  for (const tier of ['unit', 'integration'] as const) {
    const inTier = files.filter((f) => tierOf(f) === tier);
    if (inTier.length) groups.push({ tier, files: inTier });
  }
  return groups;
}

// Vitest's JSON reporter output, reduced to the counts the outcome needs. An
// unreadable or missing report yields nulls: that is an infrastructure error.
export function summariseVitestReport(raw: string | null): {
  passed: number | null;
  failed: number | null;
  failedSuites: number | null;
} {
  if (raw === null) return { passed: null, failed: null, failedSuites: null };
  try {
    const report = JSON.parse(raw) as Record<string, unknown>;
    const num = (k: string) => (typeof report[k] === 'number' ? (report[k] as number) : null);
    return {
      passed: num('numPassedTests'),
      failed: num('numFailedTests'),
      failedSuites: num('numFailedTestSuites'),
    };
  } catch {
    return { passed: null, failed: null, failedSuites: null };
  }
}

// A run passes only with a report of at least one passing test, no failure, and
// a zero exit: vitest exits non-zero on an unhandled error even when every
// counted test passed.
function runPassed(run: TestRun): boolean {
  return (
    run.exitCode === 0 &&
    run.passed !== null &&
    run.passed > 0 &&
    run.failed === 0 &&
    run.failedSuites === 0
  );
}

function runUnreadable(run: TestRun): boolean {
  return run.passed === null || run.failed === null || run.failedSuites === null;
}

// pass only when every hidden and preserved run produced a report with no
// failure; an infrastructure error wins over both, so it is never counted as a
// pass or silently as a fail.
export function decideOutcome(input: {
  hidden: TestRun[];
  preserved: TestRun[];
  infraErrors: string[];
  tamperViolations?: string[];
}): Outcome {
  const runs = [...input.hidden, ...input.preserved];
  if (input.infraErrors.length > 0 || input.hidden.length === 0) return 'infra-error';
  // A tamper violation is the agent's doing: a fail whatever the tests report.
  if ((input.tamperViolations ?? []).length > 0) return 'fail';
  if (runs.some(runUnreadable)) return 'infra-error';
  return runs.every(runPassed) ? 'pass' : 'fail';
}

// Two dependency sets are the same when the lockfile packages match, ignoring
// the root package's own version (bumped by releases, not a dependency).
export function sameDependencies(baseLock: string, currentLock: string): boolean {
  const strip = (raw: string) => {
    const lock = JSON.parse(raw) as { packages?: Record<string, unknown> };
    const packages = { ...(lock.packages ?? {}) };
    delete packages[''];
    return JSON.stringify(packages);
  };
  return strip(baseLock) === strip(currentLock);
}

// Paths removed from a materialised snapshot: the eval suite itself (graders and
// broken variants would reveal the answer if a future base contains them), and
// `.claude/` (project settings that would widen the agent's permissions, hooks,
// and skills that tell an agent to open PRs and merge).
export const SNAPSHOT_EXCLUDES = ['evals', '.claude'] as const;

// Files the grade depends on besides the hidden tests: test runner configs and
// setup files, package and TypeScript configs, every test file and everything
// under tests/ (helpers, integration setup). The grading tree takes them from
// the base, never from the agent, so editing a preserved test, a vitest setup
// file (for example a vi.mock of the module under test) or a config cannot turn
// a fail into a pass.
const GRADE_CONFIG_FILES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.setup.ts',
]);

export function isGradeInput(file: string, task: Pick<EvalTask, 'grader'>): boolean {
  if (task.grader.hidden.includes(file) || task.grader.preserved.includes(file)) return true;
  if (GRADE_CONFIG_FILES.has(file)) return true;
  if (/^vitest\.[^/]+$/.test(file)) return true;
  if (file.startsWith('tests/')) return true;
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

// How the grading tree is built from the agent's changes. Grading never runs in
// the agent's workspace: it runs in a copy of the untouched snapshot onto which
// only the agent's regular application files are written (or deleted). Grade
// inputs stay at the base whatever the agent did (`ignored` lists the ones it
// touched), and anything that is not a regular file is never copied.
export function planGrade(
  changes: Change[],
  task: Pick<EvalTask, 'grader'>,
): { write: string[]; remove: string[]; ignored: string[] } {
  const write: string[] = [];
  const remove: string[] = [];
  const ignored: string[] = [];
  const stripped = (file: string) =>
    SNAPSHOT_EXCLUDES.some((e) => file === e || file.startsWith(`${e}/`));
  for (const change of changes) {
    if (isGradeInput(change.file, task) || stripped(change.file)) {
      ignored.push(change.file);
      continue;
    }
    // The generated client is regenerated from the graded schema.
    if (change.file.startsWith('prisma/generated/')) continue;
    if (change.status === 'deleted') remove.push(change.file);
    else if (change.kind === 'file') write.push(change.file);
  }
  return { write, remove, ignored };
}

// Container images, pinned by digest: the same bytes on every run, whatever a
// registry later serves under the tag.
export const NODE_IMAGE =
  'node@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d';
export const POSTGRES_IMAGE =
  'postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';

// The only host the contained agent may reach, through the egress proxy: the
// Anthropic API. No-model-call CLI commands (--version, --help) contact no host
// at all (checked through the proxy's log); a real call needs only this one with
// non-essential traffic disabled. The OAuth token refresh host is deliberately
// not allowlisted, so a refresh inside the container fails instead of rotating
// the operator's login.
export const EGRESS_ALLOWLIST = ['api.anthropic.com'] as const;
export const EGRESS_PROXY_PORT = 3128;

export const CONTAINER_WORKDIR = '/work';
export const CONTAINER_HOME = '/home/eval';

export interface Mount {
  host: string;
  target: string;
  readOnly: boolean;
}

// One hardened docker run: non-root, read-only root filesystem, no capability,
// no privilege escalation, bounded pids and memory, and only the listed mounts
// and environment variables (docker passes nothing else from the host).
export interface ContainerSpec {
  name: string;
  image: string;
  // 'none' (no network at all) or the name of an --internal network.
  network: string;
  mounts: Mount[];
  tmpfs: string[];
  env: Record<string, string>;
  uid: number;
  gid: number;
  workdir: string;
  command: string[];
}

export function containerArgs(spec: ContainerSpec): string[] {
  const args = [
    'run',
    '--rm',
    '--name',
    spec.name,
    '--network',
    spec.network,
    '--user',
    `${spec.uid}:${spec.gid}`,
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '1024',
    '--memory',
    '6g',
  ];
  for (const t of spec.tmpfs) args.push('--tmpfs', t);
  for (const m of spec.mounts) args.push('-v', `${m.host}:${m.target}:${m.readOnly ? 'ro' : 'rw'}`);
  for (const [k, v] of Object.entries(spec.env)) args.push('-e', `${k}=${v}`);
  args.push('-w', spec.workdir, spec.image, ...spec.command);
  return args;
}

// Environment of the contained agent: only these variables. The proxy is the
// container's only way out; the CLI's non-essential traffic (telemetry, error
// reporting, update checks) is disabled.
export function agentEnv(proxyHost: string): Record<string, string> {
  const proxy = `http://${proxyHost}:${EGRESS_PROXY_PORT}`;
  return {
    HOME: CONTAINER_HOME,
    HTTPS_PROXY: proxy,
    HTTP_PROXY: proxy,
    NO_PROXY: '',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    GIT_TERMINAL_PROMPT: '0',
    CI: '1',
  };
}

// Environment of a grading container: no proxy, no credential, offline npm, and
// for the integration tier one vitest worker (a worker cap above 1 overrides the
// integration config's fileParallelism: false, lesson L33).
export function gradeEnv(databaseUrl: string | null): Record<string, string> {
  const env: Record<string, string> = {
    HOME: '/tmp/home',
    CI: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    npm_config_offline: 'true',
  };
  if (databaseUrl) {
    env.DATABASE_URL = databaseUrl;
    env.VITEST_MAX_WORKERS = '1';
    env.VITEST_MAX_THREADS = '1';
  }
  return env;
}

// Eval settings for the paid agent, loaded as its only settings source. They
// are a convenience, not a security control: Write plus a test command already
// lets the agent run arbitrary code. The containment is the container, its
// --internal network and the egress proxy.
export function evalSettings(): Record<string, unknown> {
  return {
    permissions: {
      allow: [
        'Read',
        'Edit',
        'Write',
        'Glob',
        'Grep',
        'Bash(npx vitest:*)',
        'Bash(npm run test:*)',
        'Bash(git diff:*)',
        'Bash(git status:*)',
      ],
      deny: [
        'WebFetch',
        'WebSearch',
        'Bash(git push:*)',
        'Bash(git remote:*)',
        'Bash(gh:*)',
        'Bash(curl:*)',
        'Bash(wget:*)',
      ],
    },
    hooks: {},
  };
}
