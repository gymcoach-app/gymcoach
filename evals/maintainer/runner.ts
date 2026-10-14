import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  AGENT_WRITABLE_ROOTS,
  CONFIG_FILE,
  agents,
  type AgentKind,
  type Outcome,
  type TamperRuleId,
  type TestRun,
} from './schema';

export { AGENT_WRITABLE_ROOTS };

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
// the agent (planGrade), and every grading run starts from a fresh, read-only
// copy of the grading tree, but application code still runs inside the test
// process at grading time and could sabotage it, for example by disabling
// chai's assert from the module under test or a module the test setup imports.
// No application file of this repo needs any of the patterns below, so a
// changed non-test file that contains one fails the run (fail closed: a false
// positive costs a re-review of the task, a false negative a wrong score). It
// is a screen, not a proof: JavaScript offers more ways to reach a global than
// a pattern list can name. A task whose real fix needs a rule's pattern lists
// it in grader.allowTamperRules.
const anyOf = (...parts: RegExp[]) => new RegExp(parts.map((p) => p.source).join('|'));
const BUILTINS =
  'Object|Array|Function|Promise|String|Number|Boolean|JSON|Math|Reflect|Symbol|Error|Map|Set|RegExp|Date|globalThis|global|process';
export const TAMPER_RULES: { id: TamperRuleId; why: string; pattern: RegExp }[] = [
  {
    id: 'test-framework',
    why: 'imports a test framework (vitest, chai or @vitest/*)',
    pattern:
      /(?:\bfrom|\bimport|\brequire\s*\()\s*\(?\s*['"`](?:vitest|chai|@vitest\/[^'"`]*)(?:\/[^'"`]*)?['"`]/,
  },
  {
    id: 'dynamic-require',
    why: 'loads a module by a non-literal or aliased require',
    // `require` anywhere except a direct call with one plain string literal.
    pattern: /\brequire\b(?!\s*\(\s*(['"])[^'"`$\\]*\1\s*\))/,
  },
  {
    id: 'dynamic-import',
    why: 'loads a module by a non-literal dynamic import',
    pattern: /\bimport\s*\(\s*(?!(['"])[^'"`$\\]*\1\s*\))/,
  },
  {
    id: 'module-system',
    why: 'reaches the module system or evaluates code (createRequire, module internals, vm, eval, Function)',
    pattern: anyOf(
      /\bcreateRequire\b/,
      /\bgetBuiltinModule\b/,
      /\bmodule\s*\.\s*require\b/,
      /\bModule\s*\.\s*_load\b/,
      /\bprocess\s*(?:\.\s*|\[\s*['"`])(?:mainModule|binding|_linkedBinding|dlopen)\b/,
      /['"`](?:node:)?(?:module|vm)['"`]/,
      // eval called directly, indirectly ((0, eval)(...)) or taken as a value
      // (const e = eval). A word such as "-eval-" inside a string is not eval.
      /\beval\s*\(/,
      /[(,=:]\s*eval\s*[),;]/,
      // The Function constructor, with or without new.
      /\bFunction\s*\(/,
      /\bconstructor\s*\.\s*constructor\b/,
      /\[\s*['"`]constructor['"`]\s*\]/,
    ),
  },
  {
    id: 'node-modules-path',
    why: 'names a path inside node_modules',
    pattern: /['"`][^'"`\n]*node_modules[^'"`\n]*['"`]/,
  },
  {
    id: 'framework-internals',
    why: 'touches test framework internals (matcher state, vitest globals, computed symbols)',
    pattern:
      /jest-matchers|__vitest|\bSymbol\s*\.\s*for\s*\(\s*['"`][^'"`]*(?:jest|vitest|chai)|\bSymbol\s*\.\s*for\s*\(\s*(?!(['"])[^'"`$\\+]*\1\s*\))/,
  },
  {
    id: 'global-mutation',
    why: 'reassigns a built-in, a prototype or a global',
    pattern: anyOf(
      // Object.is = ..., Array.prototype.includes = ..., globalThis.expect = ...
      new RegExp(
        `\\b(?:${BUILTINS})\\s*\\.\\s*(?:prototype\\s*\\.\\s*)?[A-Za-z_$][\\w$]*\\s*=(?!=)`,
      ),
      // Bracket writes: globalThis['ex' + 'pect'] = ..., process['x'] = ...
      /\b(?:globalThis|global|process|window|self)\s*\[[^\]\n]*\]\s*=(?!=)/,
      // Any prototype member write, dotted or bracketed.
      /\.\s*prototype\s*(?:\.\s*[\w$]+|\[[^\]\n]*\])\s*=(?!=)/,
      // A write through getPrototypeOf, or __proto__ at all.
      /\b(?:Object|Reflect)\s*\.\s*getPrototypeOf\s*\([^)\n]*\)\s*(?:\.\s*[\w$]+|\[[^\]\n]*\])\s*=(?!=)/,
      /\b__proto__\b/,
      // defineProperty and friends on a built-in, a global or a prototype.
      new RegExp(
        `\\b(?:Object|Reflect)\\s*\\.\\s*(?:defineProperty|defineProperties|setPrototypeOf|assign|set)\\s*\\(\\s*(?:(?:${BUILTINS})\\b|[\\w$.]*\\.\\s*prototype\\b|Object\\s*\\.\\s*getPrototypeOf\\b)`,
      ),
    ),
  },
  {
    id: 'process-hooks',
    why: 'hooks the process exit or its output streams',
    pattern:
      /\bprocess\s*\.\s*(?:on|once|prependListener|addListener)\s*\(\s*['"`](?:exit|beforeExit)['"`]|\bprocess\s*\.\s*(?:exit|exitCode|reallyExit|stdout|stderr)\s*=(?!=)|\bprocess\s*\.\s*(?:stdout|stderr)\s*\.\s*write\s*=(?!=)/,
  },
  {
    id: 'subpath-import',
    why: 'imports a "#" subpath specifier (resolved through a package.json "imports" map; the root package.json declares none)',
    pattern: /(?:\bfrom|\bimport|\brequire\s*\()\s*\(?\s*['"`]#/,
  },
  {
    id: 'test-globals',
    why: 'calls a test global or hook (expect, vi, beforeEach, afterEach, ...) from application code',
    // A bare test global used as a call or a member: application code has no
    // reason to, and a hook it registers could install and undo a cheat
    // between two canary checks.
    pattern:
      /(?<![\w$.])(?:expect|vi|vitest|beforeEach|afterEach|beforeAll|afterAll|onTestFinished|onTestFailed)\s*(?:\(|\.|\[)/,
  },
  {
    id: 'host-io',
    why: 'imports a file system, process or low-level runtime module (fs, child_process, worker_threads, ...)',
    pattern:
      /['"`](?:node:)?(?:fs|child_process|worker_threads|cluster|inspector|v8|wasi|repl)(?:\/[^'"`]*)?['"`]/,
  },
];

// The parts of a task the static rules and the grading plan read.
export interface GraderSpec {
  grader: {
    hidden: string[];
    preserved: string[];
    allowTamperRules?: TamperRuleId[];
    allowPaths?: string[];
  };
}

export const PRISMA_SCHEMA = 'prisma/schema.prisma';

// The directory `prisma generate` writes (the base schema's generator output).
export const PRISMA_CLIENT_DIR = 'prisma/generated';

// What the agent may change, as an ALLOWLIST: regular application source files
// (by extension) under the source roots AGENT_WRITABLE_ROOTS (schema.ts). Four review rounds on #455 each found a new way around a
// denylist of grade inputs (a generator opened on the same line as a brace,
// hashes taken after generate, a lone carriage return, a project .npmrc whose
// node-options reached NODE_OPTIONS under npx); naming what the agent may write
// closes the whole class instead (lesson L45). Everything else in a grading
// tree comes from the base: configs (.npmrc, .yarnrc*, .env*, package.json, the
// lockfile, tsconfig, vitest configs and setups), prisma/ (schema, migrations,
// generated client), scripts/, tests/, every test file. A task widens the list
// only through grader.allowPaths in its task.json, which the agent never sees.
// Only source code and styles: no JSON (no package.json "imports" map, no
// tsconfig, no translation catalog in JSON: the repo has none under messages/
// or i18n/), no images, no markdown. A fix that needs another kind of file is
// out of scope for a task until its task.json says otherwise.
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|css)$/;

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

export function isAgentWritable(file: string, task: GraderSpec): boolean {
  const parts = file.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return false;
  // Never: dotfiles and dot-directories (.npmrc, .env, .yarnrc at any depth),
  // a node_modules segment (module resolution would prefer it), test files and
  // test directories (the grader's own), anything under prisma/.
  if (parts.some((p) => p.startsWith('.') || p === 'node_modules')) return false;
  // Vitest reads __mocks__ (automatic mocks) and __snapshots__ (stored
  // expectations): both would let app files decide what a test sees.
  if (parts.some((p) => p === '__mocks__' || p === '__snapshots__')) return false;
  if (parts.some((p) => p === 'tests' || p === '__tests__') || TEST_FILE.test(file)) return false;
  if (parts[0] === 'prisma') return false;
  // A config file at any depth (a nested package.json "imports" map, a
  // tsconfig): never, whatever a task says.
  if (CONFIG_FILE.test(parts[parts.length - 1]!)) return false;
  if (task.grader.hidden.includes(file) || task.grader.preserved.includes(file)) return false;
  const under = (root: string) => {
    const r = root.replace(/\/+$/, '');
    return file === r || file.startsWith(`${r}/`);
  };
  if (!AGENT_WRITABLE_ROOTS.some(under)) return false;
  // Source code and styles only, unless the task names a narrower path under
  // a source root whose other files its fix needs (an icon, a JSON catalog).
  return SOURCE_FILE.test(file) || (task.grader.allowPaths ?? []).some(under);
}

// Every file of a grading tree that is not agent-writable comes from the base
// (or, for hidden tests, from the fix commit) and is hash-checked before every
// grading run.
export function isProtected(file: string, task: GraderSpec): boolean {
  return !isAgentWritable(file, task);
}

export function tamperViolations(
  changed: (Change & { content: string | null })[],
  task: GraderSpec,
): string[] {
  const allowed = new Set<TamperRuleId>(task.grader.allowTamperRules ?? []);
  const out: string[] = [];
  for (const { file, kind, content, status } of changed) {
    if (status !== 'deleted' && kind !== 'file') {
      out.push(`${file}: the agent created a ${kind} (only regular files are accepted)`);
      continue;
    }
    // Outside the allowlist: recorded and never copied into a grading tree.
    if (!isAgentWritable(file, task)) {
      out.push(`${file}: outside the agent-writable paths (not copied into grading)`);
      continue;
    }
    if (content === null) continue;
    // Allowed application code still runs inside the test process: screen it.
    for (const rule of TAMPER_RULES)
      if (!allowed.has(rule.id) && rule.pattern.test(content))
        out.push(`${file}: application code ${rule.why}`);
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

// --- the harness canary --------------------------------------------------------
//
// Allowed application code runs inside the test process, so a file-level
// allowlist cannot stop it from changing the framework that judges it: a module
// the base setup imports can call expect.extend, or the module under test can
// replace Object.is, and every hidden assertion passes (reviews of #455). The
// static screen is only an early signal. The canary DETECTS that class instead
// of enumerating it: harness files, written into every grading tree like the
// hidden tests (outside the agent's reach, hash-checked), named per run.
//
// Identity, not behaviour, is the core check. A grader-owned wrapper config
// PREPENDS a setup file to the base setup files, so it runs before any
// application module is imported. It records the function references of every
// own property of chai's Assertion prototype, chai's assert, expect and its
// statics, the matcher and equality-tester registries, the test globals, and
// the built-ins the matchers rely on (Object.is, Array/String/RegExp methods,
// JSON, Function.prototype, ...). For the unit tier it first applies the base
// setup's own jest-dom extension, so those matchers are part of the record.
// A later setup file and hooks compare against that record after the base
// setup, before and after every test, and after the file: any replaced, added
// or removed entry is a canary failure, whatever it does and however selective
// it is (by value type, by caller, by .not). Behavioural probes stay as a
// second, independent check. A standalone test whose title carries this run's
// nonce proves the canary ran at all; a run without it is a fail.
//
// What it does not cover (stated as residual risks in the README): application
// code that special-cases the hidden tests' own inputs, tampering with globals
// or built-ins outside the record, and a change installed and fully undone
// within a single test between two checks.
export const CANARY_FAILURE = 'harness integrity check failed';
export const CANARY_TITLE = 'harness integrity';

export interface Canary {
  id: string;
  nonce: string;
  files: Map<string, Buffer>;
}

export function canaryPaths(id: string): {
  guard: string;
  preUnit: string;
  preIntegration: string;
  setup: string;
  test: string;
  unitConfig: string;
  integrationConfig: string;
} {
  return {
    guard: `x${id}.guard.ts`,
    preUnit: `x${id}.pre-unit.ts`,
    preIntegration: `x${id}.pre-integration.ts`,
    setup: `x${id}.setup.ts`,
    test: `x${id}.test.ts`,
    // .ts, like the base configs: vite loads them without writing a bundled
    // copy into node_modules/.vite-temp, which is read-only in grading.
    unitConfig: `x${id}.unit.ts`,
    integrationConfig: `x${id}.integration.ts`,
  };
}

// The record: evaluated when the guard module is first imported, which is the
// first setup file, before any application code. Every helper it uses is
// captured into a local first, so a later change to a built-in cannot blind it.
const CANARY_GUARD = `
import { assert, chai, expect, vi } from 'vitest';

const FAIL = ${JSON.stringify(CANARY_FAILURE)};
const gOPD = Object.getOwnPropertyDescriptor;
const ownKeys = Reflect.ownKeys;
const nullObject = Object.create.bind(null, null) as () => Record<string, unknown>;
const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty) as (
  o: object,
  k: string,
) => boolean;
// chai keeps per-object state in a data property named __flags, created lazily
// on whatever object a flag is first set (the vitest expect included, during a
// test file): state, not a function, so it is left out of the record.
const STATE_KEYS = ['__flags'];
const isState = (k: string | symbol) => {
  for (let i = 0; i < STATE_KEYS.length; i += 1) if (k === STATE_KEYS[i]) return true;
  return false;
};
const toStr = String;
const objectIs = Object.is;
const MATCHERS = Symbol.for('$$jest-matchers-object');
const G = globalThis as unknown as Record<string | symbol, unknown>;
const registry = G[MATCHERS] as Record<string, unknown> | undefined;

type Target = [string, unknown, (string | symbol)[] | null];
const TARGETS: Target[] = [
  ['chai', chai, ['Assertion', 'assert', 'expect', 'use', 'util', 'config']],
  ['chai.Assertion.prototype', chai.Assertion.prototype, null],
  ['chai.assert', assert, null],
  ['expect', expect, null],
  ['vi', vi, ['fn', 'spyOn', 'mock', 'isMockFunction']],
  ['matchers registry', registry, ['matchers', 'customEqualityTesters']],
  ['matchers', registry ? registry.matchers : undefined, null],
  ['equality testers', registry ? registry.customEqualityTesters : undefined, null],
  [
    'globalThis',
    G,
    [MATCHERS, 'expect', 'vi', 'vitest', 'assert', 'chai', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'it', 'test', 'describe'],
  ],
  ['Object', Object, ['is', 'keys', 'entries', 'values', 'getOwnPropertyNames', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'defineProperty', 'assign', 'freeze']],
  ['Reflect', Reflect, ['ownKeys', 'getOwnPropertyDescriptor', 'apply', 'get', 'has']],
  ['Array', Array, ['isArray', 'from']],
  ['Array.prototype', Array.prototype, ['includes', 'indexOf', 'some', 'every', 'map', 'filter', 'find', 'join', 'sort', 'length']],
  ['String', String, ['raw']],
  ['String.prototype', String.prototype, ['includes', 'indexOf', 'startsWith', 'endsWith', 'match', 'toString', 'trim', 'valueOf']],
  ['RegExp.prototype', RegExp.prototype, ['test', 'exec']],
  ['JSON', JSON, ['stringify', 'parse']],
  ['Function.prototype', Function.prototype, ['toString', 'call', 'apply', 'bind']],
  ['Symbol', Symbol, ['for']],
  ['Number', Number, ['isNaN', 'isFinite']],
  ['Math', Math, ['abs', 'max', 'min']],
];

type Entry = [string, unknown];
function snapshot(): Entry[] {
  const out: Entry[] = [];
  for (let t = 0; t < TARGETS.length; t += 1) {
    const label = TARGETS[t]![0];
    const obj = TARGETS[t]![1];
    if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) {
      out[out.length] = [label, obj];
      continue;
    }
    const listed = TARGETS[t]![2];
    const all = listed ?? ownKeys(obj as object);
    const keys: (string | symbol)[] = [];
    for (let k = 0; k < all.length; k += 1) if (listed || !isState(all[k]!)) keys[keys.length] = all[k]!;
    for (let k = 0; k < keys.length; k += 1) {
      const name = label + '.' + toStr(keys[k]);
      const d = gOPD(obj as object, keys[k]!);
      if (!d) {
        out[out.length] = [name, undefined];
        continue;
      }
      out[out.length] = [name + ':value', d.value];
      out[out.length] = [name + ':get', d.get];
      out[out.length] = [name + ':set', d.set];
    }
  }
  return out;
}

const RECORD = snapshot();

const recorded = nullObject();
for (let i = 0; i < RECORD.length; i += 1) recorded[RECORD[i]![0]] = RECORD[i]![1];

export function check(where: string): void {
  const now = snapshot();
  const seen = nullObject();
  const changed: string[] = [];
  for (let i = 0; i < now.length; i += 1) {
    const name = now[i]![0];
    seen[name] = true;
    if (!hasOwn(recorded, name)) changed[changed.length] = name + ' (added)';
    else if (!objectIs(now[i]![1], recorded[name])) changed[changed.length] = name;
  }
  for (let i = 0; i < RECORD.length; i += 1)
    if (!hasOwn(seen, RECORD[i]![0])) changed[changed.length] = RECORD[i]![0] + ' (removed)';
  if (changed.length) {
    let list = '';
    for (let i = 0; i < changed.length && i < 12; i += 1) list += (i ? ', ' : '') + changed[i];
    throw new Error(FAIL + ' (' + where + '): changed since before the base setup: ' + list);
  }
}
`;

const CANARY_PROBE = `
const FAIL = ${JSON.stringify(CANARY_FAILURE)};
const nonce = process.env.EVAL_CANARY_NONCE ?? '';
const seed = (parseInt(nonce.slice(0, 6) || '1', 16) % 9973) + 3;
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
export function probe(where: string): void {
  const a = seed;
  const b = seed + 1 + (seed % 5);
  const s = 'v' + a;
  const t = 'w' + b;
  const problems: string[] = [];
  const must = (ok: boolean, what: string) => {
    if (!ok) problems.push(what);
  };
  must(throws(() => expect(a).toBe(b)), 'toBe accepts different numbers');
  must(!throws(() => expect(a).toBe(a)), 'toBe rejects equal numbers');
  must(throws(() => expect(s).toBe(t)), 'toBe accepts different strings');
  must(throws(() => expect(a).not.toBe(a)), 'not.toBe accepts equal values');
  must(!throws(() => expect(a).not.toBe(b)), 'not.toBe rejects different values');
  must(throws(() => expect({ v: a }).toEqual({ v: b })), 'toEqual accepts different objects');
  must(throws(() => expect(s).toEqual(t)), 'toEqual accepts different strings');
  must(throws(() => expect({ v: a }).toStrictEqual({ v: b })), 'toStrictEqual accepts different objects');
  must(throws(() => expect({ v: a }).toMatchObject({ v: b })), 'toMatchObject accepts a different object');
  must(throws(() => expect([a]).toContain(b)), 'toContain accepts a missing item');
  must(throws(() => expect(s).toContain(t)), 'toContain accepts a missing substring');
  must(throws(() => expect(s).not.toContain(s)), 'not.toContain accepts a present substring');
  must(throws(() => expect(s).toMatch(new RegExp(t))), 'toMatch accepts a non-matching string');
  must(throws(() => expect(s).toHaveLength(s.length + 1)), 'toHaveLength accepts a wrong length');
  must(throws(() => expect(0).toBeTruthy()), 'toBeTruthy accepts 0');
  must(throws(() => expect(a).toBeUndefined()), 'toBeUndefined accepts a number');
  must(throws(() => expect(a).toBeNull()), 'toBeNull accepts a number');
  must(throws(() => expect({ v: a }).toHaveProperty(t)), 'toHaveProperty accepts a missing key');
  must(throws(() => expect(() => a).toThrow()), 'toThrow accepts a function that does not throw');
  const spy = vi.fn();
  must(throws(() => expect(spy).toHaveBeenCalled()), 'toHaveBeenCalled accepts an uncalled spy');
  spy(a);
  must(throws(() => expect(spy).not.toHaveBeenCalled()), 'not.toHaveBeenCalled accepts a called spy');
  must(throws(() => expect(spy).toHaveBeenCalledWith(b)), 'toHaveBeenCalledWith accepts other arguments');
  must(throws(() => assert.strictEqual(a, b)), 'assert.strictEqual accepts different numbers');
  must(throws(() => assert.include(s, t)), 'assert.include accepts a missing substring');
  must(throws(() => chai.expect(a).to.equal(b)), 'chai expect accepts different numbers');
  must(throws(() => chai.expect(s).to.equal(t)), 'chai expect accepts different strings');
  must(
    Object.is(NaN, NaN) && !Object.is(0, -0) && !Object.is(a, b) && Object.is(a, a) && !Object.is(s, t),
    'Object.is altered',
  );
  must(s.includes('v') && !s.includes('w') && [a].includes(a) && ![a].includes(b), 'includes altered');
  if (problems.length) throw new Error(FAIL + ' (' + where + '): ' + problems.join('; '));
}
`;

export function canaryFiles(id: string): Map<string, Buffer> {
  const p = canaryPaths(id);
  const head = `// Harness-owned integrity canary (evals/maintainer, runner.ts canaryFiles).\n`;
  const guard = head + CANARY_GUARD;
  // The first setup files of each tier: record before any application code.
  // The unit tier applies the base setup's jest-dom extension first, so its
  // matchers are in the record; the base setup's own import of it is then a
  // cached module and adds nothing.
  const preUnit =
    head +
    `import '@testing-library/jest-dom/vitest';\nimport { check } from './${p.guard}';\ncheck('first setup');\n`;
  const preIntegration = head + `import { check } from './${p.guard}';\ncheck('first setup');\n`;
  const setup =
    head +
    `import { afterAll, afterEach, assert, beforeAll, beforeEach, chai, expect, vi } from 'vitest';\n` +
    `import { check } from './${p.guard}';\n` +
    CANARY_PROBE +
    `check('after the base setup');\n` +
    `probe('after the base setup');\n` +
    `beforeAll(() => check('before the file'));\n` +
    `beforeEach(() => check('before a test'));\n` +
    `afterEach(() => check('after a test'));\n` +
    `afterAll(() => {\n  check('after the file');\n  probe('after the file');\n});\n`;
  const test =
    head +
    `import { assert, chai, expect, it, vi } from 'vitest';\n` +
    `import { check } from './${p.guard}';\n` +
    CANARY_PROBE +
    `it(${JSON.stringify(`${CANARY_TITLE} `)} + nonce, () => {\n` +
    `  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new Error(FAIL + ': no nonce');\n` +
    `  check('inside a test');\n` +
    `  probe('inside a test');\n` +
    `  const before = expect.getState().assertionCalls;\n` +
    `  expect(seed).toBe(seed);\n` +
    `  if (expect.getState().assertionCalls !== before + 1) throw new Error(FAIL + ': assertions are not counted');\n` +
    `});\n`;
  // The grader-owned wrapper: the base config with the canary's first setup
  // file PREPENDED and its later setup file appended around the base setup
  // files, and the canary test included. Built explicitly rather than merged,
  // because mergeConfig would append the first setup file after the base ones.
  const config = (base: string, pre: string) =>
    `// Grader-owned wrapper (evals/maintainer, runner.ts canaryFiles).\n` +
    `import { mergeConfig } from 'vitest/config';\n` +
    `import base from './${base}';\n` +
    `const baseSetup = base.test?.setupFiles ?? [];\n` +
    `const merged = mergeConfig(base, { test: { include: ['${p.test}'], isolate: true } });\n` +
    `merged.test = {\n` +
    `  ...merged.test,\n` +
    `  setupFiles: ['./${pre}', ...(Array.isArray(baseSetup) ? baseSetup : [baseSetup]), './${p.setup}'],\n` +
    `};\n` +
    `export default merged;\n`;
  return new Map([
    [p.guard, Buffer.from(guard)],
    [p.preUnit, Buffer.from(preUnit)],
    [p.preIntegration, Buffer.from(preIntegration)],
    [p.setup, Buffer.from(setup)],
    [p.test, Buffer.from(test)],
    [p.unitConfig, Buffer.from(config('vitest.config', p.preUnit))],
    [p.integrationConfig, Buffer.from(config('vitest.integration.config', p.preIntegration))],
  ]);
}

export function newCanary(): Canary {
  const id = randomBytes(6).toString('hex');
  return { id, nonce: randomBytes(16).toString('hex'), files: canaryFiles(id) };
}

// Vitest's JSON reporter output, reduced to the counts the outcome needs and
// the canary's state. An unreadable or missing report yields nulls: that is an
// infrastructure error.
export function summariseVitestReport(
  raw: string | null,
  nonce: string,
): {
  passed: number | null;
  failed: number | null;
  failedSuites: number | null;
  canary: 'ok' | 'failed' | 'missing' | null;
} {
  const unreadable = { passed: null, failed: null, failedSuites: null, canary: null };
  if (raw === null) return unreadable;
  try {
    const report = JSON.parse(raw) as Record<string, unknown>;
    const num = (k: string) => (typeof report[k] === 'number' ? (report[k] as number) : null);
    const files = Array.isArray(report.testResults)
      ? (report.testResults as { message?: unknown; assertionResults?: unknown }[])
      : [];
    const title = `${CANARY_TITLE} ${nonce}`;
    let found = false;
    let failed = false;
    for (const file of files) {
      if (typeof file.message === 'string' && file.message.includes(CANARY_FAILURE)) failed = true;
      const tests = Array.isArray(file.assertionResults)
        ? (file.assertionResults as {
            title?: unknown;
            status?: unknown;
            failureMessages?: unknown;
          }[])
        : [];
      for (const t of tests) {
        if (
          Array.isArray(t.failureMessages) &&
          t.failureMessages.some((m) => typeof m === 'string' && m.includes(CANARY_FAILURE))
        )
          failed = true;
        if (t.title === title) {
          found = true;
          if (t.status !== 'passed') failed = true;
        }
      }
    }
    return {
      passed: num('numPassedTests'),
      failed: num('numFailedTests'),
      failedSuites: num('numFailedTestSuites'),
      canary: failed ? 'failed' : found ? 'ok' : 'missing',
    };
  } catch {
    return unreadable;
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

// The canary findings of a set of runs, as tamper violations for the result.
export function canaryViolations(runs: (TestRun & { label: string })[]): string[] {
  return runs
    .filter((r) => r.canary === 'failed' || r.canary === 'missing')
    .map(
      (r) =>
        `${r.label} ${r.tier}: canary-${r.canary} (the test framework was altered in-process, or the canary did not run)`,
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
  // A failed or missing canary means the framework was altered in-process:
  // a fail (canaryViolations reports it), never a pass.
  if (runs.some((r) => r.canary !== 'ok')) return 'fail';

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

// How the grading tree is built from the agent's changes. Grading never runs in
// the agent's workspace: it runs in a copy of the untouched snapshot onto which
// only the agent's allowlisted regular files are written (or deleted). Every
// other change is left out (`ignored`) and recorded as a tamper violation.
export function planGrade(
  changes: Change[],
  task: GraderSpec,
): { write: string[]; remove: string[]; ignored: string[] } {
  const write: string[] = [];
  const remove: string[] = [];
  const ignored: string[] = [];
  for (const change of changes) {
    if (!isAgentWritable(change.file, task)) {
      ignored.push(change.file);
      continue;
    }
    if (change.status === 'deleted') remove.push(change.file);
    else if (change.kind === 'file') write.push(change.file);
  }
  return { write, remove, ignored };
}

// The tools are called as node scripts from the read-only install, never
// through npx or npm: npm reads a project .npmrc and copies its node-options
// into NODE_OPTIONS (review of #455), so no package manager runs in a grading
// container at all.
export const PRISMA_CLI = ['node', 'node_modules/prisma/build/index.js'] as const;
export const VITEST_CLI = ['node', 'node_modules/vitest/vitest.mjs'] as const;

// A marker that the tamper self-checks' cheat code writes if it ever runs; the
// runner fails closed when it finds one after a grading step.
export const TAMPER_MARKER = '.eval-tamper-marker';

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
    // Docker passes only the listed variables; an empty NODE_OPTIONS also
    // overrides anything the image could set.
    NODE_OPTIONS: '',
  };
}

// Environment of a grading container, built from nothing: no proxy, no
// credential, no npm_config_*, an empty NODE_OPTIONS, and for the integration
// tier one vitest worker (a worker cap above 1 overrides the integration
// config's fileParallelism: false, lesson L33).
export function gradeEnv(
  databaseUrl: string | null,
  canaryNonce: string | null = null,
): Record<string, string> {
  const env: Record<string, string> = {
    HOME: '/tmp/home',
    CI: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: '',
  };
  if (canaryNonce) env.EVAL_CANARY_NONCE = canaryNonce;
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

// Leftovers of earlier runs (containers, networks, /dev/shm homes) to remove at
// start: only names of this harness, and only once older than any run could
// last, so a concurrent run is never touched. An unknown creation time keeps
// the resource (fail safe: a leak is better than killing a live run).
export function staleEvalResources(
  entries: { name: string; createdMs: number }[],
  nowMs: number,
  maxAgeMs: number,
): string[] {
  return entries
    .filter(
      (e) =>
        e.name.startsWith('gymcoach-eval-') &&
        Number.isFinite(e.createdMs) &&
        nowMs - e.createdMs > maxAgeMs,
    )
    .map((e) => e.name);
}
