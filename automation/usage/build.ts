import type { Measurement, Observation } from '@/automation/records/schema';
import { unknown } from '@/automation/records/schema';
import {
  type ModelPrice,
  MODEL_PRICES,
  type PricedTokens,
  responseCostUsd,
} from '@/automation/usage/prices';
import {
  type TokenTotals,
  USAGE_SCHEMA_VERSION,
  type UsageRecord,
  attributionRules,
} from '@/automation/usage/schema';

// Pure core: transcript JSONL lines in, per-run usage records out. Content is
// read in memory only to find PR references; nothing but numbers, model ids,
// skill names and enums leaves this module.

export type SessionKind = 'main' | 'subagent';

export interface SessionSummary {
  id: string;
  kind: SessionKind;
  // One entry per API response, keyed by response id, at its final usage.
  responses: Map<string, PricedTokens>;
  firstAt: string | null;
  lastAt: string | null;
  // Branches the session worked on from inside an agent worktree, minus the
  // default and detached states. A branch seen while the session sat in the
  // main checkout is whatever that checkout had checked out at the time, so
  // it says nothing about the session's own task.
  branches: Set<string>;
  // PR numbers named by the session's task prompt (subagents only).
  pullRefs: Set<number>;
  prRefs: Set<number>;
  // Skills invoked through the Skill tool.
  skills: Set<string>;
  // PR numbers the session recorded a link to (main sessions).
  prLinks: Set<number>;
  // Assistant records with a message but no response id, model or usage:
  // they cannot be counted, so they are dropped and the drop is reported.
  droppedResponses: number;
}

// Branches that say nothing about a task: the default branch, a detached
// HEAD, and the throwaway branch a fresh agent worktree starts on.
const NEUTRAL_BRANCH = /^(main|master|HEAD|worktree-agent-[0-9a-f]+)$/;

// Agent worktrees live under this directory; the main checkout does not.
const WORKTREE_DIR = '/.claude/worktrees/';

// Only Claude model ids are published; anything else is counted as "other",
// which has no price, so its cost stays unknown.
const MODEL_ID = /^claude-[a-z0-9.-]+$/;
export const OTHER_MODEL = 'other';

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  speed?: string;
}

// A token count the transcript did not record is unknown (NaN here), never 0.
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: { type?: string; text?: string }) =>
      block?.type === 'text' ? (block.text ?? '') : '',
    )
    .join('\n');
}

function numbers(text: string, pattern: RegExp): Set<number> {
  return new Set([...text.matchAll(pattern)].map((m) => Number(m[1])));
}

export function parseTranscript(id: string, kind: SessionKind, lines: string[]): SessionSummary {
  const summary: SessionSummary = {
    id,
    kind,
    responses: new Map(),
    firstAt: null,
    lastAt: null,
    branches: new Set(),
    pullRefs: new Set(),
    prRefs: new Set(),
    skills: new Set(),
    prLinks: new Set(),
    droppedResponses: 0,
  };
  let promptSeen = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const at = typeof record.timestamp === 'string' ? record.timestamp : null;
    if (at) {
      if (!summary.firstAt || at < summary.firstAt) summary.firstAt = at;
      if (!summary.lastAt || at > summary.lastAt) summary.lastAt = at;
    }
    const branch = record.gitBranch;
    const inWorktree = typeof record.cwd === 'string' && record.cwd.includes(WORKTREE_DIR);
    if (inWorktree && typeof branch === 'string' && branch && !NEUTRAL_BRANCH.test(branch))
      summary.branches.add(branch);
    if (record.type === 'pr-link' && typeof record.prNumber === 'number')
      summary.prLinks.add(record.prNumber);

    const message = record.message as
      | { id?: string; model?: string; usage?: RawUsage; content?: unknown }
      | undefined;
    if (record.type === 'user' && kind === 'subagent' && !promptSeen && !record.isMeta) {
      // The first user turn of a subagent is its task prompt.
      promptSeen = true;
      const text = textOf(message?.content);
      summary.pullRefs = numbers(text, /\bpull\/(\d+)\/head\b/g);
      summary.prRefs = numbers(text, /\bPR #(\d+)\b/g);
    }
    if (record.type !== 'assistant' || !message) continue;
    if (!message.id || !message.usage || !message.model) {
      summary.droppedResponses += 1;
      continue;
    }
    if (Array.isArray(message.content))
      for (const block of message.content as {
        type?: string;
        name?: string;
        input?: { skill?: unknown };
      }[])
        if (
          block?.type === 'tool_use' &&
          block.name === 'Skill' &&
          typeof block.input?.skill === 'string'
        )
          summary.skills.add(block.input.skill);
    const u = message.usage;
    const split = u.cache_creation;
    // Without the TTL split a cache write is unknown on both TTLs; a response
    // that wrote nothing to the cache (a recorded total of 0) has 0 on both.
    const noWrite = !split && u.cache_creation_input_tokens === 0;
    const tokens: PricedTokens = {
      model: MODEL_ID.test(message.model) ? message.model : OTHER_MODEL,
      speed: u.speed ?? null,
      input: count(u.input_tokens),
      output: count(u.output_tokens),
      cacheRead: count(u.cache_read_input_tokens),
      cacheCreation5m: noWrite ? 0 : count(split?.ephemeral_5m_input_tokens),
      cacheCreation1h: noWrite ? 0 : count(split?.ephemeral_1h_input_tokens),
    };
    // A response is logged once per streamed block; keep its final usage.
    const previous = summary.responses.get(message.id);
    if (!previous || !(tokens.output < previous.output)) summary.responses.set(message.id, tokens);
  }
  return summary;
}

export interface RunTarget {
  runId: string;
  prNumber: number;
  // The PR's head branch name, from GitHub; null when unknown.
  headBranch: string | null;
  createdAt: string;
  closedAt: string | null;
}

export type Attribution =
  | { status: 'attributed'; prNumber: number; rule: (typeof attributionRules)[number] }
  | { status: 'unattributed'; reason: string };

// A subagent is attributed only on verifiable evidence; anything ambiguous
// stays unattributed. Main sessions orchestrate many runs and are never
// attributed to one.
export function attributeSession(session: SessionSummary, runs: RunTarget[]): Attribution {
  if (session.kind === 'main') return { status: 'unattributed', reason: 'orchestrating session' };
  if (session.branches.size > 1) return { status: 'unattributed', reason: 'ambiguous evidence' };
  const byBranch =
    session.branches.size === 1
      ? runs.filter((r) => r.headBranch !== null && session.branches.has(r.headBranch))
      : [];
  const branchPr = byBranch.length === 1 ? byBranch[0]!.prNumber : null;
  // A session that worked on its own branch, and that branch is no run's head
  // branch, was doing other work: a PR it merely names is context.
  if (session.branches.size === 1 && branchPr === null)
    return { status: 'unattributed', reason: 'works on a branch that matches no run' };
  const refs = session.pullRefs.size > 0 ? session.pullRefs : session.prRefs;
  const refPr = refs.size === 1 ? [...refs][0]! : null;
  if (branchPr !== null && refPr !== null && branchPr !== refPr)
    return { status: 'unattributed', reason: 'branch and PR reference disagree' };
  if (branchPr !== null) return { status: 'attributed', prNumber: branchPr, rule: 'head-branch' };
  if (refPr !== null) {
    if (!runs.some((r) => r.prNumber === refPr))
      return { status: 'unattributed', reason: 'references a PR outside the baseline' };
    return { status: 'attributed', prNumber: refPr, rule: 'pr-reference' };
  }
  if (refs.size > 1) return { status: 'unattributed', reason: 'ambiguous evidence' };
  return { status: 'unattributed', reason: 'no branch or PR reference' };
}

export interface BuildUsageInput {
  sessions: SessionSummary[];
  runs: RunTarget[];
  // "skill@sha12" for the SKILL.md commit in effect at a time, or null.
  skillVersionAt: (skill: string, at: string) => string | null;
  prices?: Record<string, ModelPrice>;
  // Runs created within this many hours after the start of transcript
  // coverage may have work in sessions already removed by cleanup.
  partialMarginHours?: number;
}

export interface UsageTotals {
  sessions: number;
  responses: number;
  tokens: TokenTotals;
  estimatedCostUsd: Measurement;
}

export interface BuildUsageResult {
  records: UsageRecord[];
  subagentsAttributed: number;
  subagentsUnattributed: number;
  duplicates: { toOrchestration: number; toUnattributed: number };
  droppedResponses: number;
  orchestration: UsageTotals;
  unattributedSubagents: UsageTotals;
  coverage: { from: string | null; to: string | null };
}

const tokenKinds = ['input', 'output', 'cacheRead', 'cacheCreation5m', 'cacheCreation1h'] as const;
type TokenKind = (typeof tokenKinds)[number];

interface Tally {
  sessions: number;
  responses: number;
  tokens: Record<TokenKind, number>;
  // A kind with any unrecorded count is unknown as a whole.
  tokensKnown: Record<TokenKind, boolean>;
  cost: number;
  costKnown: boolean;
  models: Set<string>;
}

function tally(): Tally {
  return {
    sessions: 0,
    responses: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: 0 },
    tokensKnown: {
      input: true,
      output: true,
      cacheRead: true,
      cacheCreation5m: true,
      cacheCreation1h: true,
    },
    cost: 0,
    costKnown: true,
    models: new Set(),
  };
}

function addResponses(t: Tally, responses: PricedTokens[], prices: Record<string, ModelPrice>) {
  for (const r of responses) {
    t.responses += 1;
    t.models.add(r.model);
    let complete = true;
    for (const kind of tokenKinds) {
      if (Number.isNaN(r[kind])) {
        t.tokensKnown[kind] = false;
        complete = false;
      } else t.tokens[kind] += r[kind];
    }
    const cost = complete ? responseCostUsd(r, prices) : null;
    if (cost === null) t.costKnown = false;
    else t.cost += cost;
  }
}

function costOf(t: Tally): Measurement {
  if (t.sessions === 0) return unknown('no session');
  if (!t.costKnown)
    return unknown(
      'a model or speed without a verified price, or a token count the transcript did not record',
    );
  return { status: 'known', value: Math.round(t.cost * 10000) / 10000, unit: 'usd' };
}

function totals(t: Tally): UsageTotals {
  const tokens = Object.fromEntries(
    tokenKinds.map((k) => [k, t.tokensKnown[k] ? t.tokens[k] : null]),
  ) as TokenTotals;
  return { sessions: t.sessions, responses: t.responses, tokens, estimatedCostUsd: costOf(t) };
}

const tokenMeasure = (value: number): Measurement => ({ status: 'known', value, unit: 'tokens' });
const countMeasure = (value: number): Measurement => ({ status: 'known', value, unit: 'count' });

export function buildUsageRecords(input: BuildUsageInput): BuildUsageResult {
  const prices = input.prices ?? MODEL_PRICES;
  const marginMs = (input.partialMarginHours ?? 48) * 3600 * 1000;

  // Each API response is counted once. A response present in an orchestrating
  // transcript and in a subagent one (a fork copies its parent's turns) goes to
  // orchestration; one held by several subagents goes to the unattributed side.
  // The rule depends on who holds the response, not on file order.
  const holders = new Map<string, SessionSummary[]>();
  for (const s of input.sessions)
    for (const id of s.responses.keys()) holders.set(id, [...(holders.get(id) ?? []), s]);
  const duplicates = { toOrchestration: 0, toUnattributed: 0 };
  const owner = new Map<string, 'own' | 'orchestration' | 'unattributed'>();
  for (const [id, sessions] of holders) {
    if (sessions.length === 1) {
      owner.set(id, 'own');
      continue;
    }
    if (sessions.some((s) => s.kind === 'main')) {
      owner.set(id, 'orchestration');
      duplicates.toOrchestration += 1;
    } else {
      owner.set(id, 'unattributed');
      duplicates.toUnattributed += 1;
    }
  }

  let from: string | null = null;
  let to: string | null = null;
  let droppedResponses = 0;
  for (const s of input.sessions) {
    if (s.firstAt && (!from || s.firstAt < from)) from = s.firstAt;
    if (s.lastAt && (!to || s.lastAt > to)) to = s.lastAt;
    droppedResponses += s.droppedResponses;
  }

  const orchestration = tally();
  const unattributed = tally();
  const perRun = new Map<
    number,
    { tally: Tally; sessions: SessionSummary[]; byRule: Record<string, number> }
  >();
  // A shared response is counted under its first holder only.
  const sharedCounted = new Set<string>();
  const shared = (s: SessionSummary, side: 'orchestration' | 'unattributed') =>
    [...s.responses].flatMap(([id, t]) => {
      if (owner.get(id) !== side || sharedCounted.has(id)) return [];
      sharedCounted.add(id);
      return [t];
    });
  const own = (s: SessionSummary) =>
    [...s.responses].flatMap(([id, t]) => (owner.get(id) === 'own' ? [t] : []));

  let attributedCount = 0;
  let unattributedCount = 0;
  for (const s of input.sessions) {
    addResponses(orchestration, shared(s, 'orchestration'), prices);
    addResponses(unattributed, shared(s, 'unattributed'), prices);
    if (s.kind === 'main') {
      orchestration.sessions += 1;
      addResponses(orchestration, own(s), prices);
      continue;
    }
    const a = attributeSession(s, input.runs);
    if (a.status === 'unattributed') {
      unattributedCount += 1;
      unattributed.sessions += 1;
      addResponses(unattributed, own(s), prices);
      continue;
    }
    attributedCount += 1;
    const entry = perRun.get(a.prNumber) ?? {
      tally: tally(),
      sessions: [],
      byRule: Object.fromEntries(attributionRules.map((r) => [r, 0])),
    };
    entry.tally.sessions += 1;
    addResponses(entry.tally, own(s), prices);
    entry.sessions.push(s);
    entry.byRule[a.rule]! += 1;
    perRun.set(a.prNumber, entry);
  }

  const linked = new Map<number, number>();
  for (const s of input.sessions)
    if (s.kind === 'main') for (const pr of s.prLinks) linked.set(pr, (linked.get(pr) ?? 0) + 1);

  const records: UsageRecord[] = input.runs.map((run) => {
    const entry = perRun.get(run.prNumber);
    // Compare instants: GitHub and the transcripts format ISO times differently.
    const inCoverage =
      from !== null &&
      to !== null &&
      Date.parse(run.createdAt) <= Date.parse(to) &&
      (run.closedAt === null || Date.parse(run.closedAt) >= Date.parse(from));
    // Work on a run created soon after the start of coverage may sit in
    // sessions that cleanup had already removed.
    const possiblyPartial =
      inCoverage && from !== null && Date.parse(run.createdAt) < Date.parse(from) + marginMs;
    const none = inCoverage
      ? 'no subagent session attributable to this PR by head branch or PR reference'
      : 'no session transcript retained for this period';
    const orchestrators = linked.get(run.prNumber);
    const base = {
      schemaVersion: USAGE_SCHEMA_VERSION,
      runId: run.runId,
      prNumber: run.prNumber,
      possiblyPartial,
      orchestratorSessionsLinked: orchestrators
        ? countMeasure(orchestrators)
        : unknown(inCoverage ? 'no orchestrating session recorded a link to this PR' : none),
    };
    if (!entry)
      return {
        ...base,
        // Not 0: attribution is conservative, so an unattributed session may exist.
        subagentSessions: unknown(none),
        sessionsByRule: { 'head-branch': 0, 'pr-reference': 0 },
        tokens: {
          input: unknown(none),
          output: unknown(none),
          cacheRead: unknown(none),
          cacheCreation5m: unknown(none),
          cacheCreation1h: unknown(none),
        },
        estimatedCostUsd: unknown(none),
        agentDuration: unknown(none),
        models: unknown(none),
        skillVersion: unknown(none),
      };
    const t = entry.tally;
    const tokenOf = (kind: TokenKind): Measurement =>
      t.tokensKnown[kind]
        ? tokenMeasure(t.tokens[kind])
        : unknown('a response in the attributed sessions did not record this count');
    let seconds = 0;
    for (const s of entry.sessions)
      if (s.firstAt && s.lastAt) seconds += (Date.parse(s.lastAt) - Date.parse(s.firstAt)) / 1000;
    const versions = new Set<string>();
    for (const s of entry.sessions)
      for (const skill of s.skills) {
        const v = s.firstAt ? input.skillVersionAt(skill, s.firstAt) : null;
        if (v) versions.add(v);
      }
    const models: Observation = t.models.size
      ? {
          status: 'known',
          value: [...t.models].sort().join(', '),
          source: 'response model ids in attributed transcripts',
        }
      : unknown('attributed sessions made no API response');
    const skillVersion: Observation = versions.size
      ? {
          status: 'known',
          value: [...versions].sort().join(', '),
          source:
            'Skill tool call in an attributed session; SKILL.md commit in effect at session start',
        }
      : unknown('no skill invoked through the Skill tool in the attributed sessions');
    return {
      ...base,
      subagentSessions: countMeasure(entry.sessions.length),
      sessionsByRule: {
        'head-branch': entry.byRule['head-branch']!,
        'pr-reference': entry.byRule['pr-reference']!,
      },
      tokens: {
        input: tokenOf('input'),
        output: tokenOf('output'),
        cacheRead: tokenOf('cacheRead'),
        cacheCreation5m: tokenOf('cacheCreation5m'),
        cacheCreation1h: tokenOf('cacheCreation1h'),
      },
      estimatedCostUsd: costOf(t),
      agentDuration: { status: 'known', value: Math.round(seconds), unit: 'seconds' },
      models,
      skillVersion,
    };
  });

  return {
    records,
    subagentsAttributed: attributedCount,
    subagentsUnattributed: unattributedCount,
    duplicates,
    droppedResponses,
    orchestration: totals(orchestration),
    unattributedSubagents: totals(unattributed),
    coverage: { from, to },
  };
}
