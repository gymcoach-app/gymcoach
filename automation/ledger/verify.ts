import { z } from 'zod';
import { measurementSchema, type Measurement } from '@/automation/records/schema';
import type { LedgerLine, VerifyLine } from '@/automation/ledger/schema';

// Pure: the ledger's "verify" lines (one per scripts/verify.sh run) in, the
// local green-gate evidence of each run out (roadmap milestone 1: attempts
// and verification evidence per run). Written as a side file, verify.jsonl,
// keyed by runId like usage.jsonl.
//
// Attribution, conservative like the usage rules: a gate run belongs to a PR
// run when its branch hash is the PR head branch's hash, or when the tree it
// checked is the PR head's tree; and it ran before the PR closed. A gate run
// matching two PR runs is left out and counted. A PR run created before the
// first recorded gate run has unknown counts, never 0: its earlier gate runs
// predate the recording.

export const LOCAL_GATE_SCHEMA_VERSION = 1 as const;

const sha = z.string().regex(/^[0-9a-f]{40}$/);
const tier = z.enum(['default', 'full']);

export const localGateRecordSchema = z
  .object({
    schemaVersion: z.literal(LOCAL_GATE_SCHEMA_VERSION),
    runId: z.string().min(1),
    prNumber: z.number().int().positive(),
    // verify.sh runs attributed to this PR run, green or not.
    gateRuns: measurementSchema,
    greenGateRuns: measurementSchema,
    greenFullGateRuns: measurementSchema,
    // The latest green gate run: the commit and tree it checked.
    lastGreen: z.discriminatedUnion('status', [
      z
        .object({
          status: z.literal('known'),
          at: z.string().datetime(),
          tier,
          headSha: sha.nullable(),
          treeSha: sha.nullable(),
          dirty: z.boolean().nullable(),
        })
        .strict(),
      // Known that no attributed gate run was green.
      z.object({ status: z.literal('none') }).strict(),
      z.object({ status: z.literal('unknown'), reason: z.string().min(1) }).strict(),
    ]),
    // Whether a green gate run checked exactly the PR's final head tree (for
    // a merged PR, what was merged), and the highest tier that did.
    finalHeadGreen: z.discriminatedUnion('status', [
      z.object({ status: z.literal('known'), value: z.boolean(), tier: tier.nullable() }).strict(),
      z.object({ status: z.literal('unknown'), reason: z.string().min(1) }).strict(),
    ]),
  })
  .strict();
export type LocalGateRecord = z.infer<typeof localGateRecordSchema>;

export interface GateRunTarget {
  runId: string;
  prNumber: number;
  // 16-hex hash of the PR head branch (attribute.ts hash16), or null.
  headBranch: string | null;
  // The tree of the PR's final head commit, or null when it could not be read.
  headTreeSha: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface LocalGateResult {
  records: LocalGateRecord[];
  // First recorded gate run: PR runs created before it have unknown counts.
  recordingFrom: string | null;
  gateLines: number;
  attributed: number;
  // Matched no PR run (work never opened as a PR, main, a review snapshot).
  unattributed: number;
  // Matched more than one PR run: left out.
  ambiguous: number;
}

const BEFORE_RECORDING =
  'the run was created before the first recorded verify.sh run, so earlier gate runs are not in the ledger';
const NO_RECORDING = 'no verify.sh run is recorded in the ledger';

const count = (value: number): Measurement => ({ status: 'known', value, unit: 'count' });
const unknown = (reason: string): Measurement => ({ status: 'unknown', reason });

function matches(line: VerifyLine, run: GateRunTarget): boolean {
  if (run.closedAt !== null && line.at > run.closedAt) return false;
  const byBranch = line.branchHash !== null && line.branchHash === run.headBranch;
  const byTree = line.treeSha !== null && line.treeSha === run.headTreeSha;
  return byBranch || byTree;
}

const green = (l: VerifyLine) => l.exit === 0;

export function localGateRecords(lines: LedgerLine[], runs: GateRunTarget[]): LocalGateResult {
  const gate = lines
    .filter((l): l is VerifyLine => l.kind === 'verify')
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const recordingFrom = gate.length > 0 ? gate[0]!.at : null;

  const byRun = new Map<string, VerifyLine[]>(runs.map((r) => [r.runId, []]));
  let unattributed = 0;
  let ambiguous = 0;
  for (const line of gate) {
    const hit = runs.filter((r) => matches(line, r));
    if (hit.length === 0) unattributed += 1;
    else if (hit.length > 1) ambiguous += 1;
    else byRun.get(hit[0]!.runId)!.push(line);
  }

  const records = runs.map((run): LocalGateRecord => {
    const base = { schemaVersion: LOCAL_GATE_SCHEMA_VERSION, runId: run.runId, prNumber: run.prNumber };
    const reason =
      recordingFrom === null ? NO_RECORDING : run.createdAt < recordingFrom ? BEFORE_RECORDING : null;
    if (reason !== null) {
      return {
        ...base,
        gateRuns: unknown(reason),
        greenGateRuns: unknown(reason),
        greenFullGateRuns: unknown(reason),
        lastGreen: { status: 'unknown', reason },
        finalHeadGreen: { status: 'unknown', reason },
      };
    }
    const mine = byRun.get(run.runId)!;
    const greens = mine.filter(green);
    const last = greens[greens.length - 1];
    const onHead =
      run.headTreeSha === null ? [] : greens.filter((l) => l.treeSha === run.headTreeSha);
    return {
      ...base,
      gateRuns: count(mine.length),
      greenGateRuns: count(greens.length),
      greenFullGateRuns: count(greens.filter((l) => l.tier === 'full').length),
      lastGreen: last
        ? {
            status: 'known',
            at: last.at,
            tier: last.tier,
            headSha: last.headSha,
            treeSha: last.treeSha,
            dirty: last.dirty,
          }
        : { status: 'none' },
      finalHeadGreen:
        run.headTreeSha === null
          ? { status: 'unknown', reason: 'the tree of the final head commit could not be read' }
          : {
              status: 'known',
              value: onHead.length > 0,
              tier:
                onHead.length === 0
                  ? null
                  : onHead.some((l) => l.tier === 'full')
                    ? 'full'
                    : 'default',
            },
    };
  });

  return {
    records,
    recordingFrom,
    gateLines: gate.length,
    attributed: gate.length - unattributed - ambiguous,
    unattributed,
    ambiguous,
  };
}
