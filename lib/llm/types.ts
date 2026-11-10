// ============================================================
// LLM provider abstraction
// ============================================================
// A minimal, provider-agnostic surface for Anthropic, OpenRouter, codex-lb,
// any OpenAI-compatible Chat Completions server, and the local demo provider. The active provider is selected at runtime
// from the LLM_PROVIDER env var (see ./index).

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionRequest {
  // Stable instructions. Providers that support prompt caching mark this as a
  // cache breakpoint.
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
  // Honored by providers that accept sampling params (OpenRouter and
  // openai-compatible). Ignored by the Anthropic provider: Claude Opus 4.7
  // rejects temperature/top_p/top_k.
  temperature?: number;
}

export interface LlmCompletionResult {
  text: string;
  modelUsed: string;
}

// Carries an HTTP-ish status so API routes can surface a meaningful code.
export class LlmError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmProvider {
  readonly id: 'anthropic' | 'openrouter' | 'openai-compatible' | 'codex-lb' | 'demo';
  // Human-friendly name and the env var holding the key, used by the UI to
  // tell the user what to configure when no key is present.
  readonly label: string;
  readonly apiKeyEnvVar: string;
  readonly model: string;
  isConfigured(): boolean;
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResult>;
  // Streams text deltas as they arrive. Same request shape as complete().
  stream(req: LlmCompletionRequest): AsyncIterable<string>;
}
