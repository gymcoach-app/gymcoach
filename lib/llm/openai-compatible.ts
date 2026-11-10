import {
  completeChat,
  resolveMaxTokensWithFloor,
  streamChat,
  type ChatCompletionsEndpoint,
} from './chat-completions';
import {
  LlmError,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmProvider,
} from './types';

// Generic OpenAI Chat Completions provider with a configurable base URL
// (LLM_PROVIDER=openai-compatible): a local model server (Ollama, LM Studio,
// vLLM, llama.cpp server) or any other Chat Completions gateway. Training and
// health data then go only to the host the self-hoster names.

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

// Validates OPENAI_COMPATIBLE_BASE_URL and returns it without trailing
// slashes. The reason never repeats the value: a rejected URL may hold
// credentials, and the reason ends up in a user-facing error.
export function validateOpenAiCompatibleBaseUrl(value: string | undefined): BaseUrlCheck {
  const raw = value?.trim() ?? '';
  if (!raw) return { ok: false, reason: 'OPENAI_COMPATIBLE_BASE_URL is not configured.' };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      ok: false,
      reason: 'OPENAI_COMPATIBLE_BASE_URL is not a valid URL. Use the form http://host:port/v1.',
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'OPENAI_COMPATIBLE_BASE_URL must start with http:// or https://.' };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      reason:
        'OPENAI_COMPATIBLE_BASE_URL must not contain credentials. ' +
        'Put the key in OPENAI_COMPATIBLE_API_KEY instead.',
    };
  }
  if (parsed.search || parsed.hash) {
    return {
      ok: false,
      reason: 'OPENAI_COMPATIBLE_BASE_URL must not contain a query string or a fragment.',
    };
  }
  return { ok: true, url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}` };
}

export function resolveOpenAiCompatibleMaxTokens(requested: number | undefined): number {
  return resolveMaxTokensWithFloor(requested, process.env.OPENAI_COMPATIBLE_MAX_TOKENS);
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id = 'openai-compatible' as const;
  readonly label = 'OpenAI-compatible endpoint';
  readonly model: string;
  // The variable the UI tells the user to set: whichever required one is
  // missing or invalid (the key is optional, local servers often need none).
  readonly apiKeyEnvVar: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: BaseUrlCheck;

  constructor() {
    // Checked once per provider instance, before any request is built: a bad
    // base URL fails with a clear message instead of a fetch to a wrong host.
    this.baseUrl = validateOpenAiCompatibleBaseUrl(process.env.OPENAI_COMPATIBLE_BASE_URL);
    this.model = process.env.OPENAI_COMPATIBLE_MODEL?.trim() ?? '';
    this.apiKey = process.env.OPENAI_COMPATIBLE_API_KEY?.trim() || undefined;
    this.apiKeyEnvVar =
      this.baseUrl.ok && !this.model ? 'OPENAI_COMPATIBLE_MODEL' : 'OPENAI_COMPATIBLE_BASE_URL';
  }

  isConfigured(): boolean {
    return this.baseUrl.ok && !!this.model;
  }

  private endpoint(): ChatCompletionsEndpoint {
    if (!this.baseUrl.ok) throw new LlmError(503, this.baseUrl.reason);
    if (!this.model) throw new LlmError(503, 'OPENAI_COMPATIBLE_MODEL is not configured.');
    return {
      label: 'The model server',
      url: `${this.baseUrl.url}/chat/completions`,
      model: this.model,
      // No Authorization header without a key, and no attribution headers.
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      resolveMaxTokens: resolveOpenAiCompatibleMaxTokens,
      maxTokensEnvVar: 'OPENAI_COMPATIBLE_MAX_TOKENS',
      secrets: [this.apiKey],
    };
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    return completeChat(this.endpoint(), req);
  }

  async *stream(req: LlmCompletionRequest): AsyncIterable<string> {
    yield* streamChat(this.endpoint(), req);
  }
}
