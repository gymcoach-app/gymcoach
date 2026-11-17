import { classifyProviderFailure } from './errors';
import {
  LlmError,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmProvider,
} from './types';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8317/v1';
const DEFAULT_MODEL = 'gpt-5.6-sol';
const DEFAULT_MAX_TOKENS = 8000;
// Bounds the wait for response headers so a hung upstream cannot stall the
// request forever (issue #287). Non-streaming responses only send headers
// after the full generation, so this must cover a whole completion; the timer
// is cleared once headers arrive, leaving started streams uncapped.
const REQUEST_TIMEOUT_MS = 120_000;

interface ResponsesApiContent {
  type?: string;
  text?: string;
}

interface ResponsesApiOutput {
  content?: ResponsesApiContent[];
}

interface ResponsesApiResponse {
  model?: string;
  output_text?: string;
  output?: ResponsesApiOutput[];
  error?: { message?: string; code?: unknown; type?: unknown };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

export function extractCodexLbText(response: ResponsesApiResponse): string {
  if (response.output_text?.trim()) return response.output_text.trim();

  return (
    response.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text' || item.type === 'text')
      .map((item) => item.text ?? '')
      .join('')
      .trim() ?? ''
  );
}

// Parses a Responses API SSE line. Non-delta events and keep-alives are
// intentionally ignored.
export function extractCodexLbDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;

  const payload = trimmed.slice(5).trim();
  if (payload === '' || payload === '[DONE]') return null;

  try {
    const event = JSON.parse(payload) as {
      type?: string;
      delta?: string;
    };
    if (event.type !== 'response.output_text.delta') return null;
    return event.delta ?? null;
  } catch {
    return null;
  }
}

export class CodexLbProvider implements LlmProvider {
  readonly id = 'codex-lb' as const;
  readonly label = 'codex-lb';
  readonly apiKeyEnvVar = 'CODEX_LB_API_KEY';
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env.CODEX_LB_API_KEY?.trim();
    this.baseUrl = normalizeBaseUrl(process.env.CODEX_LB_BASE_URL?.trim() || DEFAULT_BASE_URL);
    this.model = process.env.CODEX_LB_MODEL?.trim() || DEFAULT_MODEL;
  }

  isConfigured(): boolean {
    return !!this.apiKey && !!this.baseUrl;
  }

  private buildBody(req: LlmCompletionRequest, stream: boolean) {
    return {
      model: this.model,
      instructions: req.system,
      input: req.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      max_output_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream,
    };
  }

  private async request(req: LlmCompletionRequest, stream: boolean): Promise<Response> {
    if (!this.apiKey) {
      throw new LlmError(503, 'CODEX_LB_API_KEY is not configured.', 'not_configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(this.buildBody(req, stream)),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LlmError(
          504,
          `codex-lb timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s.`,
          'timeout',
        );
      }
      const networkClass = classifyProviderFailure(error).class;
      throw new LlmError(
        502,
        `Network failure to codex-lb: ${error instanceof Error ? error.message : 'unknown'}`,
        // A fetch that rejects never got an HTTP answer.
        networkClass === 'unknown' ? 'timeout' : networkClass,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new LlmError(
        response.status,
        `codex-lb ${response.status}: ${text.slice(0, 500)}`,
        classifyProviderFailure({ status: response.status, body: text.slice(0, 2000) }).class,
      );
    }

    return response;
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const response = await this.request(req, false);
    const json = (await response.json()) as ResponsesApiResponse;
    if (json.error) {
      throw new LlmError(
        502,
        `codex-lb: ${json.error.message ?? 'unknown error'}`,
        classifyProviderFailure({
          code: json.error.code,
          type: json.error.type,
          message: json.error.message,
        }).class,
      );
    }

    const text = extractCodexLbText(json);
    if (!text) throw new LlmError(502, 'Empty response from the coach.', 'model');
    return { text, modelUsed: json.model ?? this.model };
  }

  async *stream(req: LlmCompletionRequest): AsyncIterable<string> {
    const response = await this.request(req, true);
    if (!response.body) {
      throw new LlmError(502, 'codex-lb returned no response body.', 'unknown');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const delta = extractCodexLbDelta(line);
        if (delta) yield delta;
      }
    }

    buffer += decoder.decode();
    const tail = extractCodexLbDelta(buffer);
    if (tail) yield tail;
  }
}
