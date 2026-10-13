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
  // Branches the session worked on, minus the default and detached states.
  branches: Set<string>;
  // PR numbers named by the session's task prompt (subagents only).
  pullRefs: Set<number>;
  prRefs: Set<number>;
  // Skills invoked through the Skill tool.
  skills: Set<string>;
  // PR numbers the session recorded a link to (main sessions).
  prLinks: Set<number>;
}

// Branches that say nothing about a task: the default branch, a detached
// HEAD, and the throwaway branch a fresh agent worktree starts on.
const NEUTRAL_BRANCH = /^(main|master|HEAD|worktree-agent-[0-9a-f]+)$/;

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  speed?: string;
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
    if (typeof branch === 'string' && branch && !NEUTRAL_BRANCH.test(branch))
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
    if (record.type !== 'assistant' || !message?.id || !message.usage || !message.model) continue;
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
    const tokens: PricedTokens = {
      model: message.model,
      speed: u.speed ?? null,
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      // Without the TTL split, the write is booked at the 5-minute rate only
      // when there was no cache write at all; otherwise the split is unknown.
      cacheCreation5m:
        split?.ephemeral_5m_input_tokens ?? (u.cache_creation_input_tokens ? Number.NaN : 0),
      cacheCreation1h: split?.ephemeral_1h_input_tokens ?? 0,
    };
    // A response is logged once per streamed block; keep its final usage.
    const previous = summary.responses.get(message.id);
    if (!previous || tokens.output >= previous.output) summary.responses.set(message.id, tokens);
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
  const byBranch =
    session.branches.size === 1
      ? runs.filter((r) => r.headBranch !== null && session.branches.has(r.headBranch))
      : [];
  const branchPr = byBranch.length === 1 ? byBranch[0]!.prNumber : null;
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
  if (refs.size > 1 || session.branches.size > 1)
    return { status: 'unattributed', reason: 'ambiguous evidence' };
  return { status: 'unattributed', reason: 'no branch or PR reference' };
}

export interface BuildUsageInput {
  sessions: SessionSummary[];
  runs: RunTarget[];
  // "skill@sha12" for the SKILL.md commit in effect at a time, or null.
  skillVersionAt: (skill: string, at: string) => string | null;
  prices?: Record<string, ModelPrice>;
}

export interface UsageTotals {
  sessions: number;
  tokens: TokenTotals;
  estimatedCostUsd: Measurement;
}

export interface BuildUsageResult {
  records: UsageRecord[];
  subagentsAttributed: number;
  subagentsUnattributed: number;
  duplicateResponses: number;
  orchestration: UsageTotals;
  unattributedSubagents: UsageTotals;
  coverage: { from: string | null; to: string | null };
}

const emptyTokens = (): TokenTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation5m: 0,
  cacheCreation1h: 0,
});

interface Tally {
  sessions: number;
  tokens: TokenTotals;
  splitKnown: boolean;
  cost: number;
  costKnown: boolean;
  models: Set<string>;
}

function tally(): Tally {
  return {
    sessions: 0,
    tokens: emptyTokens(),
    splitKnown: true,
    cost: 0,
    costKnown: true,
    models: new Set(),
  };
}

function add(t: Tally, responses: PricedTokens[], prices: Record<string, ModelPrice>) {
  t.sessions += 1;
  for (const r of responses) {
    t.models.add(r.model);
    t.tokens.input += r.input;
    t.tokens.output += r.output;
    t.tokens.cacheRead += r.cacheRead;
    if (Number.isNaN(r.cacheCreation5m)) t.splitKnown = false;
    else t.tokens.cacheCreation5m += r.cacheCreation5m;
    t.tokens.cacheCreation1h += r.cacheCreation1h;
    const cost = Number.isNaN(r.cacheCreation5m) ? null : responseCostUsd(r, prices);
    if (cost === null) t.costKnown = false;
    else t.cost += cost;
  }
}

function costOf(t: Tally): Measurement {
  if (t.sessions === 0) return unknown('no session');
  if (!t.costKnown)
    return unknown(
      'a model or speed without a verified price, or a cache write without its TTL split',
    );
  return { status: 'known', value: Math.round(t.cost * 10000) / 10000, unit: 'usd' };
}

function totals(t: Tally): UsageTotals {
  return { sessions: t.sessions, tokens: t.tokens, estimatedCostUsd: costOf(t) };
}

const tokenMeasure = (value: number): Measurement => ({ status: 'known', value, unit: 'tokens' });
const countMeasure = (value: number): Measurement => ({ status: 'known', value, unit: 'count' });

export function buildUsageRecords(input: BuildUsageInput): BuildUsageResult {
  const prices = input.prices ?? MODEL_PRICES;
  // Each API response is counted once, in the first transcript holding it.
  const seen = new Set<string>();
  let duplicateResponses = 0;
  const ownResponses = new Map<string, PricedTokens[]>();
  let from: string | null = null;
  let to: string | null = null;
  for (const s of input.sessions) {
    const own: PricedTokens[] = [];
    for (const [id, tokens] of s.responses) {
      if (seen.has(id)) {
        duplicateResponses += 1;
        continue;
      }
      seen.add(id);
      own.push(tokens);
    }
    ownResponses.set(s.id, own);
    if (s.firstAt && (!from || s.firstAt < from)) from = s.firstAt;
    if (s.lastAt && (!to || s.lastAt > to)) to = s.lastAt;
  }

  const orchestration = tally();
  const unattributed = tally();
  const perRun = new Map<
    number,
    { tally: Tally; sessions: SessionSummary[]; byRule: Record<string, number> }
  >();
  let attributedCount = 0;
  let unattributedCount = 0;
  for (const s of input.sessions) {
    const responses = ownResponses.get(s.id) ?? [];
    if (s.kind === 'main') {
      add(orchestration, responses, prices);
      continue;
    }
    const a = attributeSession(s, input.runs);
    if (a.status === 'unattributed') {
      unattributedCount += 1;
      add(unattributed, responses, prices);
      continue;
    }
    attributedCount += 1;
    const entry = perRun.get(a.prNumber) ?? {
      tally: tally(),
      sessions: [],
      byRule: Object.fromEntries(attributionRules.map((r) => [r, 0])),
    };
    add(entry.tally, responses, prices);
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
    const none = inCoverage
      ? 'no subagent session attributable to this PR by head branch or PR reference'
      : 'no session transcript retained for this period';
    const orchestrators = linked.get(run.prNumber);
    const base = {
      schemaVersion: USAGE_SCHEMA_VERSION,
      runId: run.runId,
      prNumber: run.prNumber,
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
    const split = t.splitKnown ? null : unknown('cache write recorded without its TTL split');
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
        input: tokenMeasure(t.tokens.input),
        output: tokenMeasure(t.tokens.output),
        cacheRead: tokenMeasure(t.tokens.cacheRead),
        cacheCreation5m: split ?? tokenMeasure(t.tokens.cacheCreation5m),
        cacheCreation1h: split ?? tokenMeasure(t.tokens.cacheCreation1h),
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
    duplicateResponses,
    orchestration: totals(orchestration),
    unattributedSubagents: totals(unattributed),
    coverage: { from, to },
  };
}
