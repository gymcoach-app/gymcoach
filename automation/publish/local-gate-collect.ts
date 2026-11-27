import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Git } from '@/automation/publish/base-update';
import { FULL_SHA } from '@/automation/publish/gate';
import type {
  LedgerState,
  LocalGateEvidence,
  MatchedRun,
  TreeMatch,
} from '@/automation/publish/local-gate';
import { type VerifyLine, verifyLineSchema } from '@/automation/ledger/schema';

// Reads the local run ledger and proves with git, in the trusted gate tree,
// which of its `verify` lines checked the content of the given heads (#596
// part A). The decision is local-gate.ts's; this module only gathers.
//
// The ledger is the file scripts/verify.sh appends to, resolved the same way
// as its writer (automation/ledger/record-verify.cjs): GYMCOACH_USAGE_LEDGER_PATH
// if set, else ${XDG_DATA_HOME:-~/.local/share}/gymcoach-runs/ledger.jsonl. It
// is per user and per machine, shared by every checkout and worktree, which is
// why a line is matched by the tree it checked (content-addressed) and never
// by a branch name or a path: a run made in any checkout of this content
// counts, and a run on other content cannot.

type Env = Record<string, string | undefined>;

export function ledgerFile(env: Env, home: string = homedir()): string {
  if (env.GYMCOACH_USAGE_LEDGER_PATH) return env.GYMCOACH_USAGE_LEDGER_PATH;
  const base = env.XDG_DATA_HOME || join(home, '.local', 'share');
  return join(base, 'gymcoach-runs', 'ledger.jsonl');
}

export interface LedgerVerifyLine {
  // 1-based line number in the file.
  line: number;
  verify: VerifyLine;
}

export interface LedgerRead {
  state: LedgerState;
  lines: LedgerVerifyLine[];
}

// Pure: the ledger text in, its valid `verify` lines out. Lines of other
// kinds are not this module's business; a line that is not JSON, or a `verify`
// line the schema rejects, is counted and never used.
export function parseVerifyLines(text: string): { lines: LedgerVerifyLine[]; skipped: number } {
  const lines: LedgerVerifyLine[] = [];
  let skipped = 0;
  for (const [index, raw] of text.split('\n').entries()) {
    if (raw.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      skipped += 1;
      continue;
    }
    if (typeof value !== 'object' || value === null) {
      skipped += 1;
      continue;
    }
    if ((value as { kind?: unknown }).kind !== 'verify') continue;
    const parsed = verifyLineSchema.safeParse(value);
    if (parsed.success) lines.push({ line: index + 1, verify: parsed.data });
    else skipped += 1;
  }
  return { lines, skipped };
}

export function readLedger(
  env: Env,
  read: (path: string) => string = (path) => readFileSync(path, 'utf8'),
  home: string = homedir(),
): LedgerRead {
  if ((env.GYMCOACH_USAGE_LEDGER ?? '').toLowerCase() === 'off') {
    return { state: { status: 'disabled' }, lines: [] };
  }
  const path = ledgerFile(env, home);
  let text: string;
  try {
    text = read(path);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') return { state: { status: 'missing', path }, lines: [] };
    const error = code ?? (err instanceof Error ? err.message.split('\n')[0]! : String(err));
    return { state: { status: 'unreadable', path, error }, lines: [] };
  }
  const { lines, skipped } = parseVerifyLines(text);
  return {
    state: { status: 'ok', path, verifyLines: lines.length, skippedLines: skipped },
    lines,
  };
}

class GitFailure extends Error {}

function must(git: Git, args: string[], input?: string): string {
  const r = git(args, input === undefined ? undefined : { input });
  if (r.status !== 0) {
    throw new GitFailure(`git ${args.join(' ')}: ${r.stderr.split('\n')[0] || `exit ${r.status}`}`);
  }
  return r.stdout;
}

// Which of the given objects are trees in the local repository (one git call).
function presentTrees(git: Git, shas: readonly string[]): Set<string> {
  if (shas.length === 0) return new Set();
  const out = must(git, ['cat-file', '--batch-check'], `${shas.join('\n')}\n`);
  const present = new Set<string>();
  for (const line of out.split('\n')) {
    const [sha, type] = line.split(' ');
    if (sha && type === 'tree') present.add(sha);
  }
  return present;
}

const PAIR = /^[0-9a-f]{40} [0-9a-f]{40}$/;
// The only difference accepted between a head's tree and a checked tree: one
// added root entry, a symlink (mode 120000) named node_modules. The diff is
// not recursive, so any other root entry that differs (a changed directory, an
// extra file) is a second line and refuses the match; a `node_modules`
// directory or file has another mode.
const SYMLINK_ONLY = /^:000000 120000 0{40} [0-9a-f]{40} A\tnode_modules$/;
const DIFF_BATCH = 200;

// The (head tree, checked tree) pairs whose only difference is the added
// node_modules symlink, as "headTree checkedTree" strings.
function symlinkOnlyPairs(
  git: Git,
  pairs: readonly [string, string][],
  batchSize: number,
): Set<string> {
  const proven = new Set<string>();
  for (let i = 0; i < pairs.length; i += batchSize) {
    const batch = pairs.slice(i, i + batchSize);
    const out = must(
      git,
      ['diff-tree', '--stdin', '--raw', '--no-abbrev', '--no-renames'],
      `${batch.map(([a, b]) => `${a} ${b}`).join('\n')}\n`,
    );
    // Each pair is echoed on its own line, followed by its raw entries (which
    // start with a colon, so an entry never reads as a pair).
    let pair: string | null = null;
    let entries: string[] = [];
    const close = () => {
      if (pair !== null && entries.length === 1 && SYMLINK_ONLY.test(entries[0]!)) {
        proven.add(pair);
      }
    };
    for (const line of out.split('\n')) {
      if (PAIR.test(line)) {
        close();
        pair = line;
        entries = [];
      } else if (line !== '') {
        entries.push(line);
      }
    }
    close();
  }
  return proven;
}

function toRun(l: LedgerVerifyLine, head: string, match: TreeMatch): MatchedRun {
  const v = l.verify;
  return {
    line: l.line,
    at: v.at,
    tier: v.tier,
    exit: v.exit,
    steps: v.steps.map((s) => ({ name: s.name, outcome: s.outcome })),
    headSha: v.headSha,
    treeSha: v.treeSha!,
    dirty: v.dirty,
    head,
    match,
  };
}

// Pure apart from the injected git: matches the ledger's lines to the heads.
// The head commits must already be in the local repository (merge.ts fetches
// the PR head first, changed-paths.ts).
export function matchRuns(
  git: Git,
  ledger: LedgerRead,
  heads: readonly string[],
  batchSize: number = DIFF_BATCH,
): LocalGateEvidence {
  const empty = { heads: [], runs: [], changedDuringRun: 0, treeAbsent: 0 };
  if (ledger.state.status !== 'ok') return { ledger: ledger.state, ...empty, error: null };
  try {
    const unique = [...new Set(heads)];
    const trees = unique.map((head) => {
      if (!FULL_SHA.test(head)) throw new GitFailure(`not a full SHA: ${head}`);
      const tree = must(git, ['rev-parse', '--verify', '-q', `${head}^{tree}`]);
      if (!FULL_SHA.test(tree)) throw new GitFailure(`unexpected tree for ${head}: ${tree}`);
      return { head, tree };
    });
    // A tree counts only when the files were the same before the first step
    // and at exit. Lines written before that comparison existed have no
    // `treeChanged` and never count.
    const stable = ledger.lines.filter(
      (l) => l.verify.treeChanged === false && l.verify.treeSha !== null,
    );
    const headTrees = new Set(trees.map((t) => t.tree));
    const runs: MatchedRun[] = [];
    for (const l of stable) {
      for (const t of trees) if (l.verify.treeSha === t.tree) runs.push(toRun(l, t.head, 'tree'));
    }
    // The other candidates: a dirty tree that is not a head's tree. Its
    // objects were written to the object store by the recorder (write-tree in
    // the checkout that ran the gate), so worktrees of this clone share them.
    const dirty = stable.filter(
      (l) => l.verify.dirty === true && !headTrees.has(l.verify.treeSha!),
    );
    const dirtyTrees = [...new Set(dirty.map((l) => l.verify.treeSha!))];
    const present = presentTrees(git, dirtyTrees);
    const readable = dirtyTrees.filter((t) => present.has(t));
    const proven = symlinkOnlyPairs(
      git,
      trees.flatMap((t) => readable.map((checked): [string, string] => [t.tree, checked])),
      batchSize,
    );
    for (const l of dirty) {
      for (const t of trees) {
        if (proven.has(`${t.tree} ${l.verify.treeSha!}`)) {
          runs.push(toRun(l, t.head, 'tree-plus-node-modules-symlink'));
        }
      }
    }
    const atHead = ledger.lines.filter(
      (l) => l.verify.headSha !== null && unique.includes(l.verify.headSha),
    );
    return {
      ledger: ledger.state,
      heads: trees,
      runs: runs.sort((a, b) => a.line - b.line),
      changedDuringRun: atHead.filter((l) => l.verify.treeChanged !== false).length,
      treeAbsent: atHead.filter((l) => dirty.includes(l) && !present.has(l.verify.treeSha!))
        .length,
      error: null,
    };
  } catch (err) {
    return {
      ledger: ledger.state,
      ...empty,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function collectLocalGate(
  git: Git,
  heads: readonly string[],
  env: Env = process.env,
): LocalGateEvidence {
  return matchRuns(git, readLedger(env), heads);
}
