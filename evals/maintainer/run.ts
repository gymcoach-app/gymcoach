import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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
  SNAPSHOT_EXCLUDES,
  UsageError,
  assertOutsideRepo,
  claudeRunAllowed,
  decideOutcome,
  groupByTier,
  parseArgs,
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
// claude: runs `claude -p` in the snapshot; refused unless --budget-usd is given
// and the operator set EVAL_BUDGET_APPROVED=1.
//
// The snapshot is a `git archive` of the base commit in a temp dir with a fresh
// one-commit history and no remote: no later commit, lesson or PR text exists in
// it, and nothing in it can push to the real repository. Exit codes: 0 pass,
// 1 fail, 3 infra-error, 2 usage.

const TASKS_DIR = path.join(__dirname, 'tasks');
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
  // claude: no publish credentials. GH_CONFIG_DIR points at an empty dir so gh
  // is logged out; tokens are removed from the environment; the snapshot has no
  // remote. The model API needs the network, so the agent's network is not cut.
  const ghConfig = mkdtempSync(path.join(tmpdir(), 'gymcoach-eval-gh-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GH_CONFIG_DIR: ghConfig,
    GIT_TERMINAL_PROMPT: '0',
  };
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'DATABASE_URL'])
    delete env[k];
  const run = spawnSync(
    'claude',
    [
      '-p',
      task.statement,
      '--output-format',
      'json',
      '--max-budget-usd',
      String(args.budgetUsd),
      '--no-session-persistence',
      '--setting-sources',
      'project,local',
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Read Edit Write Glob Grep Bash(npx vitest:*) Bash(npm run test:*) Bash(git diff:*) Bash(git status:*)',
      '--disallowedTools',
      'WebFetch WebSearch',
    ],
    {
      cwd: work,
      env,
      encoding: 'utf8',
      timeout: task.budget.maxWallSeconds * 1000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  rmSync(ghConfig, { recursive: true, force: true });
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
function prepareEvalDatabase(repoRoot: string, work: string): string {
  const lock = path.join(process.env.TMPDIR || '/tmp', 'gymcoach-test-infra.lock');
  sh('flock', ['--wait', '600', lock, 'bash', 'scripts/test-db.sh'], { cwd: repoRoot });
  const name = `gymcoach_eval_${randomBytes(4).toString('hex')}`;
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
  return name;
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
      copyHidden(repoRoot, task, work);
      const all = [...task.grader.hidden, ...task.grader.preserved];
      if (all.some((f) => f.startsWith('tests/integration/')))
        dbName = prepareEvalDatabase(repoRoot, work);
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
    agentRun,
    environment: {
      node: process.version,
      dependenciesMatchBase: depsMatch,
      networkBlockedForAgent: args.agent !== 'claude',
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
      result: path.join(out, 'result.json'),
    }),
  );
  return result.outcome === 'pass' ? 0 : result.outcome === 'fail' ? 1 : 3;
}

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
