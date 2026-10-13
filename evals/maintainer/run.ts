import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
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
  CONTAINER_WORKDIR,
  EGRESS_ALLOWLIST,
  EGRESS_PROXY_PORT,
  NODE_IMAGE,
  POSTGRES_IMAGE,
  SNAPSHOT_EXCLUDES,
  UsageError,
  WALK_SKIP,
  addedLines,
  agentEnv,
  assertOutsideRepo,
  claudeRunAllowed,
  containerArgs,
  decideOutcome,
  diffTrees,
  evalSettings,
  gitBlobId,
  gradeEnv,
  groupByTier,
  parseArgs,
  planGrade,
  sameDependencies,
  summariseVitestReport,
  tamperViolations,
  type ContainerSpec,
  type Mount,
  type RunArgs,
  type TreeEntry,
} from './runner';

// Replay one maintainer task from a frozen snapshot (roadmap milestone 3):
//
//   npx tsx evals/maintainer/run.ts --task <id> --agent dry|reference|broken|tamper|claude
//       [--budget-usd N] [--i-accept-credential-risk] [--out <dir outside the repo>] [--keep]
//
// dry: the agent does nothing (the grader must fail: red before).
// reference: applies the real fix (base..fix diff of the task's source paths).
// broken: applies the task's intentionally incomplete fix (must be rejected).
// tamper: the broken fix plus attempts to cheat the grader (must be rejected).
// claude: runs `claude -p` in a container on an --internal network whose only
// way out is an egress proxy that allows the Anthropic API alone. Hard-disabled
// by PAID_AGENT_ENABLED in runner.ts until the operator enables it.
//
// Nothing written by an agent runs on the host. The snapshot is a `git archive`
// of the base commit; the agent works in a copy of it; grading runs in a fresh
// copy of the untouched snapshot onto which only the agent's regular application
// files are written, inside containers with no network (unit tier) or an
// --internal network shared with a throwaway Postgres (integration tier). After
// the agent ran, no git command is run in its workspace. Exit codes: 0 pass,
// 1 fail, 3 infra-error, 2 usage.

const TASKS_DIR = path.join(__dirname, 'tasks');
const PROXY_SCRIPT = path.join(__dirname, 'egress-proxy.cjs');
// The model credential on this machine (Claude Code's OAuth login). A copy goes
// into the agent's fresh HOME, mounted read-only; nothing else from the host
// HOME does.
const CLAUDE_CREDENTIAL = path.join(homedir(), '.claude', '.credentials.json');
const DB_USER = 'gymcoach_test';
const DB_NAME = 'gymcoach_test';

// --- cleanup ---------------------------------------------------------------
// Containers, networks and temp dirs (the credential copy among them) are
// removed on every exit path, including SIGINT, SIGTERM and SIGHUP.
const cleanups: (() => void)[] = [];
let cleanupsRegistered = false;

function onCleanup(fn: () => void) {
  if (!cleanupsRegistered) {
    cleanupsRegistered = true;
    process.on('exit', runCleanups);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
      process.on(sig, () => {
        runCleanups();
        process.exit(130);
      });
  }
  cleanups.push(fn);
}

export function runCleanups() {
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      // Best effort: the next cleanup still runs.
    }
  }
}

export function tempDir(prefix: string, preferShm = false): string {
  const base = preferShm && existsSync('/dev/shm') ? '/dev/shm' : tmpdir();
  const dir = mkdtempSync(path.join(base, prefix));
  onCleanup(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function dockerRm(name: string) {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
}

function dockerNetworkRm(name: string) {
  spawnSync('docker', ['network', 'rm', name], { stdio: 'ignore' });
}

// --- helpers ----------------------------------------------------------------

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

const uid = () => (process.getuid ? process.getuid() : 1000);
const gid = () => (process.getgid ? process.getgid() : 1000);
const shortId = () => randomBytes(4).toString('hex');

export function installedNodeModules(repoRoot: string): string {
  return realpathSync(path.join(repoRoot, 'node_modules'));
}

// The install is mounted read-only in every container; vitest's cache lives
// under node_modules/.vite, so a tmpfs over it keeps the install untouched.
function nodeModulesMounts(repoRoot: string): { mounts: Mount[]; tmpfs: string[] } {
  const nm = installedNodeModules(repoRoot);
  return {
    mounts: [{ host: nm, target: `${CONTAINER_WORKDIR}/node_modules`, readOnly: true }],
    tmpfs: existsSync(path.join(nm, '.vite'))
      ? [`${CONTAINER_WORKDIR}/node_modules/.vite:rw,size=256m`]
      : [],
  };
}

// Walk a tree without following symlinks: regular files get their blob id,
// anything else is recorded by kind. The install and .git are skipped.
export function walkTree(root: string, rel = '', out = new Map<string, TreeEntry>()) {
  for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (!rel && WALK_SKIP.has(entry.name)) continue;
    const full = path.join(root, child);
    const st = lstatSync(full);
    if (st.isDirectory()) walkTree(root, child, out);
    else if (st.isFile()) out.set(child, { kind: 'file', blob: gitBlobId(readFileSync(full)) });
    else out.set(child, { kind: st.isSymbolicLink() ? 'symlink' : 'other', blob: null });
  }
  return out;
}

// Write a file under root only if no existing component of its path is a
// symlink, so a path can never lead outside the grading tree.
function safeWrite(root: string, rel: string, content: Buffer) {
  const parts = rel.split('/');
  if (parts.some((p) => p === '..' || p === '' || p === '.')) throw new Error(`unsafe path ${rel}`);
  let cur = root;
  for (const part of parts.slice(0, -1)) {
    cur = path.join(cur, part);
    if (existsSync(cur)) {
      if (!lstatSync(cur).isDirectory())
        throw new Error(`path component is not a directory: ${rel}`);
    } else mkdirSync(cur);
  }
  const target = path.join(root, rel);
  if (existsSync(target) && !lstatSync(target).isFile())
    throw new Error(`target is not a regular file: ${rel}`);
  writeFileSync(target, content);
}

// --- snapshot -------------------------------------------------------------

function materialise(repoRoot: string, task: EvalTask, pristine: string): boolean {
  const tar = sh('git', ['-C', repoRoot, 'archive', '--format=tar', task.snapshot.baseSha]);
  sh('tar', ['-x', '-C', pristine], { input: tar });
  for (const excluded of SNAPSHOT_EXCLUDES)
    rmSync(path.join(pristine, excluded), { recursive: true, force: true });
  // Dependencies: reuse the installed tree only when the base pins the same
  // packages; otherwise the result would not describe the base.
  const baseLock = sh('git', [
    '-C',
    repoRoot,
    'show',
    `${task.snapshot.baseSha}:package-lock.json`,
  ]).toString();
  const currentLock = readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8');
  return sameDependencies(baseLock, currentLock);
}

// The agent's workspace: a copy of the snapshot with a fresh one-commit history
// and no remote, so it can diff its own work but cannot reach later commits or
// push anywhere. Created before any agent runs, so git is safe to use here.
function makeWorkspace(pristine: string, work: string) {
  cpSync(pristine, work, { recursive: true });
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
}

// --- containers -------------------------------------------------------------

export function runContainer(spec: ContainerSpec, timeoutMs: number) {
  onCleanup(() => dockerRm(spec.name));
  const run = spawnSync('docker', containerArgs(spec), {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  // A timeout kills only the docker client; removing the container stops every
  // process started inside it.
  dockerRm(spec.name);
  return run;
}

// A shell step in a grading container. The script is fixed text from this
// file; file lists come from task.json and are passed as arguments, never
// interpolated into the script.
export function gradeContainer(
  repoRoot: string,
  grade: string,
  reports: string,
  network: string,
  databaseUrl: string | null,
  script: string,
  args: string[],
): ContainerSpec {
  const nm = nodeModulesMounts(repoRoot);
  return {
    name: `gymcoach-eval-grade-${shortId()}`,
    image: NODE_IMAGE,
    network,
    mounts: [
      { host: grade, target: CONTAINER_WORKDIR, readOnly: false },
      ...nm.mounts,
      { host: reports, target: '/reports', readOnly: false },
    ],
    tmpfs: ['/tmp:rw,exec,size=1g', ...nm.tmpfs],
    env: gradeEnv(databaseUrl),
    uid: uid(),
    gid: gid(),
    workdir: CONTAINER_WORKDIR,
    command: ['bash', '-c', `mkdir -p /tmp/home && ${script}`, 'grade', ...args],
  };
}

// Prisma generate for a tree, inside a container with no network: the schema
// (and its generator) is application code, so it never runs on the host.
function generateInContainer(repoRoot: string, tree: string, reports: string) {
  const run = runContainer(
    gradeContainer(repoRoot, tree, reports, 'none', null, 'npx prisma generate >/dev/null', []),
    300_000,
  );
  if (run.status !== 0)
    throw new Error(`prisma generate failed: ${(run.stderr || '').slice(-400)}`);
}

// The integration tier's database: a throwaway Postgres on an --internal
// network created for this run, migrated to the graded schema from inside a
// container. Never the host's test database, never the host network.
function startDatabase(repoRoot: string, grade: string, reports: string) {
  const network = `gymcoach-eval-net-${shortId()}`;
  const db = `gymcoach-eval-db-${shortId()}`;
  sh('docker', ['network', 'create', '--internal', network]);
  onCleanup(() => dockerNetworkRm(network));
  onCleanup(() => dockerRm(db));
  sh('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    db,
    '--network',
    network,
    '--tmpfs',
    '/var/lib/postgresql/data',
    '-e',
    `POSTGRES_USER=${DB_USER}`,
    '-e',
    `POSTGRES_PASSWORD=${DB_USER}`,
    '-e',
    `POSTGRES_DB=${DB_NAME}`,
    POSTGRES_IMAGE,
  ]);
  const deadline = Date.now() + 60_000;
  for (;;) {
    const ready = spawnSync(
      'docker',
      ['exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', DB_USER, '-d', DB_NAME],
      { stdio: 'ignore' },
    );
    if (ready.status === 0) break;
    if (Date.now() > deadline) throw new Error('the eval Postgres did not become ready');
    spawnSync('sleep', ['1']);
  }
  const url = `postgresql://${DB_USER}:${DB_USER}@${db}:5432/${DB_NAME}`;
  const migrate = runContainer(
    gradeContainer(repoRoot, grade, reports, network, url, 'npx prisma migrate deploy', []),
    300_000,
  );
  if (migrate.status !== 0)
    throw new Error(`prisma migrate deploy failed: ${(migrate.stderr || '').slice(-400)}`);
  return { network, url };
}

function runTests(
  repoRoot: string,
  grade: string,
  reports: string,
  label: string,
  group: { tier: 'unit' | 'integration'; files: string[] },
  database: { network: string; url: string } | null,
): TestRun {
  const reportName = `${label}-${group.tier}.json`;
  const config = group.tier === 'unit' ? 'vitest.config.ts' : 'vitest.integration.config.ts';
  const integration = group.tier === 'integration';
  if (integration && !database) throw new Error('integration tier without a database');
  const run = runContainer(
    gradeContainer(
      repoRoot,
      grade,
      reports,
      integration ? database!.network : 'none',
      integration ? database!.url : null,
      'npx vitest run --config "$1" --reporter=json --outputFile="/reports/$2" "${@:3}"',
      [config, reportName, ...group.files],
    ),
    900_000,
  );
  const report = path.join(reports, reportName);
  const raw = existsSync(report) ? readFileSync(report, 'utf8') : null;
  return {
    tier: group.tier,
    files: group.files,
    exitCode: run.status,
    ...summariseVitestReport(raw),
  };
}

// --- agents -----------------------------------------------------------------

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

// Harness self-check: the broken fix, then cheats a grader must resist:
// - a vi.mock in the test setup files swapping the module under test for a copy
//   of the fixed code, and every preserved test replaced by one that always
//   passes (grade inputs: the grading tree takes them from the base);
// - the module under test importing a git-ignored file (coverage/) that turns
//   chai's assert into a no-op (the tree walk scans ignored paths, and the
//   static check rejects the framework import);
// - the module under test loading chai through createRequire (static check);
// - a symlink to a host file (only regular files are accepted).
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
  mkdirSync(path.join(work, 'coverage'), { recursive: true });
  writeFileSync(
    path.join(work, 'coverage', 'quiet.ts'),
    "import { chai } from 'vitest';\nchai.Assertion.prototype.assert = function () {};\nexport {};\n",
  );
  const underTest = path.join(work, task.reference.paths[0]!);
  const depth = task.reference.paths[0]!.split('/').length - 1;
  const up = depth === 0 ? './' : '../'.repeat(depth);
  writeFileSync(
    underTest,
    `${readFileSync(underTest, 'utf8')}\nimport '${up}coverage/quiet';\n` +
      "import { createRequire as tamperRequire } from 'node:module';\n" +
      "tamperRequire(import.meta.url)('chai').Assertion.prototype.assert = function () {};\n",
  );
  symlinkSync('/etc/hostname', path.join(work, 'lib', 'tamper-link.ts'));
  return {
    exitCode: 0,
    costUsd: null,
    turns: null,
    note:
      'broken fix + vi.mock in setup + preserved tests weakened + chai disabled from a ' +
      'git-ignored module and through createRequire + a symlink',
  };
}

// The contained agent's HOME: a fresh directory (on tmpfs when /dev/shm exists)
// holding the eval settings and a copy of the model credential. The copy is
// mounted read-only over itself and removed on every exit path.
export function prepareAgentHome(): { home: string; credential: string | null } {
  const home = tempDir('gymcoach-eval-home-', true);
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  let credential: string | null = null;
  if (existsSync(CLAUDE_CREDENTIAL)) {
    credential = path.join(home, '.claude', '.credentials.json');
    copyFileSync(CLAUDE_CREDENTIAL, credential);
    chmodSync(credential, 0o400);
  }
  writeFileSync(
    path.join(home, '.claude', 'settings.json'),
    `${JSON.stringify(evalSettings(), null, 2)}\n`,
  );
  return { home, credential };
}

// The agent's network: an --internal network whose only other member is the
// egress proxy, itself also on the default bridge (its own way out). The agent
// has no route anywhere but the proxy, and the proxy allows only
// EGRESS_ALLOWLIST on port 443, refusing names that resolve to private
// addresses.
export function startEgress(): { network: string; proxy: string } {
  const network = `gymcoach-eval-agent-net-${shortId()}`;
  const proxy = `gymcoach-eval-proxy-${shortId()}`;
  sh('docker', ['network', 'create', '--internal', network]);
  onCleanup(() => dockerNetworkRm(network));
  onCleanup(() => dockerRm(proxy));
  sh('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    proxy,
    '--user',
    `${uid()}:${gid()}`,
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '64',
    '--memory',
    '256m',
    '-e',
    `EGRESS_ALLOW=${EGRESS_ALLOWLIST.join(',')}`,
    '-e',
    `EGRESS_PORT=${EGRESS_PROXY_PORT}`,
    '-v',
    `${PROXY_SCRIPT}:/proxy.cjs:ro`,
    NODE_IMAGE,
    'node',
    '/proxy.cjs',
  ]);
  sh('docker', ['network', 'connect', network, proxy]);
  return { network, proxy };
}

export function agentContainerSpec(
  repoRoot: string,
  work: string,
  home: { home: string; credential: string | null },
  egress: { network: string; proxy: string },
  command: string[],
): ContainerSpec {
  const nm = nodeModulesMounts(repoRoot);
  const mounts: Mount[] = [
    { host: work, target: CONTAINER_WORKDIR, readOnly: false },
    ...nm.mounts,
    {
      host: realpathSync(sh('which', ['claude']).toString().trim()),
      target: '/usr/local/bin/claude',
      readOnly: true,
    },
    { host: home.home, target: CONTAINER_HOME, readOnly: false },
  ];
  if (home.credential)
    mounts.push({
      host: home.credential,
      target: `${CONTAINER_HOME}/.claude/.credentials.json`,
      readOnly: true,
    });
  return {
    name: `gymcoach-eval-agent-${shortId()}`,
    image: NODE_IMAGE,
    network: egress.network,
    mounts,
    tmpfs: ['/tmp:rw,exec,size=1g', ...nm.tmpfs],
    env: agentEnv(egress.proxy),
    uid: uid(),
    gid: gid(),
    workdir: CONTAINER_WORKDIR,
    command,
  };
}

function runClaudeContained(
  args: RunArgs,
  task: EvalTask,
  repoRoot: string,
  work: string,
): EvalResult['agentRun'] {
  // Defence in depth: the gate is checked again here, not only in main.
  const gate = claudeRunAllowed(args, process.env);
  if (!gate.allowed) throw new UsageError(gate.reason);
  const home = prepareAgentHome();
  const egress = startEgress();
  const settings = `${CONTAINER_HOME}/.claude/settings.json`;
  const spec = agentContainerSpec(repoRoot, work, home, egress, [
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
  const run = runContainer(spec, task.budget.maxWallSeconds * 1000);
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

// --- grading tree -------------------------------------------------------------

// The agent's changes, read without following links, with the lines it added
// to each changed regular file (what the static tamper check inspects).
function readChanges(pristine: string, work: string, before: Map<string, TreeEntry>) {
  const changes = diffTrees(before, walkTree(work));
  return changes.map((c) => {
    if (c.status === 'deleted' || c.kind !== 'file') return { ...c, content: null };
    const after = readFileSync(path.join(work, c.file), 'utf8');
    const basePath = path.join(pristine, c.file);
    const base =
      existsSync(basePath) && lstatSync(basePath).isFile() ? readFileSync(basePath, 'utf8') : '';
    return { ...c, content: addedLines(base, after) };
  });
}

function buildGradeTree(
  repoRoot: string,
  task: EvalTask,
  pristine: string,
  work: string,
  grade: string,
  changes: ReturnType<typeof readChanges>,
): string[] {
  cpSync(pristine, grade, { recursive: true });
  const plan = planGrade(changes, task);
  for (const file of plan.write) {
    const src = path.join(work, file);
    if (!lstatSync(src).isFile()) continue;
    safeWrite(grade, file, readFileSync(src));
  }
  for (const file of plan.remove) {
    const target = path.join(grade, file);
    if (existsSync(target) && lstatSync(target).isFile()) rmSync(target);
  }
  for (const file of task.grader.hidden)
    safeWrite(grade, file, sh('git', ['-C', repoRoot, 'show', `${task.snapshot.fixSha}:${file}`]));
  return plan.ignored;
}

// --- main -------------------------------------------------------------------

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
  const reports = path.join(out, 'reports');
  mkdirSync(reports, { recursive: true });

  const startedAt = new Date().toISOString();
  const infraErrors: string[] = [];
  const durations: EvalResult['durationsMs'] = { materialise: null, agent: null, grade: null };
  let agentRun: EvalResult['agentRun'] = { exitCode: null, costUsd: null, turns: null, note: null };
  let depsMatch: boolean | null = null;
  const hidden: TestRun[] = [];
  const preserved: TestRun[] = [];
  const pristine = tempDir('gymcoach-eval-base-');
  const work = args.keep
    ? mkdtempSync(path.join(tmpdir(), 'gymcoach-eval-ws-'))
    : tempDir('gymcoach-eval-ws-');
  const grade = tempDir('gymcoach-eval-grade-');
  rmSync(grade, { recursive: true, force: true });
  let gradeInputsRestored: string[] = [];
  let violations: string[] = [];
  let changes: ReturnType<typeof readChanges> = [];

  try {
    let t = Date.now();
    depsMatch = materialise(repoRoot, task, pristine);
    if (!depsMatch) throw new Error('the base pins different dependencies than the installed tree');
    // The agent gets a generated client to work with; generated in a container.
    generateInContainer(repoRoot, pristine, reports);
    makeWorkspace(pristine, work);
    durations.materialise = Date.now() - t;

    const before = walkTree(work);
    t = Date.now();
    agentRun = runAgent(args, task, repoRoot, work);
    durations.agent = Date.now() - t;
    changes = readChanges(pristine, work, before);
    violations = tamperViolations(changes, task);
  } catch (err) {
    infraErrors.push(`setup: ${firstLine(err)}`);
  }

  if (infraErrors.length === 0) {
    const t = Date.now();
    try {
      gradeInputsRestored = buildGradeTree(repoRoot, task, pristine, work, grade, changes);
      // The graded schema may differ from the base: regenerate, in a container.
      generateInContainer(repoRoot, grade, reports);
      const all = [...task.grader.hidden, ...task.grader.preserved];
      const database = all.some((f) => f.startsWith('tests/integration/'))
        ? startDatabase(repoRoot, grade, reports)
        : null;
      for (const group of groupByTier(task.grader.hidden))
        hidden.push(runTests(repoRoot, grade, reports, 'hidden', group, database));
      for (const group of groupByTier(task.grader.preserved))
        preserved.push(runTests(repoRoot, grade, reports, 'preserved', group, database));
    } catch (err) {
      infraErrors.push(`grade: ${firstLine(err)}`);
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
    outcome: decideOutcome({ hidden, preserved, infraErrors, tamperViolations: violations }),
    hidden,
    preserved,
    infraErrors,
    gradeInputsRestored,
    tamperViolations: violations,
    agentRun,
    environment: {
      node: process.version,
      dependenciesMatchBase: depsMatch,
      // The contained agent reaches only the egress proxy; the self-checks run
      // no agent.
      agentNetwork: args.agent === 'claude' ? 'egress-proxy-only' : null,
      agentContained: args.agent === 'claude' ? true : null,
      // Every grading step ran in a container: no network for the unit tier,
      // an --internal network shared only with a throwaway Postgres for the
      // integration tier.
      gradedInContainer: true,
    },
  });
  writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (args.keep) console.log(`workspace kept: ${work}`);
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
      tamperViolations: result.tamperViolations,
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
