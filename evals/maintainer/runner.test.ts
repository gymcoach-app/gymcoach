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
  isAgentWritable,
  CANARY_FAILURE,
  CANARY_TITLE,
  canaryFiles,
  canaryPaths,
  canaryViolations,
  newCanary,
  isProtected,
  parseArgs,
  planGrade,
  PRISMA_CLI,
  VITEST_CLI,
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
  canary: 'ok',
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

  it('rejects a test global or hook called from application code', () => {
    for (const content of [
      'afterEach(() => restore());',
      'beforeEach(install);',
      'expect.extend({});',
      'vi.spyOn(Object, "is");',
      "globalThis.x = vitest['fn'];",
    ])
      expect(tamperViolations([ch('lib/b.ts', content)], task), content).toContainEqual(
        expect.stringContaining('test global'),
      );
    // Ordinary words and members of that name are not test globals.
    for (const content of [
      'const expected = 1;',
      'res.expect(200);',
      "const label = 'vitest is a test runner';",
      'const { expect: wanted } = opts;',
    ])
      expect(tamperViolations([ch('lib/b.ts', content)], task), content).toEqual([]);
  });

  it('does not mistake a word containing "eval" for eval', () => {
    for (const content of [
      "writeFileSync('/reports/.eval-tamper-marker', 'ran');",
      "const label = 'retrieval';",
      'const medieval = 1;',
    ])
      expect(tamperViolations([ch('lib/b.ts', content)], task), content).toEqual([]);
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
    ['eval taken as a value', 'const e = eval;'],
    ['a "#" subpath import', "import { chai } from '#rt';"],
    ['a "#" subpath require', "const v = require('#rt');"],
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

  it('rejects every change outside the agent-writable paths, whatever its content', () => {
    for (const file of [
      'prisma/schema.prisma',
      'prisma/gen.cjs',
      'prisma/migrations/1/migration.sql',
      '.npmrc',
      'lib/.npmrc',
      'lib/sub/.yarnrc.yml',
      '.env',
      'lib/node_modules/vitest/index.js',
      'vitest.setup.ts',
      'tests/integration/setup.ts',
      'lib/a.test.ts',
      'package.json',
      'scripts/x.sh',
      'coverage/quiet.ts',
    ])
      expect(tamperViolations([ch(file, 'export {};')], task), file).toEqual([
        expect.stringContaining('outside the agent-writable paths'),
      ]);
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
      expect.stringContaining('outside the agent-writable paths'),
    ]);
  });

  it('leaves legitimate application changes alone', () => {
    expect(
      tamperViolations(
        [
          ch('lib/a.ts', "import { z } from 'zod';\n// mentions vitest in prose\n"),
          ch('lib/c.ts', "const z = require('zod');\nconst x = await import('./y');"),
          ch('lib/d.ts', 'if (Object.is(a, b) && x.y === 1) return;'),
          ch('app/api/x/route.ts', 'export const GET = () => new Response();'),
          ch('messages/en/x.ts', 'export const x = {};'),
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

describe('the agent-writable allowlist', () => {
  const t = { grader: { hidden: ['lib/a.test.ts'], preserved: ['lib/b.test.ts'] } };

  it('accepts regular application files under the source roots', () => {
    for (const f of [
      'app/api/x/route.ts',
      'components/a.tsx',
      'lib/cardio.ts',
      'messages/fr/session.ts',
      'i18n/request.ts',
      'app/globals.css',
      'lib/x.mjs',
    ])
      expect(isAgentWritable(f, t), f).toBe(true);
  });

  it('refuses dotfiles at any depth, node_modules segments, tests, prisma and configs', () => {
    for (const f of [
      '.npmrc',
      'lib/.npmrc',
      'lib/deep/.yarnrc.yml',
      '.env',
      'app/.env.local',
      'lib/.hidden/x.ts',
      'lib/node_modules/vitest/index.js',
      'node_modules/x.js',
      'lib/a.test.ts',
      'lib/b.test.ts',
      'components/x.spec.tsx',
      'lib/__tests__/x.ts',
      'tests/integration/setup.ts',
      'prisma/schema.prisma',
      'prisma/generated/client.ts',
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vitest.config.ts',
      'vitest.setup.ts',
      'prisma.config.ts',
      'next.config.js',
      'middleware.ts',
      'scripts/verify.sh',
      'coverage/quiet.ts',
      'evals/x.json',
      'lib/../package.json',
      // Nested configs and non-source files under a source root (review of #455).
      'lib/quiet/package.json',
      'lib/tsconfig.json',
      'components/x/tsconfig.build.json',
      'app/jsconfig.json',
      'lib/vite.config.ts',
      'lib/.babelrc',
      'messages/en.json',
      'public/icon.svg',
      'lib/README.md',
      // What vitest reads besides test files.
      'lib/__mocks__/cardio.ts',
      'lib/__snapshots__/cardio.test.ts.snap',
    ])
      expect(isAgentWritable(f, t), f).toBe(false);
  });

  it('protects exactly what the agent may not write', () => {
    expect(isProtected('vitest.setup.ts', t)).toBe(true);
    expect(isProtected('lib/.npmrc', t)).toBe(true);
    expect(isProtected('lib/cardio.ts', t)).toBe(false);
  });

  it('lets a task allow other files under a source subpath, never past the hard exclusions', () => {
    const wide = { grader: { ...t.grader, allowPaths: ['public/icons'] } };
    expect(isAgentWritable('public/icons/a.svg', wide)).toBe(true);
    expect(isAgentWritable('public/icons/a.svg', t)).toBe(false);
    expect(isAgentWritable('public/other.svg', wide)).toBe(false);
    expect(isAgentWritable('public/icons/.npmrc', wide)).toBe(false);
    expect(isAgentWritable('public/icons/package.json', wide)).toBe(false);
    expect(isAgentWritable('public/icons/node_modules/x.js', wide)).toBe(false);
    // Even a task that bypassed the schema could not leave the source roots.
    for (const root of ['prisma', 'data', 'tests', '.'])
      expect(
        isAgentWritable(`${root}/x.ts`, { grader: { ...t.grader, allowPaths: [root] } }),
        root,
      ).toBe(false);
    expect(
      isAgentWritable('vitest.setup.ts', {
        grader: { ...t.grader, allowPaths: ['vitest.setup.ts'] },
      }),
    ).toBe(false);
  });

  it('refuses prisma, dotfile and node_modules allowPaths in task.json', () => {
    const base = JSON.parse(
      readFileSync(
        path.join(__dirname, 'tasks', 'dev-cardio-duration-separators', 'task.json'),
        'utf8',
      ),
    );
    for (const bad of [
      'prisma',
      'prisma/migrations',
      '.github',
      'lib/node_modules',
      'data',
      'tests',
      'vitest.setup.ts',
      'package.json',
      'lib',
      'lib/quiet/package.json',
      'lib/tsconfig.json',
      'lib/__mocks__',
    ])
      expect(
        evalTaskSchema.safeParse({ ...base, grader: { ...base.grader, allowPaths: [bad] } })
          .success,
        bad,
      ).toBe(false);
    expect(
      evalTaskSchema.parse({ ...base, grader: { ...base.grader, allowPaths: ['public/icons'] } })
        .grader.allowPaths,
    ).toEqual(['public/icons']);
  });
});

describe('tool invocation', () => {
  it('calls the tools as node scripts, never through npx or npm', () => {
    expect(PRISMA_CLI[0]).toBe('node');
    expect(VITEST_CLI[0]).toBe('node');
    expect([...PRISMA_CLI, ...VITEST_CLI].join(' ')).not.toMatch(/\bnp[mx]\b/);
  });

  it('builds grading and agent environments with an empty NODE_OPTIONS and no npm config', () => {
    for (const env of [gradeEnv(null), gradeEnv('postgresql://u:p@db:5432/x'), agentEnv('p')]) {
      expect(env.NODE_OPTIONS).toBe('');
      expect(Object.keys(env).some((k) => /^npm_config_/i.test(k))).toBe(false);
    }
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
  const nonce = 'a'.repeat(32);
  const file = (title: string, status = 'passed', message = '') => ({
    message,
    assertionResults: [{ title, status, failureMessages: [] }],
  });
  const report = (testResults: unknown[]) =>
    JSON.stringify({ numPassedTests: 4, numFailedTests: 1, numFailedTestSuites: 0, testResults });

  it("reads the counts and finds the canary carrying this run's nonce", () => {
    expect(summariseVitestReport(report([file(`${CANARY_TITLE} ${nonce}`)]), nonce)).toEqual({
      passed: 4,
      failed: 1,
      failedSuites: 0,
      canary: 'ok',
    });
  });

  it('reports a canary that is absent, from another run, or failing', () => {
    expect(summariseVitestReport(report([file('ordinary')]), nonce).canary).toBe('missing');
    expect(
      summariseVitestReport(report([file(`${CANARY_TITLE} ${'b'.repeat(32)}`)]), nonce).canary,
    ).toBe('missing');
    expect(
      summariseVitestReport(report([file(`${CANARY_TITLE} ${nonce}`, 'failed')]), nonce).canary,
    ).toBe('failed');
    // A file whose canary setup or afterAll hook threw: the run is failed even
    // when the canary test itself passed elsewhere.
    expect(
      summariseVitestReport(
        report([
          file(`${CANARY_TITLE} ${nonce}`),
          file('x', 'passed', `Error: ${CANARY_FAILURE} (after the test file): toBe accepts`),
        ]),
        nonce,
      ).canary,
    ).toBe('failed');
  });

  it('turns a missing or unreadable report into unknown counts', () => {
    const unknown = { passed: null, failed: null, failedSuites: null, canary: null };
    expect(summariseVitestReport(null, nonce)).toEqual(unknown);
    expect(summariseVitestReport('{not json', nonce)).toEqual(unknown);
    expect(summariseVitestReport('{}', nonce)).toMatchObject({ passed: null, canary: 'missing' });
  });
});

describe('the canary', () => {
  it('uses unpredictable file names and a fresh nonce per run', () => {
    const a = newCanary();
    const b = newCanary();
    expect(a.id).not.toBe(b.id);
    expect(a.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(a.nonce).not.toBe(b.nonce);
    expect([...a.files.keys()].sort()).toEqual(Object.values(canaryPaths(a.id)).sort());
  });

  it('records the framework before the base setup and checks it around every test', () => {
    const p = canaryPaths('abc');
    const files = canaryFiles('abc');
    const unit = files.get(p.unitConfig)!.toString();
    expect(unit).toContain("import base from './vitest.config';");
    // The first setup file is PREPENDED to the base setup files (mergeConfig
    // alone would append it), and the later one appended.
    expect(unit).toContain(
      `setupFiles: ['./${p.preUnit}', ...(Array.isArray(baseSetup) ? baseSetup : [baseSetup]), './${p.setup}']`,
    );
    expect(unit).toContain(`include: ['${p.test}']`);
    const integration = files.get(p.integrationConfig)!.toString();
    expect(integration).toContain("import base from './vitest.integration.config';");
    expect(integration).toContain(`setupFiles: ['./${p.preIntegration}', ...`);
    // The unit tier applies the base setup's jest-dom extension before the
    // record, so those matchers are part of it.
    const preUnit = files.get(p.preUnit)!.toString();
    expect(preUnit.indexOf("import '@testing-library/jest-dom/vitest'")).toBeLessThan(
      preUnit.indexOf(`from './${p.guard}'`),
    );
    expect(files.get(p.preIntegration)!.toString()).not.toContain('jest-dom');
    // The record covers the Assertion prototype, expect, the matcher registry
    // and the built-ins the matchers rely on.
    const guard = files.get(p.guard)!.toString();
    for (const target of [
      "'chai.Assertion.prototype', chai.Assertion.prototype, null",
      "['expect', expect, null]",
      "Symbol.for('$$jest-matchers-object')",
      "['Object', Object, ['is',",
      "['String.prototype', String.prototype,",
      "['Function.prototype', Function.prototype,",
    ])
      expect(guard, target).toContain(target);
    // Checked after the base setup, around every test and after the file.
    const setup = files.get(p.setup)!.toString();
    for (const hook of [
      "check('after the base setup')",
      "beforeEach(() => check('before a test'))",
      "afterEach(() => check('after a test'))",
      "check('after the file')",
    ])
      expect(setup, hook).toContain(hook);
    // Behavioural probes include the selective cases of the round-5 review.
    for (const probe of [
      'not.toBe accepts',
      'toBe accepts different strings',
      'toHaveBeenCalled accepts',
    ])
      expect(setup).toContain(probe);
    expect(files.get(p.test)!.toString()).toContain('process.env.EVAL_CANARY_NONCE');
    expect(files.get(p.test)!.toString()).toContain("check('inside a test')");
  });

  it('is protected like the hidden tests (never agent-writable)', () => {
    const t = { grader: { hidden: [], preserved: [] } };
    for (const file of canaryFiles('abc').keys())
      expect(isAgentWritable(file, t), file).toBe(false);
  });

  it('turns failed or missing canaries into tamper violations', () => {
    expect(
      canaryViolations([
        { ...run(), label: 'hidden' },
        { ...run({ canary: 'failed' }), label: 'hidden' },
        { ...run({ canary: 'missing', tier: 'integration' }), label: 'preserved' },
        { ...run({ canary: null }), label: 'preserved' },
      ]),
    ).toEqual([
      expect.stringContaining('hidden unit: canary-failed'),
      expect.stringContaining('preserved integration: canary-missing'),
    ]);
  });
});

describe('decideOutcome', () => {
  it('fails a run whose canary failed or is missing, even when every test passed', () => {
    for (const canary of ['failed', 'missing'] as const)
      expect(
        decideOutcome({ hidden: [run({ canary })], preserved: [run()], infraErrors: [] }),
        canary,
      ).toBe('fail');
    expect(decideOutcome({ hidden: [run()], preserved: [run()], infraErrors: [] })).toBe('pass');
  });

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

describe('planGrade', () => {
  it('takes only allowlisted regular application files from the agent', () => {
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
      { file: 'prisma/schema.prisma', status: 'modified', kind: 'file' },
      { file: '.npmrc', status: 'added', kind: 'file' },
      { file: 'lib/node_modules/vitest/index.js', status: 'added', kind: 'file' },
    ];
    expect(planGrade(changes, task)).toEqual({
      write: ['lib/cardio.ts', 'lib/cardio.tamper.ts'],
      remove: ['lib/old.ts'],
      ignored: [
        'lib/import/track.test.ts',
        'vitest.setup.ts',
        'tests/integration/cheat.ts',
        'evals/x.json',
        'prisma/generated/client.ts',
        'coverage/quiet.ts',
        'prisma/schema.prisma',
        '.npmrc',
        'lib/node_modules/vitest/index.js',
      ],
    });
    // The graded schema is the base file byte for byte: no prisma/ change is
    // ever written into a grading tree.
    const plan = planGrade(changes, task);
    expect([...plan.write, ...plan.remove].some((f) => f.startsWith('prisma/'))).toBe(false);
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
