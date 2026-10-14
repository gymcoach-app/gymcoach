import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  EGRESS_ALLOWLIST,
  NODE_IMAGE,
  PAID_AGENT_ENABLED,
  POSTGRES_IMAGE,
  SNAPSHOT_EXCLUDES,
  UsageError,
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
  isGradeInput,
  parseArgs,
  planGrade,
  prismaConfigBlocks,
  withBaseConfigBlocks,
  sameDependencies,
  staleEvalResources,
  summariseVitestReport,
  tamperViolations,
  PAID_AGENT_DISABLED_REASON,
  type Change,
  type TreeEntry,
} from './runner';
import { evalTaskSchema, type TestRun } from './schema';

// A changed regular file for the tamper check.
const ch = (
  file: string,
  content: string | null,
  over: Partial<Change> = {},
): Change & { content: string | null } => ({
  file,
  status: content === null ? 'deleted' : 'modified',
  kind: content === null ? null : 'file',
  content,
  ...over,
});

const run = (over: Partial<TestRun> = {}): TestRun => ({
  tier: 'unit',
  files: ['lib/a.test.ts'],
  exitCode: 0,
  passed: 3,
  failed: 0,
  failedSuites: 0,
  ...over,
});

describe('parseArgs', () => {
  it('reads a task and an agent', () => {
    expect(parseArgs(['--task', 'dev-x', '--agent', 'reference'])).toMatchObject({
      task: 'dev-x',
      agent: 'reference',
      budgetUsd: null,
    });
  });

  it('refuses unknown flags, repeated flags, bad agents and missing values', () => {
    expect(() => parseArgs(['--task', 'dev-x', '--merge'])).toThrow(UsageError);
    expect(() => parseArgs(['--task', 'a', '--task', 'b'])).toThrow(/twice/);
    expect(() => parseArgs(['--task', 'dev-x', '--agent', 'gpt'])).toThrow(/--agent/);
    expect(() => parseArgs(['--task', '--agent', 'dry'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--agent', 'dry'])).toThrow(/--task/);
    expect(() => parseArgs(['--task', 'dev-x', '--budget-usd', '0'])).toThrow(/positive/);
  });
});

describe('claudeRunAllowed', () => {
  const paid = { agent: 'claude' as const, budgetUsd: 2, acceptCredentialRisk: true };
  const approved = { EVAL_BUDGET_APPROVED: '1' };

  it('lets the free agents run', () => {
    expect(
      claudeRunAllowed({ agent: 'dry', budgetUsd: null, acceptCredentialRisk: false }, {}),
    ).toEqual({ allowed: true });
  });

  it('needs a budget, the operator approval and the credential-risk acknowledgement', () => {
    expect(claudeRunAllowed({ ...paid, budgetUsd: null }, approved, true).allowed).toBe(false);
    expect(claudeRunAllowed(paid, {}, true).allowed).toBe(false);
    expect(claudeRunAllowed(paid, { EVAL_BUDGET_APPROVED: 'yes' }, true).allowed).toBe(false);
    expect(claudeRunAllowed({ ...paid, acceptCredentialRisk: false }, approved, true)).toEqual({
      allowed: false,
      reason: expect.stringContaining('--i-accept-credential-risk'),
    });
    // With every precondition and the switch on, it would run.
    expect(claudeRunAllowed(paid, approved, true)).toEqual({ allowed: true });
  });

  it('stays hard-disabled until the operator flips PAID_AGENT_ENABLED in a reviewed PR', () => {
    expect(PAID_AGENT_ENABLED).toBe(false);
    expect(claudeRunAllowed(paid, approved)).toEqual({
      allowed: false,
      reason: PAID_AGENT_DISABLED_REASON,
    });
    expect(PAID_AGENT_DISABLED_REASON).toContain('PAID_AGENT_ENABLED');
  });

  it('parses the acknowledgement flag only once', () => {
    expect(
      parseArgs(['--task', 'dev-x', '--agent', 'claude', '--i-accept-credential-risk'])
        .acceptCredentialRisk,
    ).toBe(true);
    expect(parseArgs(['--task', 'dev-x']).acceptCredentialRisk).toBe(false);
    expect(() =>
      parseArgs(['--task', 'dev-x', '--i-accept-credential-risk', '--i-accept-credential-risk']),
    ).toThrow(/twice/);
  });
});

describe('tamperViolations', () => {
  const task = { grader: { hidden: ['lib/a.test.ts'], preserved: [] } };

  it('rejects a test framework import in application code', () => {
    const cheat =
      "export const x = 1;\nimport { chai } from 'vitest';\n" +
      'chai.Assertion.prototype.assert = function () {};\n';
    expect(tamperViolations([ch('lib/a.ts', cheat)], task).length).toBeGreaterThanOrEqual(1);
    for (const content of [
      "import 'chai';",
      "const c = require('chai');",
      "import { expect } from '@vitest/expect';",
      "const v = await import('vitest');",
      "import { defineConfig } from 'vitest/config';",
    ])
      expect(tamperViolations([ch('lib/b.ts', content)], task).length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    [
      'createRequire',
      "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('chai');",
    ],
    ['createRequire from a re-export', "mod.createRequire(here)('ch' + 'ai');"],
    ['getBuiltinModule', "process.getBuiltinModule('mod' + 'ule');"],
    ['an aliased require', 'const r = require;\nr(name);'],
    ['a non-literal require', 'const m = require(name);'],
    ['a template require', 'const m = require(`ch${"ai"}`);'],
    ['a non-literal dynamic import', 'const m = await import(name);'],
    ['module internals', "const Module = require('module');\nModule._load('x');"],
    ['a node_modules path', "import x from '../node_modules/chai/index.js';"],
    ['matcher state', "globalThis[Symbol.for('$$jest-matchers-object')] = {};"],
    ['a patched built-in', 'Object.is = () => true;'],
    ['a patched prototype', 'Array.prototype.includes = () => true;'],
    ['defineProperty on a built-in', "Object.defineProperty(JSON, 'stringify', { value: 1 });"],
    ['a global assignment', 'globalThis.expect = () => ({});'],
    ['an exit hook', "process.on('exit', () => {});"],
    ['an exit override', 'process.exit = () => {};'],
    ['an output stream patch', 'process.stdout.write = () => true;'],
    ['eval', 'eval(code);'],
    ['indirect eval', 'const r = (0, eval)(src);'],
    ['the Function constructor without new', "const f = Function('return this')();"],
    ['constructor.constructor', "const g = [].constructor.constructor('return globalThis')();"],
    ['a bracket write on globalThis', "globalThis['ex' + 'pect'] = () => ({});"],
    ['a bracket read of process.binding', "const b = process['binding']('fs');"],
    ['a bracket write on a prototype', "Array.prototype['includes'] = () => true;"],
    ['a write through getPrototypeOf', 'Object.getPrototypeOf(x).y = 1;'],
    ['__proto__', 'x.__proto__.y = 1;'],
    ['defineProperty on globalThis', "Object.defineProperty(globalThis, 'expect', { value: 1 });"],
    [
      'defineProperty on a prototype',
      "Reflect.defineProperty(Array.prototype, 'at', { value: 1 });",
    ],
    ['a computed Symbol.for', "const k = Symbol.for('$$je' + 'st-matchers-object');"],
    ['a non-literal Symbol.for', 'const k = Symbol.for(name);'],
    ['an fs import', "import { writeFileSync } from 'node:fs';"],
    ['an fs/promises import', "import { writeFile } from 'fs/promises';"],
    ['a child_process require', "const cp = require('child_process');"],
    ['a worker_threads import', "import { Worker } from 'node:worker_threads';"],
  ])('rejects %s in application code', (_, content) => {
    expect(tamperViolations([ch('lib/b.ts', content)], task).length).toBeGreaterThanOrEqual(1);
  });

  it('lets a task allow a rule its real fix needs, and only that rule', () => {
    const allowing = { grader: { ...task.grader, allowTamperRules: ['host-io' as const] } };
    expect(
      tamperViolations([ch('lib/b.ts', "import { readFileSync } from 'node:fs';")], allowing),
    ).toEqual([]);
    expect(tamperViolations([ch('lib/b.ts', 'eval(code);')], allowing)).toHaveLength(1);
  });

  it('rejects a change to the generator or datasource block of the Prisma schema', () => {
    expect(
      tamperViolations(
        [{ ...ch('prisma/schema.prisma', 'model X { id Int @id }'), configBlocksChanged: true }],
        task,
      ),
    ).toEqual([expect.stringContaining('generator or datasource')]);
    expect(
      tamperViolations(
        [{ ...ch('prisma/schema.prisma', 'model X { id Int @id }'), configBlocksChanged: false }],
        task,
      ),
    ).toEqual([]);
  });

  it('rejects a symlink or any non-regular file the agent created', () => {
    expect(
      tamperViolations([ch('lib/link.ts', null, { status: 'added', kind: 'symlink' })], task),
    ).toEqual([expect.stringContaining('symlink')]);
    expect(
      tamperViolations([ch('lib/fifo', null, { status: 'modified', kind: 'other' })], task),
    ).toEqual([expect.stringContaining('other')]);
  });

  it('rejects any edit to the generated Prisma client', () => {
    expect(tamperViolations([ch('prisma/generated/client.ts', 'x')], task)).toHaveLength(1);
    expect(tamperViolations([ch('prisma/generated/old.ts', null)], task)).toEqual([
      expect.stringContaining('generated Prisma client'),
    ]);
  });

  it('leaves legitimate application changes and grade inputs alone', () => {
    expect(
      tamperViolations(
        [
          ch('lib/a.ts', "import { z } from 'zod';\n// mentions vitest in prose\n"),
          ch('lib/c.ts', "const z = require('zod');\nconst x = await import('./y');"),
          ch('lib/d.ts', 'if (Object.is(a, b) && x.y === 1) return;'),
          ch('lib/a.test.ts', "import { it } from 'vitest';"),
          ch('tests/integration/x.test.ts', "import { it } from 'vitest';"),
          ch('vitest.setup.ts', "import { vi } from 'vitest';"),
          ch('lib/gone.ts', null),
          ch('lib/vitest-like.ts', "import x from 'vitest-ish';"),
        ],
        task,
      ),
    ).toEqual([]);
  });

  // Needs the base and fix commits: present in a full clone (local gate), absent
  // from CI's shallow checkout, where the replays are not run either.
  const tasksDir = path.join(__dirname, 'tasks');
  const committed = readdirSync(tasksDir).map((id) =>
    evalTaskSchema.parse(JSON.parse(readFileSync(path.join(tasksDir, id, 'task.json'), 'utf8'))),
  );
  const hasCommit = (sha: string) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
        cwd: __dirname,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  };
  const historyAvailable = committed.every(
    (t) => hasCommit(t.snapshot.baseSha) && hasCommit(t.snapshot.fixSha),
  );

  it.runIf(historyAvailable)('accepts the reference fixes of the committed tasks', () => {
    for (const t of committed) {
      for (const file of t.reference.paths) {
        const show = (sha: string) =>
          execFileSync('git', ['show', `${sha}:${file}`], { cwd: __dirname }).toString();
        const content = addedLines(show(t.snapshot.baseSha), show(t.snapshot.fixSha));
        expect(tamperViolations([ch(file, content)], t)).toEqual([]);
      }
    }
  });
});

describe('Prisma generator and datasource blocks', () => {
  const base =
    'generator client {\n  provider = "prisma-client"\n  output   = "./generated"\n}\n\n' +
    'datasource db {\n  provider = "postgresql"\n}\n\nmodel A {\n  id Int @id\n}\n';
  const evil = base.replace('"prisma-client"', '"node ./evil.js"') + 'model B {\n  id Int @id\n}\n';

  it('notices a changed generator provider but not a model change', () => {
    expect(prismaConfigBlocks(evil)).not.toEqual(prismaConfigBlocks(base));
    expect(prismaConfigBlocks(base + 'model B {\n  id Int @id\n}\n')).toEqual(
      prismaConfigBlocks(base),
    );
  });

  it('grades the agent models under the base generator and datasource', () => {
    const graded = withBaseConfigBlocks(evil, base);
    expect(graded).toContain('"prisma-client"');
    expect(graded).not.toContain('evil.js');
    expect(graded).toContain('model B');
    expect(prismaConfigBlocks(graded)).toEqual(prismaConfigBlocks(base));
  });
});

describe('staleEvalResources', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const hour = 60 * 60 * 1000;
  it('removes only harness resources older than any run could last', () => {
    expect(
      staleEvalResources(
        [
          { name: 'gymcoach-eval-agent-1', createdMs: now - 5 * hour },
          { name: 'gymcoach-eval-agent-2', createdMs: now - 10 * 60 * 1000 },
          { name: 'other-container', createdMs: now - 50 * hour },
          { name: 'gymcoach-eval-home-x', createdMs: Number.NaN },
        ],
        now,
        3 * hour,
      ),
    ).toEqual(['gymcoach-eval-agent-1']);
  });
});

describe('addedLines', () => {
  it('returns only the lines the agent added, counting duplicates', () => {
    expect(addedLines('a\nb\nrequire(x)\n', 'a\nb\nrequire(x)\nnew\n')).toBe('new');
    expect(addedLines('a\n', 'a\na\n')).toBe('a');
    expect(addedLines('', 'x\ny')).toBe('x\ny');
  });
});

describe('gitBlobId and diffTrees', () => {
  it('computes git blob ids in-process', () => {
    expect(gitBlobId(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('reports added, modified, kind-changed and deleted paths', () => {
    const f = (blob: string): TreeEntry => ({ kind: 'file', blob });
    const before = new Map([
      ['a.ts', f('1')],
      ['b.ts', f('2')],
      ['c.ts', f('3')],
      ['d.ts', f('4')],
    ]);
    const after = new Map<string, TreeEntry>([
      ['a.ts', f('1')],
      ['b.ts', f('9')],
      ['c.ts', { kind: 'symlink', blob: null }],
      ['coverage/cheat.ts', f('5')],
    ]);
    expect(diffTrees(before, after)).toEqual([
      { file: 'b.ts', status: 'modified', kind: 'file' },
      { file: 'c.ts', status: 'modified', kind: 'symlink' },
      { file: 'coverage/cheat.ts', status: 'added', kind: 'file' },
      { file: 'd.ts', status: 'deleted', kind: null },
    ]);
  });
});

describe('assertOutsideRepo', () => {
  it('refuses the repository itself and anything inside it', () => {
    expect(() => assertOutsideRepo('/repo', '/repo')).toThrow(UsageError);
    expect(() => assertOutsideRepo('/repo/out', '/repo')).toThrow(UsageError);
    expect(() => assertOutsideRepo('/repo/a/../out', '/repo')).toThrow(UsageError);
  });

  it('accepts a sibling or a temp dir', () => {
    expect(() => assertOutsideRepo('/repo-evals/out', '/repo')).not.toThrow();
    expect(() => assertOutsideRepo('/tmp/gymcoach-evals/x', '/repo')).not.toThrow();
  });
});

describe('groupByTier', () => {
  it('routes integration tests to the integration tier', () => {
    expect(
      groupByTier(['lib/a.test.ts', 'tests/integration/b.test.ts', 'components/c.test.tsx']),
    ).toEqual([
      { tier: 'unit', files: ['lib/a.test.ts', 'components/c.test.tsx'] },
      { tier: 'integration', files: ['tests/integration/b.test.ts'] },
    ]);
    expect(groupByTier([])).toEqual([]);
  });
});

describe('summariseVitestReport', () => {
  it('reads the counts of the JSON reporter', () => {
    const raw = JSON.stringify({ numPassedTests: 4, numFailedTests: 1, numFailedTestSuites: 0 });
    expect(summariseVitestReport(raw)).toEqual({ passed: 4, failed: 1, failedSuites: 0 });
  });

  it('turns a missing or unreadable report into unknown counts', () => {
    expect(summariseVitestReport(null)).toEqual({ passed: null, failed: null, failedSuites: null });
    expect(summariseVitestReport('{not json')).toEqual({
      passed: null,
      failed: null,
      failedSuites: null,
    });
    expect(summariseVitestReport('{}')).toEqual({ passed: null, failed: null, failedSuites: null });
  });
});

describe('decideOutcome', () => {
  it('fails a run with a tamper violation even when every test passed', () => {
    expect(
      decideOutcome({
        hidden: [run()],
        preserved: [run()],
        infraErrors: [],
        tamperViolations: ['lib/a.ts: application code imports a test framework'],
      }),
    ).toBe('fail');
  });

  it('passes only when every hidden and preserved run is green', () => {
    expect(decideOutcome({ hidden: [run()], preserved: [run()], infraErrors: [] })).toBe('pass');
    expect(
      decideOutcome({ hidden: [run({ failed: 1 })], preserved: [run()], infraErrors: [] }),
    ).toBe('fail');
    expect(
      decideOutcome({ hidden: [run()], preserved: [run({ failed: 2 })], infraErrors: [] }),
    ).toBe('fail');
  });

  it('fails a hidden file that does not even load (a failed suite, no test counted)', () => {
    expect(
      decideOutcome({
        hidden: [run({ passed: 0, failed: 0, failedSuites: 1 })],
        preserved: [],
        infraErrors: [],
      }),
    ).toBe('fail');
  });

  it('never passes a run with no test executed', () => {
    expect(decideOutcome({ hidden: [run({ passed: 0 })], preserved: [], infraErrors: [] })).toBe(
      'fail',
    );
  });

  it('reports an infrastructure error instead of a pass or a silent fail', () => {
    expect(decideOutcome({ hidden: [run()], preserved: [run()], infraErrors: ['db down'] })).toBe(
      'infra-error',
    );
    expect(decideOutcome({ hidden: [run({ passed: null })], preserved: [], infraErrors: [] })).toBe(
      'infra-error',
    );
    expect(decideOutcome({ hidden: [], preserved: [run()], infraErrors: [] })).toBe('infra-error');
  });
});

describe('sameDependencies', () => {
  const lock = (version: string, dep: string) =>
    JSON.stringify({ packages: { '': { version }, 'node_modules/zod': { version: dep } } });

  it('ignores the root version bump of a release', () => {
    expect(sameDependencies(lock('0.1.0', '4.0.0'), lock('1.0.0', '4.0.0'))).toBe(true);
  });

  it('notices a changed dependency', () => {
    expect(sameDependencies(lock('1.0.0', '4.0.0'), lock('1.0.0', '4.1.0'))).toBe(false);
  });
});

describe('committed tasks', () => {
  const tasksDir = path.join(__dirname, 'tasks');
  const ids = readdirSync(tasksDir);

  it('has a smoke suite to run', () => {
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it.each(ids)('%s is a valid task with a broken variant and a separate grader', (id) => {
    const task = evalTaskSchema.parse(
      JSON.parse(readFileSync(path.join(tasksDir, id, 'task.json'), 'utf8')),
    );
    expect(task.id).toBe(id);
    expect(existsSync(path.join(tasksDir, id, 'broken.patch'))).toBe(true);
    // The reference fix never includes the grader's own test files.
    for (const file of task.grader.hidden) expect(task.reference.paths).not.toContain(file);
    // The statement must not point the agent at the fix.
    expect(task.statement).not.toMatch(/#\d+|issue \d+|PR \d+|[0-9a-f]{7,40}/i);
    expect(task.snapshot.baseSha).not.toBe(task.snapshot.fixSha);
  });
});

describe('decideOutcome and the vitest exit code', () => {
  it('fails a run whose counts look green but whose exit code is not zero', () => {
    // vitest exits non-zero on an unhandled error even when every test passed.
    expect(decideOutcome({ hidden: [run({ exitCode: 1 })], preserved: [], infraErrors: [] })).toBe(
      'fail',
    );
  });
});

const task = {
  grader: {
    hidden: ['lib/cardio.test.ts'],
    preserved: ['lib/import/track.test.ts'],
  },
};

describe('isGradeInput', () => {
  it('covers tests, test helpers, runner and package configs', () => {
    for (const file of [
      'lib/cardio.test.ts',
      'lib/import/track.test.ts',
      'components/a.test.tsx',
      'tests/integration/setup.ts',
      'tests/integration/helpers/seed.ts',
      'vitest.config.ts',
      'vitest.integration.config.ts',
      'vitest.workspace.ts',
      'vitest.setup.ts',
      'package.json',
      'package-lock.json',
      'tsconfig.json',
    ])
      expect(isGradeInput(file, task), file).toBe(true);
  });

  it('leaves application code to the agent', () => {
    for (const file of ['lib/cardio.ts', 'app/api/x/route.ts', 'prisma/schema.prisma'])
      expect(isGradeInput(file, task), file).toBe(false);
  });
});

describe('planGrade', () => {
  it('takes only regular application files from the agent, never grade inputs', () => {
    const changes: Change[] = [
      { file: 'lib/cardio.ts', status: 'modified', kind: 'file' },
      { file: 'lib/cardio.tamper.ts', status: 'added', kind: 'file' },
      { file: 'lib/old.ts', status: 'deleted', kind: null },
      { file: 'lib/import/track.test.ts', status: 'modified', kind: 'file' },
      { file: 'vitest.setup.ts', status: 'modified', kind: 'file' },
      { file: 'tests/integration/cheat.ts', status: 'added', kind: 'file' },
      { file: 'evals/x.json', status: 'added', kind: 'file' },
      { file: 'lib/link.ts', status: 'added', kind: 'symlink' },
      { file: 'prisma/generated/client.ts', status: 'modified', kind: 'file' },
      { file: 'coverage/quiet.ts', status: 'added', kind: 'file' },
    ];
    expect(planGrade(changes, task)).toEqual({
      write: ['lib/cardio.ts', 'lib/cardio.tamper.ts', 'coverage/quiet.ts'],
      remove: ['lib/old.ts'],
      ignored: [
        'lib/import/track.test.ts',
        'vitest.setup.ts',
        'tests/integration/cheat.ts',
        'evals/x.json',
      ],
    });
  });
});

describe('the snapshot and the containers', () => {
  it('strips the project .claude directory and the eval suite from the snapshot', () => {
    expect(SNAPSHOT_EXCLUDES).toContain('.claude');
    expect(SNAPSHOT_EXCLUDES).toContain('evals');
  });

  it('pins every image by digest', () => {
    expect(NODE_IMAGE).toMatch(/^node@sha256:[0-9a-f]{64}$/);
    expect(POSTGRES_IMAGE).toMatch(/^postgres@sha256:[0-9a-f]{64}$/);
  });

  const spec = {
    name: 'gymcoach-eval-agent-abcd',
    image: NODE_IMAGE,
    network: 'gymcoach-eval-agent-net-1',
    mounts: [
      { host: '/tmp/ws', target: '/work', readOnly: false },
      { host: '/home/u/repo/node_modules', target: '/work/node_modules', readOnly: true },
    ],
    tmpfs: ['/tmp:rw,exec,size=1g'],
    env: agentEnv('gymcoach-eval-proxy-1'),
    uid: 1000,
    gid: 1000,
    workdir: '/work',
    command: ['claude', '-p', 'x'],
  };

  it('hardens every container and passes only the listed mounts, network and variables', () => {
    const args = containerArgs(spec);
    expect(args.join(' ')).toContain('--network gymcoach-eval-agent-net-1');
    expect(args).toContain('--read-only');
    expect(args.join(' ')).toContain('--cap-drop ALL');
    expect(args).toContain('no-new-privileges');
    expect(args).not.toContain('--privileged');
    const mounts = args.flatMap((a, i) => (args[i - 1] === '-v' ? [a] : []));
    expect(mounts).toEqual(['/tmp/ws:/work:rw', '/home/u/repo/node_modules:/work/node_modules:ro']);
    expect(mounts.some((m) => m.includes('docker.sock'))).toBe(false);
    expect(args.slice(-4)).toEqual([NODE_IMAGE, 'claude', '-p', 'x']);
    expect(args).not.toContain('--env-file');
  });

  it('routes the agent through the proxy and turns off non-essential traffic', () => {
    const env = agentEnv('p');
    expect(env.HTTPS_PROXY).toBe('http://p:3128');
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    expect(Object.keys(env).some((k) => /TOKEN|API_KEY|DATABASE_URL/.test(k))).toBe(false);
    expect(EGRESS_ALLOWLIST).toEqual(['api.anthropic.com']);
  });

  it('gives grading containers no credential and one worker for the integration tier', () => {
    expect(gradeEnv(null)).not.toHaveProperty('DATABASE_URL');
    expect(gradeEnv(null)).not.toHaveProperty('HTTPS_PROXY');
    expect(gradeEnv('postgresql://u:p@db:5432/x')).toMatchObject({
      DATABASE_URL: 'postgresql://u:p@db:5432/x',
      VITEST_MAX_WORKERS: '1',
    });
  });

  it('denies every publishing and fetching path in the eval settings', () => {
    const deny = (evalSettings().permissions as { deny: string[] }).deny;
    for (const rule of ['Bash(git push:*)', 'Bash(gh:*)', 'Bash(curl:*)', 'WebFetch'])
      expect(deny).toContain(rule);
  });

  it('accepts the tamper self-check agent', () => {
    expect(parseArgs(['--task', 'dev-x', '--agent', 'tamper']).agent).toBe('tamper');
  });
});
