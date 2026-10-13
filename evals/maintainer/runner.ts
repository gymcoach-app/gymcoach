import path from 'node:path';
import { agents, type AgentKind, type EvalTask, type Outcome, type TestRun } from './schema';

// Pure parts of the replay runner (run.ts does the I/O). Kept apart so the
// rules that decide an outcome are unit-tested without a snapshot or a database.

export interface RunArgs {
  task: string;
  agent: AgentKind;
  budgetUsd: number | null;
  out: string | null;
  keep: boolean;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[]): RunArgs {
  const args: RunArgs = { task: '', agent: 'dry', budgetUsd: null, out: null, keep: false };
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--keep') {
      args.keep = true;
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

// The paid agent stays disabled until issue #453 is closed: its container can
// reach the unauthenticated Docker Desktop API and other host services, its
// code is graded on the host, and the operator's model credential is readable
// inside it. evals/maintainer/probe-isolation.ts must pass first.
export const PAID_AGENT_DISABLED_REASON =
  '--agent claude is disabled until issue #453 is closed (container egress, ' +
  'container grading, credential exposure); probe-isolation.ts must pass first';

// A paid run needs both an explicit cap and an operator approval in the
// environment, so no loop can start one by passing a flag alone. Even with
// both, it is refused while PAID_AGENT_DISABLED_REASON applies.
export function claudeRunAllowed(
  args: Pick<RunArgs, 'agent' | 'budgetUsd'>,
  env: Record<string, string | undefined>,
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
  return { allowed: false, reason: PAID_AGENT_DISABLED_REASON };
}

// Static tamper check on the agent's changes to non-grade-input files. Grade
// inputs are restored to the base anyway (planGradeInputRestore), but
// application code can still sabotage the grader at run time, for example by
// importing chai from vitest and turning Assertion.prototype.assert into a no-op
// inside the module under test or a module the test setup imports. No
// application file of this repo imports a test framework, so any such import is
// rejected, as is any edit to the generated Prisma client.
const TEST_FRAMEWORK_IMPORT =
  /(?:\bfrom|\bimport|\brequire\s*\()\s*\(?\s*['"`](?:vitest|chai|@vitest\/[^'"`]*)(?:\/[^'"`]*)?['"`]/;

export function tamperViolations(
  changed: { file: string; content: string | null }[],
  task: Pick<EvalTask, 'grader'>,
): string[] {
  const out: string[] = [];
  for (const { file, content } of changed) {
    if (file.startsWith('prisma/generated/')) {
      out.push(`${file}: edits the generated Prisma client`);
      continue;
    }
    if (isGradeInput(file, task) || content === null) continue;
    if (TEST_FRAMEWORK_IMPORT.test(content)) {
      out.push(`${file}: application code imports a test framework (vitest, chai or @vitest/*)`);
    }
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
// under tests/ (helpers, integration setup). The agent may change application
// code only; these are put back to the base commit before grading, so editing a
// preserved test, a vitest setup file (for example a vi.mock of the module under
// test) or a config cannot turn a fail into a pass.
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

// What to put back before grading, given the base tree and the workspace (path
// to blob id; `null` when the file is absent from the workspace). Hidden tests
// are excluded: they are copied from the fix commit right after.
export function planGradeInputRestore(
  task: Pick<EvalTask, 'grader'>,
  base: ReadonlyMap<string, string>,
  work: ReadonlyMap<string, string | null>,
): { restore: string[]; remove: string[] } {
  const hidden = new Set(task.grader.hidden);
  // Paths stripped from the snapshot stay stripped.
  const excluded = (file: string) =>
    SNAPSHOT_EXCLUDES.some((e) => file === e || file.startsWith(`${e}/`));
  const restore: string[] = [];
  const remove: string[] = [];
  for (const [file, blob] of base) {
    if (!isGradeInput(file, task) || hidden.has(file) || excluded(file)) continue;
    if (work.get(file) !== blob) restore.push(file);
  }
  for (const [file, blob] of work) {
    if (blob === null || base.has(file) || hidden.has(file)) continue;
    if (isGradeInput(file, task)) remove.push(file);
  }
  return { restore: restore.sort(), remove: remove.sort() };
}

// The docker invocation for the paid agent. Only these paths enter the
// container: the task workspace (read-write), the installed node_modules and
// the claude binary (read-only), and a fresh HOME holding a copy of the model
// credential and the eval settings. Nothing else from the host: no repository,
// no ~/.config/gh, ~/.git-credentials, ~/.ssh or ~/.gitconfig, and no host
// environment (docker passes only the variables listed here).
export interface ContainerSpec {
  name: string;
  image: string;
  workspace: string;
  nodeModules: string;
  viteCacheInNodeModules: boolean;
  claudeBinary: string;
  home: string;
  uid: number;
  gid: number;
  command: string[];
}

export const CONTAINER_WORKDIR = '/work';
export const CONTAINER_HOME = '/home/eval';

export function containerArgs(spec: ContainerSpec): string[] {
  const args = [
    'run',
    '--rm',
    '--name',
    spec.name,
    '--user',
    `${spec.uid}:${spec.gid}`,
    '--read-only',
    '--tmpfs',
    '/tmp:rw,exec,size=1g',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '1024',
    '--memory',
    '6g',
    '-v',
    `${spec.workspace}:${CONTAINER_WORKDIR}:rw`,
    '-v',
    `${spec.nodeModules}:${CONTAINER_WORKDIR}/node_modules:ro`,
  ];
  // Vitest writes its cache under node_modules/.vite; a tmpfs over it keeps the
  // install read-only without breaking a test run.
  if (spec.viteCacheInNodeModules)
    args.push('--tmpfs', `${CONTAINER_WORKDIR}/node_modules/.vite:rw,size=256m`);
  args.push(
    '-v',
    `${spec.claudeBinary}:/usr/local/bin/claude:ro`,
    '-v',
    `${spec.home}:${CONTAINER_HOME}:rw`,
    '-e',
    `HOME=${CONTAINER_HOME}`,
    '-e',
    'DISABLE_AUTOUPDATER=1',
    '-e',
    'DISABLE_TELEMETRY=1',
    '-e',
    'GIT_TERMINAL_PROMPT=0',
    '-e',
    'CI=1',
    '-w',
    CONTAINER_WORKDIR,
    spec.image,
    ...spec.command,
  );
  return args;
}

// Eval settings for the paid agent: an explicit allow list for the tools a fix
// needs and a deny list for every publishing or fetching path, loaded as the
// only settings source (project settings are not loaded, and `.claude/` is not
// in the snapshot anyway).
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
