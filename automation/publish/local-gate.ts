import type { TrustTier } from '@/automation/review/lenses';

// Local green gate on the reviewed head (#596 part A, lessons L55 and L61).
// Pure: the merge gate (gate.ts) calls evaluateLocalGate with what
// local-gate-collect.ts read from the local run ledger and proved with git.
//
// The rule "never open or update a PR for merge on a red gate" lived in prose
// only, and #587 was merged with six red local runs and no green one on its
// head. The gate now refuses a maintainer-authored PR unless the ledger
// (automation/ledger/record-verify.cjs, one `verify` line per scripts/verify.sh
// run) holds a green run of the required tier on the content of the approved
// head, or of a head the gate already carries review records from (a pure
// base update or an identical-diff carry-over, gate.ts).
//
// What counts as "on the content of a head": the line's tree SHA, recorded
// only when the files were the same before the first step and at exit
// (`treeChanged: false`), is the tree of that head commit, or that tree plus
// exactly one added root entry, a symlink named `node_modules` (an agent
// worktree links the main checkout's install; `.gitignore` ignores the
// directory form only, so such a run is recorded `dirty: true`). The tree is
// the evidence, not the line's `headSha`: the gate usually runs before the
// commit, so HEAD is then the parent while the tree is already the commit's.
//
// Which runs are verdicts: a green run has exit 0, every recorded step passed,
// and the steps its tier promises are all there. A red run has a non-zero exit
// and a failed step other than the two lock waits (`slot`, `infra-lock`),
// during which none of the change's code runs. A run with no exit code (the
// gate's own shell died from a signal during a step) or with no failed step is
// no verdict either way. Only that: when a signal kills a step's child while
// the shell survives, the step fails like any other and the run is red, which
// fails safe (a later green run clears it).
//
// A red run newer than a green one on the same content refuses: the latest
// verdict decides, as for a CI rerun (gate.ts, "the latest one decides"). The
// same tree that passed and then failed has a test that depends on something
// other than the tree (load, order, time); L61 says that red is red until it
// is explained and a later run is green. "Same content" spans every head that
// counts: a red run on an older carried head that is newer than a green run
// on the approved head overrides it too (the PR's own content failed last).
// A red run on the approved head also overrides a green run on an older
// carried head whatever their times: it is the only local evidence about the
// merged-in base.
//
// The node_modules symlink match is refused for a green run when the diff
// touches `package.json` or `package-lock.json` (or its paths are unknown):
// the link points at another checkout's install, which the gate cannot see,
// so that run may have tested the old dependencies. Such a change is gated in
// a checkout with its own `npm ci` (a real, ignored `node_modules` directory:
// the trees are then equal). A red run through the link still counts.
//
// External authors (vetted or not) are exempt, and the decision says so: the
// execution gate of docs/loops/10-external-contributions.md forbids running
// their code on the host, so no such ledger line may exist; CI is their only
// executor. Authorship comes from GitHub (the pulls API user id).
//
// The ledger is a local file the loop itself writes. Like the review records
// posted from the shared maintainer account, this check prevents slips (a
// push on a red or missing run), not forgery.

export type GateTier = 'default' | 'full';

export type LedgerState =
  // verifyLines: valid `verify` lines read; skippedLines: lines of that kind
  // (or unparsable ones) the schema rejected, which never count.
  | { status: 'ok'; path: string; verifyLines: number; skippedLines: number }
  // GYMCOACH_USAGE_LEDGER=off in the gate's environment.
  | { status: 'disabled' }
  | { status: 'missing'; path: string }
  | { status: 'unreadable'; path: string; error: string };

export interface RunStep {
  name: string;
  outcome: string; // passed | failed | interrupted
}

export type TreeMatch = 'tree' | 'tree-plus-node-modules-symlink';

// One ledger `verify` line whose recorded tree git matched to a head.
export interface MatchedRun {
  // 1-based line number in the ledger file.
  line: number;
  at: string;
  tier: GateTier;
  exit: number | null;
  steps: RunStep[];
  // HEAD when the gate ran (the parent, for a run made before the commit).
  headSha: string | null;
  treeSha: string;
  dirty: boolean | null;
  // The head whose content the run checked, and how the trees compare.
  head: string;
  match: TreeMatch;
}

export interface LocalGateEvidence {
  ledger: LedgerState;
  // The tree of each head git was asked about.
  heads: { head: string; tree: string }[];
  runs: MatchedRun[];
  // Near misses, for a refusal's detail: runs started at one of the heads
  // whose files changed while the gate ran, and runs at one of the heads on a
  // dirty tree whose tree object is not in this repository (another clone, or
  // collected by git gc), so the difference could not be read.
  changedDuringRun: number;
  treeAbsent: number;
  // Set when git could not answer. The gate refuses: it never guesses.
  error: string | null;
}

export type LocalGateRefusalCode =
  | 'local-gate-ledger-disabled'
  | 'local-gate-ledger-missing'
  | 'local-gate-ledger-unreadable'
  | 'local-gate-unverified'
  | 'local-gate-missing'
  | 'local-gate-red';

export type LocalGateReport =
  | { required: 'none'; reason: string }
  | {
      required: GateTier;
      reason: string;
      ledgerPath: string;
      // The ledger line that allowed the merge.
      accepted: MatchedRun;
    };

export type LocalGateResult =
  | { ok: true; report: LocalGateReport }
  | { ok: false; code: LocalGateRefusalCode; detail: string };

export interface LocalGateInput {
  evidence: LocalGateEvidence;
  approvedSha: string;
  // Older heads that reach the approved head through merges of the base
  // branch git proved (gate.ts carriedHeads and identicalDiffCarries).
  carriedHeads: readonly string[];
  // Why git could not verify the pure base updates, when it could not.
  carryError?: string | null;
  // The paths the approved SHA changes, or null when git could not read them.
  changedPaths: readonly string[] | null;
  authorTier: TrustTier;
}

// Docs-only rule. A path is documentation when it is anywhere under `docs/`
// (the playbook, guides, screenshots, media, the committed baseline data), or
// is a Markdown file at the repository root or under a directory that holds no
// application code: `.claude/` (skills), `.github/` (templates),
// `automation/`, `changelog.d/`, `evals/`. A Markdown file anywhere else
// (`app/`, `lib/`, `public/`, `prisma/`, `messages/`, ...) is not: it sits
// where the app is built, served or seeded from, so the full tier applies. An
// allowlist, so a new directory is "code" until it is listed here.
//
// Why the default tier is enough for such a diff: the two tiers `--full` adds
// (integration and E2E) exercise the built app against Postgres and a browser
// and read none of these files. The default tier still reads them: unit tests
// parse the policy and the baseline under `docs/`, the changelog fragments are
// checked, and the build proves nothing else moved. So a docs-only PR is never
// exempt, it is only spared the tiers that cannot see its diff.
const DOCS_MARKDOWN_ROOTS = ['.claude/', '.github/', 'automation/', 'changelog.d/', 'evals/'];

export function isLocalGateDocsPath(path: string): boolean {
  if (path.startsWith('docs/')) return true;
  if (!path.toLowerCase().endsWith('.md')) return false;
  return !path.includes('/') || DOCS_MARKDOWN_ROOTS.some((root) => path.startsWith(root));
}

// Unknown paths (git could not read them) or an empty diff need the full tier.
export function requiredTier(changedPaths: readonly string[] | null): GateTier {
  if (changedPaths === null || changedPaths.length === 0) return 'full';
  return changedPaths.every(isLocalGateDocsPath) ? 'default' : 'full';
}

const DEFAULT_STEPS = ['lint', 'typecheck', 'unit', 'build'];
const FULL_STEPS = [...DEFAULT_STEPS, 'integration', 'e2e'];
// Waits for a machine-wide lock: none of the change's code runs in them.
const LOCK_STEPS = ['slot', 'infra-lock'];

export function isGreenRun(run: MatchedRun): boolean {
  if (run.exit !== 0) return false;
  if (run.steps.some((s) => s.outcome !== 'passed')) return false;
  const passed = new Set(run.steps.map((s) => s.name));
  return (run.tier === 'full' ? FULL_STEPS : DEFAULT_STEPS).every((name) => passed.has(name));
}

export function isRedRun(run: MatchedRun): boolean {
  if (run.exit === null || run.exit === 0) return false;
  return run.steps.some((s) => s.outcome === 'failed' && !LOCK_STEPS.includes(s.name));
}

// Root manifests that decide what an install holds.
const INSTALL_MANIFESTS = ['package.json', 'package-lock.json'];

export function changesInstall(changedPaths: readonly string[] | null): boolean {
  return changedPaths === null || changedPaths.some((p) => INSTALL_MANIFESTS.includes(p));
}

const short = (sha: string) => sha.slice(0, 12);

// Ledger order: by time, then by position in the file.
function newer(a: MatchedRun, b: MatchedRun): boolean {
  const ta = Date.parse(a.at);
  const tb = Date.parse(b.at);
  return ta !== tb ? ta > tb : a.line > b.line;
}

export function describeRun(run: MatchedRun): string {
  const failed = run.steps.filter((s) => s.outcome === 'failed').map((s) => s.name);
  return (
    `line ${run.line} (verify, tier ${run.tier}, exit ${run.exit ?? 'none'}` +
    (failed.length ? `, failed at ${failed.join(', ')}` : '') +
    `, at ${run.at}, HEAD ${run.headSha ? short(run.headSha) : 'unknown'}, tree ${short(run.treeSha)}` +
    `, checked the content of ${short(run.head)}: ` +
    (run.match === 'tree'
      ? 'the same tree'
      : 'the same tree plus an untracked node_modules symlink') +
    ')'
  );
}

const how = (tier: GateTier) =>
  `run the gate on its own line on a checkout of that commit with the ledger on (\`bash scripts/verify.sh${tier === 'full' ? ' --full' : ''}\`, exit 0, an idle machine: lessons L55 and L61), then run the merge gate again; no flag waives this`;

export function evaluateLocalGate(input: LocalGateInput): LocalGateResult {
  const { evidence, approvedSha, authorTier } = input;
  if (authorTier !== 'maintainer') {
    return {
      ok: true,
      report: {
        required: 'none',
        reason: `the author is not a maintainer (tier ${authorTier}${authorTier === 'unvetted' ? ', which includes an unknown author' : ''}): external code is never run on this host, CI is its only executor (docs/loops/10-external-contributions.md)`,
      },
    };
  }
  const no = (code: LocalGateRefusalCode, detail: string): LocalGateResult => ({
    ok: false,
    code,
    detail,
  });
  const tier = requiredTier(input.changedPaths);
  const HOW = how(tier);
  const { ledger } = evidence;
  if (ledger.status === 'disabled') {
    return no(
      'local-gate-ledger-disabled',
      `GYMCOACH_USAGE_LEDGER=off in this environment, so verify.sh records no run and the gate reads none: unset it, then ${HOW}`,
    );
  }
  if (ledger.status === 'missing') {
    return no(
      'local-gate-ledger-missing',
      `no run ledger at ${ledger.path} (GYMCOACH_USAGE_LEDGER_PATH, else \${XDG_DATA_HOME:-~/.local/share}/gymcoach-runs/ledger.jsonl): verify.sh never recorded a run for this user on this machine, or it ran with another HOME, XDG_DATA_HOME or ledger path. Use the same environment for both, then ${HOW}`,
    );
  }
  if (ledger.status === 'unreadable') {
    return no(
      'local-gate-ledger-unreadable',
      `the run ledger at ${ledger.path} could not be read (${ledger.error}): fix the file or its permissions, then ${HOW}`,
    );
  }
  if (evidence.error !== null) {
    return no(
      'local-gate-unverified',
      `could not compare the ledger's trees with git: ${evidence.error}`,
    );
  }

  const reason =
    tier === 'default'
      ? 'docs-only diff (every changed path is under docs/ or is Markdown outside the application directories): a green default-tier or full-tier run'
      : input.changedPaths === null
        ? 'the changed paths could not be read: a green full-tier run'
        : 'the diff changes code or configuration: a green full-tier run';
  const heads = [approvedSha, ...input.carriedHeads.filter((h) => h !== approvedSha)];
  const onContent = evidence.runs.filter((r) => heads.includes(r.head));
  const reds = onContent.filter(isRedRun);
  // A green run through the node_modules link proves nothing about a diff
  // that changes what the install must hold.
  const staleInstall = (r: MatchedRun) =>
    r.match === 'tree-plus-node-modules-symlink' && changesInstall(input.changedPaths);
  const greens = onContent
    .filter((r) => isGreenRun(r) && !staleInstall(r) && (tier === 'default' || r.tier === 'full'))
    .sort((a, b) => (newer(a, b) ? -1 : 1));
  // The red run that overrides a green one: newer on any of the heads, or on
  // the approved head when the green run is on an older, carried one.
  const overriding = (g: MatchedRun) =>
    reds.find((r) => newer(r, g) || (r.head === approvedSha && g.head !== approvedSha));

  const accepted = greens.find((g) => overriding(g) === undefined);
  if (accepted) {
    return { ok: true, report: { required: tier, reason, ledgerPath: ledger.path, accepted } };
  }
  const where =
    short(approvedSha) +
    (heads.length > 1
      ? ` or the head(s) its review records are carried from [${heads.slice(1).map(short).join(', ')}]`
      : '');
  if (greens.length > 0) {
    const g = greens[0]!;
    const r = overriding(g)!;
    return no(
      'local-gate-red',
      `the newest green ${tier === 'full' ? 'full-tier ' : ''}run on the content of ${where} is ledger ${describeRun(g)}, but ${describeRun(r)} failed ${r.head === approvedSha && g.head !== approvedSha && !newer(r, g) ? 'on the approved head itself' : 'after it'}: the latest verdict decides, a red gate is red (lesson L61). Find the cause (a timeout under load has one, lesson L42), then ${HOW}`,
    );
  }
  const hints: string[] = [];
  const linked = onContent.filter((r) => isGreenRun(r) && staleInstall(r));
  if (linked.length > 0) {
    hints.push(
      `ledger line ${linked.map((r) => r.line).join(', ')} is a green run through a node_modules symlink, but the diff ${input.changedPaths === null ? 'could not be read' : 'changes package.json or package-lock.json'}, so it may have tested another install: run the gate in a checkout with its own \`npm ci\``,
    );
  }
  if (input.carryError) {
    hints.push(`a run on an older head was not considered: git could not verify the base updates (${input.carryError})`);
  }
  const lowerTier = onContent.filter(
    (r) => isGreenRun(r) && !staleInstall(r) && r.tier === 'default',
  );
  if (tier === 'full' && lowerTier.length > 0) {
    hints.push(
      `ledger line ${lowerTier.map((r) => r.line).join(', ')} is a green default-tier run on that content, but the diff is not docs-only, so the full tier is required`,
    );
  }
  if (reds.length > 0) {
    hints.push(`${reds.length} failed run(s) on that content (line ${reds.map((r) => r.line).join(', ')})`);
  }
  if (evidence.changedDuringRun > 0) {
    hints.push(
      `${evidence.changedDuringRun} run(s) started at one of these commits had files change while the gate ran (treeChanged), so they prove nothing about a commit`,
    );
  }
  if (evidence.treeAbsent > 0) {
    hints.push(
      `${evidence.treeAbsent} run(s) at one of these commits checked a dirty tree whose objects are not in this repository (another clone, or collected by git gc), so the difference could not be read`,
    );
  }
  return no(
    'local-gate-missing',
    `${reason} is required, and ${ledger.path} (${ledger.verifyLines} verify line(s)) holds none on the content of ${where}` +
      (hints.length ? `; ${hints.join('; ')}` : '') +
      `. To proceed: ${HOW}`,
  );
}
