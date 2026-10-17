import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runBundleSchema } from '@/automation/records/schema';
import { buildUsageRecords } from '@/automation/usage/build';
import { headBranch, skillVersionAt } from '@/automation/usage/enrich';
import { PRICE_TABLE } from '@/automation/usage/prices';
import { USAGE_SCHEMA_VERSION, type UsageMeta } from '@/automation/usage/schema';
import { ledgerLineSchema } from '@/automation/ledger/schema';
import { localGateRecords } from '@/automation/ledger/verify';
import {
  countPrompts,
  hashRunBranches,
  ledgerToSessions,
  parseLedger,
} from '@/automation/ledger/attribute';

// Turns the run-time usage ledger into per-run usage records, in the same
// usage.jsonl / usage-meta.json shape as the transcript scan of #443
// (automation/usage/enrich.ts), for the runs of a collected baseline.
//
//   npx tsx automation/ledger/collect.ts --dir docs/loops/baseline/<date> \
//     --out <dir> [--ledger <path>]
//
// Read-only towards GitHub (`gh api` GETs for PR head branches and, when the
// commit is not in the local clone, head trees) and the ledger. Writes
// usage.jsonl and usage-meta.json, plus the local green-gate evidence per run
// (verify.jsonl and verify-meta.json, from the ledger's verify lines), into
// --out, never into --dir, so a baseline's transcript-derived usage is not
// overwritten.

const REPO = 'gymcoach-app/gymcoach';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : fallback;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function defaultLedger(): string {
  if (process.env.GYMCOACH_USAGE_LEDGER_PATH) return process.env.GYMCOACH_USAGE_LEDGER_PATH;
  const base = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(base, 'gymcoach-runs', 'ledger.jsonl');
}

// The tree of a PR's final head commit: from the local clone when it has the
// commit, else from GitHub; null when neither can tell.
function headTree(headSha: string): string | null {
  const ok = (v: string) => (/^[0-9a-f]{40}$/.test(v) ? v : null);
  try {
    return ok(
      execFileSync('git', ['rev-parse', '--verify', '-q', `${headSha}^{tree}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    // Not in the local clone.
  }
  try {
    const out = execFileSync('gh', ['api', `repos/${REPO}/git/commits/${headSha}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const tree = (JSON.parse(out) as { tree?: { sha?: string } }).tree?.sha;
    return typeof tree === 'string' ? ok(tree) : null;
  } catch {
    return null;
  }
}

function main() {
  const dir = arg('dir');
  const out = arg('out');
  const ledgerFile = arg('ledger', defaultLedger());
  if (!existsSync(ledgerFile)) throw new Error('No ledger at the given path');
  const { lines, invalid } = parseLedger(readFileSync(ledgerFile, 'utf8'), (raw) =>
    ledgerLineSchema.parse(raw),
  );
  const bundles = readFileSync(join(dir, 'runs.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => runBundleSchema.parse(JSON.parse(line)));
  const runs = hashRunBranches(
    bundles.map((b) => ({
      runId: b.run.runId,
      prNumber: b.run.prNumber,
      headBranch: headBranch(b.run.prNumber),
      createdAt: b.run.timestamps.createdAt,
      closedAt: b.run.timestamps.closedAt,
    })),
  );
  const gate = localGateRecords(
    lines,
    runs.map((r, i) => ({ ...r, headTreeSha: headTree(bundles[i]!.run.headSha) })),
  );
  const ledger = ledgerToSessions(lines);
  const result = buildUsageRecords({ sessions: ledger.sessions, runs, skillVersionAt });
  const usageMeta: UsageMeta = {
    schemaVersion: USAGE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    transcriptCoverage: result.coverage,
    sessionsScanned: {
      main: ledger.sessions.filter((s) => s.kind === 'main').length,
      subagent: ledger.sessions.filter((s) => s.kind === 'subagent').length,
    },
    subagentsAttributed: result.subagentsAttributed,
    subagentsUnattributed: result.subagentsUnattributed,
    duplicateResponses: result.duplicates,
    droppedResponses: result.droppedResponses,
    orchestration: result.orchestration,
    unattributedSubagents: result.unattributedSubagents,
    priceTable: { checkedAt: PRICE_TABLE.checkedAt, source: PRICE_TABLE.source },
    source: 'ledger',
    ledger: {
      invalidLines: invalid,
      supersededLines: ledger.superseded,
      forksWithUncheckedParent: ledger.forksWithUncheckedParent,
      prompts: countPrompts(lines),
    },
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'usage.jsonl'),
    result.records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  writeFileSync(join(out, 'usage-meta.json'), JSON.stringify(usageMeta, null, 2) + '\n');
  writeFileSync(
    join(out, 'verify.jsonl'),
    gate.records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  writeFileSync(
    join(out, 'verify-meta.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: usageMeta.generatedAt,
        recordingFrom: gate.recordingFrom,
        gateLines: gate.gateLines,
        attributed: gate.attributed,
        unattributed: gate.unattributed,
        ambiguous: gate.ambiguous,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Ledger: ${lines.length} lines (${invalid} invalid); ${result.subagentsAttributed} agents attributed, ${result.subagentsUnattributed} not; usage known for ${result.records.filter((r) => r.tokens.output.status === 'known').length} of ${result.records.length} runs; ${gate.gateLines} gate runs (${gate.attributed} attributed, ${gate.unattributed} not, ${gate.ambiguous} ambiguous).`,
  );
}

if (process.argv[1]?.endsWith('collect.ts')) main();
