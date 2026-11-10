import { AnthropicProvider } from './anthropic';
import { CodexLbProvider } from './codex-lb';
import { OpenAiCompatibleProvider } from './openai-compatible';
import { OpenRouterProvider } from './openrouter';
import { DemoProvider } from './demo';
import type { LlmProvider } from './types';

export * from './types';
export type LlmProviderId = LlmProvider['id'];

// Reads LLM_PROVIDER (case-insensitive). Defaults to 'anthropic'; an
// unrecognized value also falls back to 'anthropic'. 'demo' serves canned
// responses (no key needed), useful to try the AI screens.
// 'openai-compatible' is any Chat Completions server behind a base URL (a
// local Ollama, LM Studio or vLLM, or another gateway).
export function resolveProviderId(): LlmProviderId {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (raw === 'codex-lb' || raw === 'codex_lb' || raw === 'codexlb') return 'codex-lb';
  if (raw === 'openrouter') return 'openrouter';
  if (raw === 'openai-compatible' || raw === 'openai_compatible' || raw === 'openaicompatible')
    return 'openai-compatible';
  if (raw === 'demo') return 'demo';
  return 'anthropic';
}

export function getLlmProvider(): LlmProvider {
  const id = resolveProviderId();
  if (id === 'codex-lb') return new CodexLbProvider();
  if (id === 'openrouter') return new OpenRouterProvider();
  if (id === 'openai-compatible') return new OpenAiCompatibleProvider();
  if (id === 'demo') return new DemoProvider();
  return new AnthropicProvider();
}
