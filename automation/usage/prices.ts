// Anthropic first-party API list prices, USD per million tokens, used only to
// ESTIMATE an API-equivalent cost of recorded usage. The maintainer may run on
// a Claude subscription, so an estimate is not an amount billed.
//
// Source: the Claude API reference bundled with Claude Code (models table
// cached 2026-09-25; cache-read rates per model and the cache-write
// multipliers of 1.25x for the 5-minute TTL and 2x for the 1-hour TTL from its
// prompt-caching guide), checked 2026-10-13. A model absent from this table,
// or a response served at a non-standard speed, keeps its cost unknown.

export const PRICE_TABLE = {
  checkedAt: '2026-10-13',
  source:
    'Claude API reference bundled with Claude Code 2.1.292 (models table cached 2026-09-25; prompt-caching economics)',
} as const;

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

function price(input: number, output: number, cacheRead: number): ModelPrice {
  return { input, output, cacheRead, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2 };
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': price(10, 50, 0.25),
  'claude-opus-5-5': price(4, 20, 0.2),
  'claude-opus-5': price(5, 25, 0.5),
  'claude-haiku-4-5': price(1, 5, 0.1),
  'claude-haiku-4-5-20251001': price(1, 5, 0.1),
};

export interface PricedTokens {
  model: string;
  speed: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
}

// USD for one response, or null when no verified price applies.
export function responseCostUsd(
  t: PricedTokens,
  prices: Record<string, ModelPrice> = MODEL_PRICES,
): number | null {
  const p = prices[t.model];
  if (!p) return null;
  if (t.speed !== null && t.speed !== 'standard') return null;
  return (
    (t.input * p.input +
      t.output * p.output +
      t.cacheRead * p.cacheRead +
      t.cacheCreation5m * p.cacheWrite5m +
      t.cacheCreation1h * p.cacheWrite1h) /
    1_000_000
  );
}
