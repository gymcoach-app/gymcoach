import {
  completeChat,
  extractChatCompletionsDelta,
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

// Any model exposed by OpenRouter, via its Chat Completions-compatible API.
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';
const ENDPOINT_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Optional floor on the output budget of every OpenRouter call. Reasoning
// models (e.g. z-ai/glm-5.3-flash) spend thousands of tokens thinking before
// answering and count them against max_tokens, so the per-call budgets sized
// for plain chat models truncate their answers mid-JSON. Set
// OPENROUTER_MAX_TOKENS (e.g. 100000) to give them room.
export function resolveOpenRouterMaxTokens(requested: number | undefined): number {
  return resolveMaxTokensWithFloor(requested, process.env.OPENROUTER_MAX_TOKENS);
}

// Parses one SSE line from OpenRouter's streaming response. Returns the text
// delta, or null for keep-alives, the [DONE] sentinel, and non-data lines.
export const extractOpenRouterDelta = extractChatCompletionsDelta;

export class OpenRouterProvider implements LlmProvider {
  readonly id = 'openrouter' as const;
  readonly label = 'OpenRouter';
  readonly apiKeyEnvVar = 'OPENROUTER_API_KEY';
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly appName: string;
  private readonly appUrl: string;

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY;
    this.model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
    this.appName = process.env.OPENROUTER_APP_NAME ?? 'GymCoach';
    this.appUrl = process.env.OPENROUTER_APP_URL ?? 'http://localhost:3030';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  private endpoint(): ChatCompletionsEndpoint {
    if (!this.apiKey) {
      throw new LlmError(503, 'OPENROUTER_API_KEY is not configured.');
    }
    return {
      label: 'OpenRouter',
      url: ENDPOINT_URL,
      model: this.model,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        // Attribution headers, specific to OpenRouter.
        'HTTP-Referer': this.appUrl,
        'X-Title': this.appName,
      },
      resolveMaxTokens: resolveOpenRouterMaxTokens,
      maxTokensEnvVar: 'OPENROUTER_MAX_TOKENS',
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
