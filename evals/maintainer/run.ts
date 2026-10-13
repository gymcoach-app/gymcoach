import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import {
  EVAL_SCHEMA_VERSION,
  evalResultSchema,
  evalTaskSchema,
  type EvalResult,
  type EvalTask,
  type TestRun,
} from './schema';
import {
  CONTAINER_HOME,
  SNAPSHOT_EXCLUDES,
  UsageError,
  assertOutsideRepo,
  claudeRunAllowed,
  containerArgs,
  decideOutcome,
  evalSettings,
  groupByTier,
  isGradeInput,
  parseArgs,
  planGradeInputRestore,
  sameDependencies,
  summariseVitestReport,
  type RunArgs,
} from './runner';

// Replay one maintainer task from a frozen snapshot (roadmap milestone 3):
//
//   npx tsx evals/maintainer/run.ts --task <id> --agent dry|reference|broken|claude
//       [--budget-usd N] [--out <dir outside the repo>] [--keep]
//
// dry: the agent does nothing (the grader must fail: red before).
// reference: applies the real fix (base..fix diff of the task's source paths).
// broken: applies the task's intentionally incomplete fix (must be rejected).
// tamper: the broken fix plus an attempt to cheat the grader (must be rejected).
// claude: runs `claude -p` inside a container that sees only the snapshot;
// refused unless --budget-usd is given and the operator set
// EVAL_BUDGET_APPROVED=1.
//
// The snapshot is a `git archive` of the base commit in a temp dir with a fresh
// one-commit history and no remote: no later commit, lesson or PR text exists in
// it, and nothing in it can push to the real repository. Before grading, every
// grade input (tests, test helpers, runner and package configs) is put back to
// the base. Exit codes: 0 pass, 1 fail, 3 infra-error, 2 usage.

const TASKS_DIR = path.join(__dirname, 'tasks');
export const AGENT_IMAGE = 'node:22-bookworm';
// The model credential on this machine (Claude Code's OAuth login). A copy goes
// into the container's fresh HOME; nothing else from the host HOME does.
const CLAUDE_CREDENTIAL = path.join(homedir(), '.claude', '.credentials.json');
const EVAL_DB_USER = 'gymcoach_test';
const TEST_DB_CONTAINER = 'gymcoach-test-db';

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; input?: Buffer | string; env?: NodeJS.ProcessEnv } = {},
) {
  return execFileSync(cmd, args, {
    cwd: opts.cwd,
    input: opts.input,
    env: opts.env ?? process.env,
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function firstLine(err: unknown): string {
  const e = err as { stderr?: Buffer; message?: string };
  const text = (e.stderr?.toString() || e.message || String(err)).trim();
  return text.split('\n').slice(-3).join(' | ').slice(0, 400);
}

function loadTask(id: string): EvalTask {
  const file = path.join(TASKS_DIR, id, 'task.json');
  if (!existsSync(file)) throw new UsageError(`no task ${id} (${file})`);
  const task = evalTaskSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (task.id !== id)
    throw new UsageError(`task.json id ${task.id} does not match directory ${id}`);
  return task;
}

function materialise(repoRoot: string, task: EvalTask, work: string): boolean | null {
  const tar = sh('git', ['-C', repoRoot, 'archive', '--format=tar', task.snapshot.baseSha]);
  sh('tar', ['-x', '-C', work], { input: tar });
  for (const excluded of SNAPSHOT_EXCLUDES)
    rmSync(path.join(work, excluded), { recursive: true, force: true });
  // Dependencies: reuse the installed tree only when the base pins the same
  // packages; otherwise the result would not describe the base.
  const baseLock = sh('git', [
    '-C',
    repoRoot,
    'show',
    `${task.snapshot.baseSha}:package-lock.json`,
  ]).toString();
  const currentLock = readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8');
  const same = sameDependencies(baseLock, currentLock);
  if (same) symlinkSync(path.join(repoRoot, 'node_modules'), path.join(work, 'node_modules'));
  // A fresh history: one commit, no remote, so the agent can diff its own work
  // but cannot reach later commits or push anywhere.
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'eval',
    GIT_AUTHOR_EMAIL: 'eval@localhost',
    GIT_COMMITTER_NAME: 'eval',
    GIT_COMMITTER_EMAIL: 'eval@localhost',
  };
  sh('git', ['init', '-q', '-b', 'main'], { cwd: work });
  sh('git', ['add', '-A'], { cwd: work });
  sh('git', ['commit', '-q', '-m', 'snapshot'], { cwd: work, env: gitEnv });
  return same;
}

function runAgent(
  args: RunArgs,
  task: EvalTask,
  repoRoot: string,
  work: string,
): EvalResult['agentRun'] {
  const none = { exitCode: null, costUsd: null, turns: null, note: null };
  if (args.agent === 'dry') return { ...none, note: 'no change (red-before check)' };
  if (args.agent === 'reference') {
    const diff = sh('git', [
      '-C',
      repoRoot,
      'diff',
      task.snapshot.baseSha,
      task.snapshot.fixSha,
      '--',
      ...task.reference.paths,
    ]);
    if (diff.length === 0) throw new Error('reference diff is empty');
    sh('git', ['apply', '--whitespace=nowarn', '-'], { cwd: work, input: diff });
    return {
      ...none,
      exitCode: 0,
      note: `applied base..fix diff of ${task.reference.paths.join(', ')}`,
    };
  }
  if (args.agent === 'broken') {
    const patch = path.join(TASKS_DIR, task.id, 'broken.patch');
    sh('git', ['apply', '--whitespace=nowarn', patch], { cwd: work });
    return { ...none, exitCode: 0, note: 'applied the intentionally incomplete fix' };
  }
  if (args.agent === 'tamper') return tamper(task, repoRoot, work);
  return runClaudeContained(args, task, repoRoot, work);
}

// Harness self-check: the broken fix, then two cheats a grader must resist. A
// vi.mock in the test setup files swaps the module under test for a copy of the
// fixed code, and every preserved test is replaced by one that always passes.
function tamper(task: EvalTask, repoRoot: string, work: string): EvalResult['agentRun'] {
  sh('git', ['apply', '--whitespace=nowarn', path.join(TASKS_DIR, task.id, 'broken.patch')], {
    cwd: work,
  });
  const mocks: string[] = [];
  for (const source of task.reference.paths) {
    const ext = path.extname(source);
    const stem = source.slice(0, -ext.length);
    const copy = `${stem}.tamper${ext}`;
    writeFileSync(
      path.join(work, copy),
      sh('git', ['-C', repoRoot, 'show', `${task.snapshot.fixSha}:${source}`]),
    );
    mocks.push(`vi.mock('@/${stem}', () => import('@/${stem}.tamper'));`);
  }
  const cheat = `\nimport { vi as tamperVi } from 'vitest';\n${mocks
    .join('\n')
    .replace(/vi\.mock/g, 'tamperVi.mock')}\n`;
  for (const setup of ['vitest.setup.ts', 'tests/integration/setup.ts']) {
    const file = path.join(work, setup);
    if (existsSync(file)) writeFileSync(file, readFileSync(file, 'utf8') + cheat);
  }
  for (const preserved of task.grader.preserved) {
    writeFileSync(
      path.join(work, preserved),
      "import { it } from 'vitest';\nit('always passes', () => {});\n",
    );
  }
  return {
    exitCode: 0,
    costUsd: null,
    turns: null,
    note: 'broken fix + vi.mock of the fixed module in setup + preserved tests weakened',
  };
}

// The paid agent runs in a container (containerArgs): the workspace is its only
// writable host path, node_modules and the claude binary are read-only, HOME is
// a fresh directory holding a copy of the model credential and the eval
// settings, and no host environment variable is passed. The snapshot has no
// remote and no .claude/ directory.
export function prepareAgentHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), 'gymcoach-eval-home-'));
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  if (existsSync(CLAUDE_CREDENTIAL)) {
    const copy = path.join(home, '.claude', '.credentials.json');
    copyFileSync(CLAUDE_CREDENTIAL, copy);
    chmodSync(copy, 0o600);
  }
  writeFileSync(
    path.join(home, '.claude', 'settings.json'),
    `${JSON.stringify(evalSettings(), null, 2)}\n`,
  );
  return home;
}

export function agentContainerSpec(
  repoRoot: string,
  work: string,
  home: string,
  command: string[],
) {
  const nodeModules = realpathSync(path.join(repoRoot, 'node_modules'));
  return {
    name: `gymcoach-eval-${randomBytes(4).toString('hex')}`,
    image: AGENT_IMAGE,
    workspace: work,
    nodeModules,
    viteCacheInNodeModules: existsSync(path.join(nodeModules, '.vite')),
    claudeBinary: realpathSync(sh('which', ['claude']).toString().trim()),
    home,
    uid: process.getuid ? process.getuid() : 1000,
    gid: process.getgid ? process.getgid() : 1000,
    command,
  };
}

// The workspace's node_modules is a symlink to the host install for grading on
// the host. Inside the container the install is mounted read-only at the same
// place instead, so the symlink is swapped for an empty mount point meanwhile.
export function withContainerMountPoint<T>(work: string, fn: () => T): T {
  const link = path.join(work, 'node_modules');
  const target = lstatSync(link).isSymbolicLink() ? realpathSync(link) : null;
  if (target) {
    unlinkSync(link);
    mkdirSync(link);
  }
  try {
    return fn();
  } finally {
    if (target) {
      rmSync(link, { recursive: true, force: true });
      symlinkSync(target, link);
    }
  }
}

function runClaudeContained(
  args: RunArgs,
  task: EvalTask,
  repoRoot: string,
  work: string,
): EvalResult['agentRun'] {
  const home = prepareAgentHome();
  const settings = `${CONTAINER_HOME}/.claude/settings.json`;
  const spec = agentContainerSpec(repoRoot, work, home, [
    'claude',
    '-p',
    task.statement,
    '--output-format',
    'json',
    '--max-budget-usd',
    String(args.budgetUsd),
    '--no-session-persistence',
    '--setting-sources',
    'user',
    '--settings',
    settings,
    '--strict-mcp-config',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    'Read Edit Write Glob Grep Bash(npx vitest:*) Bash(npm run test:*) Bash(git diff:*) Bash(git status:*)',
    '--disallowedTools',
    'WebFetch WebSearch',
  ]);
  try {
    const run = withContainerMountPoint(work, () =>
      spawnSync('docker', containerArgs(spec), {
        encoding: 'utf8',
        timeout: task.budget.maxWallSeconds * 1000,
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
    let costUsd: number | null = null;
    let turns: number | null = null;
    try {
      const out = JSON.parse(run.stdout) as { total_cost_usd?: number; num_turns?: number };
      costUsd = typeof out.total_cost_usd === 'number' ? out.total_cost_usd : null;
      turns = typeof out.num_turns === 'number' ? out.num_turns : null;
    } catch {
      // Invalid model output stays visible as an unknown cost and turn count.
    }
    return {
      exitCode: run.status,
      costUsd,
      turns,
      note: run.error ? `claude did not finish: ${run.error.message}` : null,
    };
  } finally {
    // A timeout kills only the docker client; removing the container stops
    // every process the agent started inside it.
    spawnSync('docker', ['rm', '-f', spec.name], { stdio: 'ignore' });
    rmSync(home, { recursive: true, force: true });
  }
}

// Workspace files that count as grade inputs, with their blob ids (null when a
// base file is missing from the workspace). Skips node_modules and .git.
function listFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isDirectory()) out.push(...listFiles(dir, child));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

function restoreGradeInputs(repoRoot: string, task: EvalTask, work: string): string[] {
  const base = new Map<string, string>();
  const tree = sh('git', ['-C', repoRoot, 'ls-tree', '-r', '-z', task.snapshot.baseSha])
    .toString()
    .split('\0')
    .filter(Boolean);
  for (const line of tree) {
    const [meta, file] = line.split('\t') as [string, string];
    const [, type, blob] = meta.split(' ') as [string, string, string];
    if (type === 'blob' && isGradeInput(file, task)) base.set(file, blob);
  }
  const candidates = new Set([...base.keys()]);
  for (const file of listFiles(work)) if (isGradeInput(file, task)) candidates.add(file);
  const present = [...candidates].filter((f) => existsSync(path.join(work, f)));
  const hashes = present.length
    ? sh('git', ['hash-object', '--stdin-paths'], { cwd: work, input: present.join('\n') })
        .toString()
        .trim()
        .split('\n')
    : [];
  const workMap = new Map<string, string | null>();
  for (const file of candidates) workMap.set(file, null);
  present.forEach((file, i) => workMap.set(file, hashes[i]!));
  const plan = planGradeInputRestore(task, base, workMap);
  for (const file of plan.remove) rmSync(path.join(work, file), { force: true });
  if (plan.restore.length) {
    const tar = sh('git', [
      '-C',
      repoRoot,
      'archive',
      '--format=tar',
      task.snapshot.baseSha,
      '--',
      ...plan.restore,
    ]);
    sh('tar', ['-x', '-C', work], { input: tar });
  }
  return [...plan.restore, ...plan.remove].sort();
}

function copyHidden(repoRoot: string, task: EvalTask, work: string) {
  for (const file of task.grader.hidden) {
    const content = sh('git', ['-C', repoRoot, 'show', `${task.snapshot.fixSha}:${file}`]);
    mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
    writeFileSync(path.join(work, file), content);
  }
}

// The integration tier gets its own throwaway database on the shared test
// Postgres, migrated to the base schema, so a replay never touches the
// database verify.sh uses and the schema matches the snapshot.
// The name is chosen and handed to the caller before anything is created, so the
// caller's finally drops the database even when the migration fails.
function evalDatabaseName(): string {
  return `gymcoach_eval_${randomBytes(4).toString('hex')}`;
}

function prepareEvalDatabase(repoRoot: string, work: string, name: string): void {
  const lock = path.join(process.env.TMPDIR || '/tmp', 'gymcoach-test-infra.lock');
  sh('flock', ['--wait', '600', lock, 'bash', 'scripts/test-db.sh'], { cwd: repoRoot });
  sh('docker', [
    'exec',
    TEST_DB_CONTAINER,
    'psql',
    '-U',
    EVAL_DB_USER,
    '-d',
    'gymcoach_test',
    '-c',
    `CREATE DATABASE ${name}`,
  ]);
  const url = `postgresql://${EVAL_DB_USER}:${EVAL_DB_USER}@localhost:5434/${name}`;
  sh('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: work,
    env: { ...process.env, DATABASE_URL: url },
  });
}

function dropEvalDatabase(name: string) {
  try {
    sh('docker', [
      'exec',
      TEST_DB_CONTAINER,
      'psql',
      '-U',
      EVAL_DB_USER,
      '-d',
      'gymcoach_test',
      '-c',
      `DROP DATABASE IF EXISTS ${name}`,
    ]);
  } catch {
    // Best effort; the name is unique and the data lives on tmpfs.
  }
}

function runTests(
  work: string,
  reportsDir: string,
  label: string,
  group: { tier: 'unit' | 'integration'; files: string[] },
  dbName: string | null,
): TestRun {
  const report = path.join(reportsDir, `${label}-${group.tier}.json`);
  const vitest = [
    'vitest',
    'run',
    '--config',
    group.tier === 'unit' ? 'vitest.config.ts' : 'vitest.integration.config.ts',
    '--reporter=json',
    `--outputFile=${report}`,
    ...group.files,
  ];
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.VITEST_MAX_WORKERS;
  // The unit tier runs with no network at all (a fresh network namespace). The
  // integration tier needs the local test Postgres, so it keeps the host network.
  const [cmd, cmdArgs] =
    group.tier === 'unit' ? ['unshare', ['-rn', 'npx', ...vitest]] : ['npx', vitest];
  if (group.tier === 'integration' && dbName) {
    env.DATABASE_URL = `postgresql://${EVAL_DB_USER}:${EVAL_DB_USER}@localhost:5434/${dbName}`;
  }
  const run = spawnSync(cmd, cmdArgs, {
    cwd: work,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const raw = existsSync(report) ? readFileSync(report, 'utf8') : null;
  return {
    tier: group.tier,
    files: group.files,
    exitCode: run.status,
    ...summariseVitestReport(raw),
  };
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const task = loadTask(args.task);
  const gate = claudeRunAllowed(args, process.env);
  if (!gate.allowed) throw new UsageError(gate.reason);

  const repoRoot = sh('git', ['rev-parse', '--show-toplevel'], { cwd: __dirname })
    .toString()
    .trim();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out =
    args.out ?? path.join(tmpdir(), 'gymcoach-evals', `${stamp}-${task.id}-${args.agent}`);
  assertOutsideRepo(out, repoRoot);
  mkdirSync(out, { recursive: true });

  const startedAt = new Date().toISOString();
  const infraErrors: string[] = [];
  const durations: EvalResult['durationsMs'] = { materialise: null, agent: null, grade: null };
  let agentRun: EvalResult['agentRun'] = { exitCode: null, costUsd: null, turns: null, note: null };
  let depsMatch: boolean | null = null;
  const hidden: TestRun[] = [];
  const preserved: TestRun[] = [];
  const work = mkdtempSync(path.join(tmpdir(), 'gymcoach-eval-ws-'));
  let dbName: string | null = null;
  let gradeInputsRestored: string[] = [];

  try {
    let t = Date.now();
    depsMatch = materialise(repoRoot, task, work);
    if (!depsMatch) throw new Error('the base pins different dependencies than the installed tree');
    const generateEnv = { ...process.env };
    delete generateEnv.DATABASE_URL;
    sh('npx', ['prisma', 'generate'], { cwd: work, env: generateEnv });
    durations.materialise = Date.now() - t;

    t = Date.now();
    agentRun = runAgent(args, task, repoRoot, work);
    durations.agent = Date.now() - t;
  } catch (err) {
    infraErrors.push(`setup: ${firstLine(err)}`);
  }

  if (infraErrors.length === 0) {
    const t = Date.now();
    try {
      gradeInputsRestored = restoreGradeInputs(repoRoot, task, work);
      copyHidden(repoRoot, task, work);
      const all = [...task.grader.hidden, ...task.grader.preserved];
      if (all.some((f) => f.startsWith('tests/integration/'))) {
        dbName = evalDatabaseName();
        prepareEvalDatabase(repoRoot, work, dbName);
      }
      for (const group of groupByTier(task.grader.hidden))
        hidden.push(runTests(work, out, 'hidden', group, dbName));
      for (const group of groupByTier(task.grader.preserved))
        preserved.push(runTests(work, out, 'preserved', group, dbName));
    } catch (err) {
      infraErrors.push(`grade: ${firstLine(err)}`);
    } finally {
      if (dbName) dropEvalDatabase(dbName);
    }
    durations.grade = Date.now() - t;
  }

  const result: EvalResult = evalResultSchema.parse({
    schemaVersion: EVAL_SCHEMA_VERSION,
    taskId: task.id,
    split: task.split,
    agent: args.agent,
    baseSha: task.snapshot.baseSha,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationsMs: durations,
    outcome: decideOutcome({ hidden, preserved, infraErrors }),
    hidden,
    preserved,
    infraErrors,
    gradeInputsRestored,
    agentRun,
    environment: {
      node: process.version,
      dependenciesMatchBase: depsMatch,
      // The self-checks run no agent; the contained agent keeps the network
      // (the model API needs it).
      networkBlockedForAgent: args.agent === 'claude' ? false : null,
      agentContained: args.agent === 'claude' ? true : null,
      networkBlockedForGrader: !hidden.concat(preserved).some((r) => r.tier === 'integration'),
    },
  });
  writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (args.keep) console.log(`workspace kept: ${work}`);
  else rmSync(work, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      task: result.taskId,
      agent: result.agent,
      outcome: result.outcome,
      hidden: result.hidden.map(
        (r) => `${r.tier} ${r.passed ?? '?'} passed / ${r.failed ?? '?'} failed`,
      ),
      preserved: result.preserved.map(
        (r) => `${r.tier} ${r.passed ?? '?'} passed / ${r.failed ?? '?'} failed`,
      ),
      infraErrors: result.infraErrors,
      gradeInputsRestored: result.gradeInputsRestored,
      result: path.join(out, 'result.json'),
    }),
  );
  return result.outcome === 'pass' ? 0 : result.outcome === 'fail' ? 1 : 3;
}

if (require.main === module)
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      if (err instanceof UsageError) {
        console.error(`usage: ${err.message}`);
        process.exit(2);
      }
      console.error(`error: ${firstLine(err)}`);
      process.exit(3);
    },
  );
