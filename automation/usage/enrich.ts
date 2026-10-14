import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBundleSchema } from '@/automation/records/schema';
import { type ReportMeta, renderReport } from '@/automation/baseline/report';
import { formatReport } from '@/automation/baseline/format';
import { type SessionSummary, buildUsageRecords, parseTranscript } from '@/automation/usage/build';
import { PRICE_TABLE } from '@/automation/usage/prices';
import { USAGE_SCHEMA_VERSION, type UsageMeta } from '@/automation/usage/schema';

// Adds agent usage to a collected baseline, from the local Claude Code session
// transcripts of this repository. Read-only towards GitHub (`gh api` GETs for
// PR head branches) and the transcripts; writes usage.jsonl and
// usage-meta.json into the baseline directory and re-renders report.md.
//
//   npx tsx automation/usage/enrich.ts --dir docs/loops/baseline/2026-10-13 \
//     --transcripts ~/.claude/projects/<project-slug>
//
// Privacy: transcripts are read in memory only (`cwd` only to tell an agent
// worktree from the main checkout, the first prompt only for PR numbers). The outputs hold per-run
// aggregates (token counts, estimated cost, durations, model ids, skill
// name@commit), never prompts, tool output, paths, branch names or session ids.

const REPO = 'gymcoach-app/gymcoach';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function readLines(file: string): string[] {
  return readFileSync(file, 'utf8').split('\n');
}

export function scanTranscripts(root: string): SessionSummary[] {
  const sessions: SessionSummary[] = [];
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry);
    if (entry.endsWith('.jsonl')) sessions.push(parseTranscript(entry, 'main', readLines(path)));
    const subagents = join(path, 'subagents');
    if (!existsSync(subagents)) continue;
    for (const file of readdirSync(subagents).sort())
      if (file.endsWith('.jsonl'))
        sessions.push(
          parseTranscript(`${entry}/${file}`, 'subagent', readLines(join(subagents, file))),
        );
  }
  return sessions;
}

export function skillVersionAt(skill: string, at: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(skill)) return null;
  const path = `.claude/skills/${skill}/SKILL.md`;
  const sha = execFileSync('git', ['log', '-1', '--format=%H', `--before=${at}`, '--', path], {
    encoding: 'utf8',
  }).trim();
  return sha ? `${skill}@${sha.slice(0, 12)}` : null;
}

export function headBranch(prNumber: number): string | null {
  const out = execFileSync('gh', ['api', `repos/${REPO}/pulls/${prNumber}`], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const ref = (JSON.parse(out) as { head?: { ref?: string } }).head?.ref;
  return typeof ref === 'string' && ref ? ref : null;
}

async function main() {
  const dir = arg('dir');
  const transcripts = arg('transcripts');
  const bundles = readLines(join(dir, 'runs.jsonl'))
    .filter(Boolean)
    .map((line) => runBundleSchema.parse(JSON.parse(line)));
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as ReportMeta;

  const runs = bundles.map((b) => ({
    runId: b.run.runId,
    prNumber: b.run.prNumber,
    headBranch: headBranch(b.run.prNumber),
    createdAt: b.run.timestamps.createdAt,
    closedAt: b.run.timestamps.closedAt,
  }));
  const sessions = scanTranscripts(transcripts);
  const result = buildUsageRecords({ sessions, runs, skillVersionAt });

  const usageMeta: UsageMeta = {
    schemaVersion: USAGE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    transcriptCoverage: result.coverage,
    sessionsScanned: {
      main: sessions.filter((s) => s.kind === 'main').length,
      subagent: sessions.filter((s) => s.kind === 'subagent').length,
    },
    subagentsAttributed: result.subagentsAttributed,
    subagentsUnattributed: result.subagentsUnattributed,
    duplicateResponses: result.duplicates,
    droppedResponses: result.droppedResponses,
    orchestration: result.orchestration,
    unattributedSubagents: result.unattributedSubagents,
    priceTable: { checkedAt: PRICE_TABLE.checkedAt, source: PRICE_TABLE.source },
  };

  writeFileSync(
    join(dir, 'usage.jsonl'),
    result.records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  writeFileSync(join(dir, 'usage-meta.json'), JSON.stringify(usageMeta, null, 2) + '\n');
  const reportPath = join(dir, 'report.md');
  writeFileSync(
    reportPath,
    await formatReport(
      renderReport(bundles, meta, { records: result.records, meta: usageMeta }),
      reportPath,
    ),
  );
  console.log(
    `Usage for ${result.records.filter((r) => r.tokens.output.status === 'known').length} of ${result.records.length} runs; ${result.subagentsAttributed} subagents attributed, ${result.subagentsUnattributed} not.`,
  );
}

if (process.argv[1]?.endsWith('enrich.ts')) void main();
