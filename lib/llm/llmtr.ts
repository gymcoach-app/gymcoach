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

// LLMTR is a prepaid OpenAI-compatible gateway. Model IDs use the
// vendor/model form (see https://llmtr.com).
const DEFAULT_MODEL = 'qwen/qwen3.8-27b-free';
const ENDPOINT_URL = 'https://llmtr.com/v1/chat/completions';

// Optional floor on the output budget of every LLMTR call. Reasoning
// models spend tokens thinking before answering and count them against
// max_tokens, so the per-call budgets sized for plain chat models can
// truncate their answers. Set LLMTR_MAX_TOKENS (e.g. 100000) to give
// them room.
export function resolveLlmtrMaxTokens(requested: number | undefined): number {
  return resolveMaxTokensWithFloor(requested, process.env.LLMTR_MAX_TOKENS);
}

export class LlmtrProvider implements LlmProvider {
  readonly id = 'llmtr' as const;
  readonly label = 'LLMTR';
  readonly apiKeyEnvVar = 'LLMTR_API_KEY';
  readonly model: string;
  private readonly apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.LLMTR_API_KEY;
    this.model = process.env.LLMTR_MODEL?.trim() || DEFAULT_MODEL;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  private endpoint(): ChatCompletionsEndpoint {
    if (!this.apiKey) {
      throw new LlmError(503, 'LLMTR_API_KEY is not configured.', 'not_configured');
    }
    return {
      label: 'LLMTR',
      url: ENDPOINT_URL,
      model: this.model,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      resolveMaxTokens: resolveLlmtrMaxTokens,
      maxTokensEnvVar: 'LLMTR_MAX_TOKENS',
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
