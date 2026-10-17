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
// checked is the PR head's tree; and it ran before the PR closed. A branch
// match also needs the run to come after any earlier PR run on the same branch
// name closed, so a reused branch name does not pull in old lines. A gate run
// matching two PR runs is left out of the counts and counted as ambiguous.
//
// Unknown, never zero. Recording happens per checkout: a worktree created
// before the recorder merged runs an older verify.sh and writes nothing. So no
// count is ever reported as a known zero from absence alone: a PR run's counts
// are known only when at least one recorded gate run matches it (its checkout
// records), it was created after the first recorded gate run, and no ambiguous
// gate run touches it. finalHeadGreen is known true whenever a recorded green
// gate run checked the exact final head tree; known false only under the same
// conditions as the counts and when no matching green run left its tree
// unrecorded (an edit during the run, or an unreadable tree).

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
    // Whether a green gate run checked exactly the PR's final head tree, and
    // the highest tier that did. For a squash merge this is the merged content
    // only when the base did not move after the head was gated.
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
const NOT_SEEN =
  "no recorded verify.sh run matches this run's branch or head tree; its checkout may predate the recorder, so absence is not a zero";
const AMBIGUOUS =
  'a recorded gate run matches this run and another one, so the counts are not attributable';
const TREE_UNRECORDED =
  'a matching green gate run recorded no tree (files changed while it ran, or the tree could not be read)';

const count = (value: number): Measurement => ({ status: 'known', value, unit: 'count' });
const unknown = (reason: string): Measurement => ({ status: 'unknown', reason });
const time = (iso: string) => Date.parse(iso);

// The latest closing time of an earlier PR run on the same branch name: gate
// runs on that branch before it belong to the earlier run, not this one.
function branchFloor(run: GateRunTarget, runs: GateRunTarget[]): number {
  let floor = -Infinity;
  if (run.headBranch === null) return floor;
  for (const other of runs) {
    if (other.runId === run.runId || other.headBranch !== run.headBranch) continue;
    if (other.closedAt === null) continue;
    const closed = time(other.closedAt);
    if (closed <= time(run.createdAt) && closed > floor) floor = closed;
  }
  return floor;
}

function matches(line: VerifyLine, run: GateRunTarget, floor: number): boolean {
  const at = time(line.at);
  if (run.closedAt !== null && at > time(run.closedAt)) return false;
  const byBranch = line.branchHash !== null && line.branchHash === run.headBranch && at > floor;
  const byTree = line.treeSha !== null && line.treeSha === run.headTreeSha;
  return byBranch || byTree;
}

const green = (l: VerifyLine) => l.exit === 0;

export function localGateRecords(lines: LedgerLine[], runs: GateRunTarget[]): LocalGateResult {
  const gate = lines
    .filter((l): l is VerifyLine => l.kind === 'verify')
    .sort((a, b) => time(a.at) - time(b.at));
  const recordingFrom = gate.length > 0 ? gate[0]!.at : null;
  const floors = new Map(runs.map((r) => [r.runId, branchFloor(r, runs)]));

  // Every run a line matches, ambiguous or not; and the unambiguous ones.
  const touching = new Map<string, VerifyLine[]>(runs.map((r) => [r.runId, []]));
  const byRun = new Map<string, VerifyLine[]>(runs.map((r) => [r.runId, []]));
  const ambiguousRuns = new Set<string>();
  let unattributed = 0;
  let ambiguous = 0;
  for (const line of gate) {
    const hit = runs.filter((r) => matches(line, r, floors.get(r.runId)!));
    for (const r of hit) touching.get(r.runId)!.push(line);
    if (hit.length === 0) unattributed += 1;
    else if (hit.length > 1) {
      ambiguous += 1;
      for (const r of hit) ambiguousRuns.add(r.runId);
    } else byRun.get(hit[0]!.runId)!.push(line);
  }

  const records = runs.map((run): LocalGateRecord => {
    const base = {
      schemaVersion: LOCAL_GATE_SCHEMA_VERSION,
      runId: run.runId,
      prNumber: run.prNumber,
    };
    const seen = touching.get(run.runId)!;
    const reason =
      recordingFrom === null
        ? NO_RECORDING
        : time(run.createdAt) < time(recordingFrom)
          ? BEFORE_RECORDING
          : seen.length === 0
            ? NOT_SEEN
            : ambiguousRuns.has(run.runId)
              ? AMBIGUOUS
              : null;

    // Proof that the exact final head tree passed needs no attribution: the
    // tree identity is the evidence, wherever the gate ran.
    const onHead =
      run.headTreeSha === null
        ? []
        : gate.filter(
            (l) =>
              green(l) &&
              l.treeSha === run.headTreeSha &&
              (run.closedAt === null || time(l.at) <= time(run.closedAt)),
          );
    const finalHeadGreen: LocalGateRecord['finalHeadGreen'] =
      run.headTreeSha === null
        ? { status: 'unknown', reason: 'the tree of the final head commit could not be read' }
        : onHead.length > 0
          ? {
              status: 'known',
              value: true,
              tier: onHead.some((l) => l.tier === 'full') ? 'full' : 'default',
            }
          : reason !== null
            ? { status: 'unknown', reason }
            : seen.some((l) => green(l) && l.treeSha === null)
              ? { status: 'unknown', reason: TREE_UNRECORDED }
              : { status: 'known', value: false, tier: null };

    if (reason !== null) {
      return {
        ...base,
        gateRuns: unknown(reason),
        greenGateRuns: unknown(reason),
        greenFullGateRuns: unknown(reason),
        lastGreen: { status: 'unknown', reason },
        finalHeadGreen,
      };
    }
    const mine = byRun.get(run.runId)!;
    const greens = mine.filter(green);
    const last = greens[greens.length - 1];
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
      finalHeadGreen,
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
