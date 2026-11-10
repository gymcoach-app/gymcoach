import { LlmError, type LlmCompletionRequest, type LlmCompletionResult } from './types';

// Shared client for the OpenAI Chat Completions wire format (request body,
// response shape and SSE stream). OpenRouter and the generic
// openai-compatible provider both speak it; each passes its own endpoint,
// headers and wording, so neither leaks the other's settings.

export const DEFAULT_CHAT_MAX_TOKENS = 8000;

export interface ChatCompletionsEndpoint {
  // Name used in error messages ("OpenRouter", "the model server"). Its first
  // letter is capitalised where it opens a sentence.
  label: string;
  // Full URL of the chat/completions endpoint. Never put in an error message:
  // a self-hoster's base URL is theirs to disclose.
  url: string;
  model: string;
  headers: Record<string, string>;
  // Final max_tokens for a call, from the caller's requested budget.
  resolveMaxTokens: (requested: number | undefined) => number;
  // Env var named in the "cut off" hint.
  maxTokensEnvVar: string;
  // Values that must never appear in an error message (the API key). An
  // upstream that echoes the Authorization header back gets it masked.
  secrets?: readonly (string | undefined)[];
  // When true, a redirect is refused instead of followed: following one
  // would send the prompt (training data) and the key to a host the operator
  // did not name. Off for OpenRouter, whose endpoint is fixed.
  refuseRedirects?: boolean;
  // Hint appended to the redirect error (which variable to fix).
  redirectHint?: string;
}

// Optional floor on the output budget of every call. Reasoning models spend
// thousands of tokens thinking before answering and count them against
// max_tokens, so the per-call budgets sized for plain chat models truncate
// their answers mid-JSON. The floor raises a budget, never lowers it.
export function resolveMaxTokensWithFloor(
  requested: number | undefined,
  floorValue: string | undefined,
): number {
  const base = requested ?? DEFAULT_CHAT_MAX_TOKENS;
  const floor = Number.parseInt(floorValue ?? '', 10);
  return Number.isFinite(floor) && floor > 0 ? Math.max(base, floor) : base;
}

interface ChatCompletionsResponse {
  model?: string;
  choices?: Array<{ message?: { role: string; content: string }; finish_reason?: string }>;
  error?: { message?: unknown; code?: number | string };
}

// Parses one SSE line of a Chat Completions stream. Returns the text delta, or
// null for keep-alives, the [DONE] sentinel, and non-data lines.
export function extractChatCompletionsDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (payload === '' || payload === '[DONE]') return null;
  try {
    const json = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    return json.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

function sentence(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// An upstream error message is untrusted: it may be missing, or not a string.
function errorText(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (value == null) return 'unknown error';
  try {
    return JSON.stringify(value) ?? 'unknown error';
  } catch {
    return 'unknown error';
  }
}

function redact(text: string, secrets: ChatCompletionsEndpoint['secrets']): string {
  let out = text;
  for (const secret of secrets ?? []) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  return out;
}

async function post(
  endpoint: ChatCompletionsEndpoint,
  req: LlmCompletionRequest,
  stream: boolean,
): Promise<Response> {
  const body = {
    model: endpoint.model,
    messages: [
      { role: 'system', content: req.system },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    ...(req.temperature != null ? { temperature: req.temperature } : {}),
    max_tokens: endpoint.resolveMaxTokens(req.maxTokens),
    ...(stream ? { stream: true } : {}),
  };

  let res: Response;
  try {
    res = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...endpoint.headers },
      body: JSON.stringify(body),
      ...(endpoint.refuseRedirects ? { redirect: 'manual' as const } : {}),
    });
  } catch (err) {
    throw new LlmError(
      502,
      `Network failure to ${endpoint.label}: ${redact(
        err instanceof Error ? err.message : 'unknown',
        endpoint.secrets,
      )}`,
    );
  }

  if (
    endpoint.refuseRedirects &&
    (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400))
  ) {
    // The Location header is not repeated: it is the upstream's to disclose.
    throw new LlmError(
      502,
      `${sentence(endpoint.label)} answered with a redirect, which is not followed.` +
        (endpoint.redirectHint ? ` ${endpoint.redirectHint}` : ''),
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw new LlmError(
      res.status,
      `${sentence(endpoint.label)} ${res.status}: ${redact(text, endpoint.secrets).slice(0, 500)}`,
    );
  }
  return res;
}

export async function completeChat(
  endpoint: ChatCompletionsEndpoint,
  req: LlmCompletionRequest,
): Promise<LlmCompletionResult> {
  const res = await post(endpoint, req, false);

  let json: ChatCompletionsResponse;
  try {
    json = (await res.json()) as ChatCompletionsResponse;
  } catch {
    throw new LlmError(502, `${sentence(endpoint.label)} returned a response that is not JSON.`);
  }
  if (json.error) {
    throw new LlmError(
      502,
      `${sentence(endpoint.label)}: ${redact(errorText(json.error.message), endpoint.secrets).slice(0, 500)}`,
    );
  }
  const choice = json.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (choice?.finish_reason === 'length') {
    throw new LlmError(
      502,
      'The coach response was cut off: the model hit its output token budget ' +
        `(reasoning models count their thinking against it). Raise ${endpoint.maxTokensEnvVar} or retry.`,
    );
  }
  if (!text) {
    throw new LlmError(502, 'Empty response from the coach.');
  }
  return { text, modelUsed: json.model ?? endpoint.model };
}

export async function* streamChat(
  endpoint: ChatCompletionsEndpoint,
  req: LlmCompletionRequest,
): AsyncIterable<string> {
  const res = await post(endpoint, req, true);
  if (!res.body) {
    throw new LlmError(502, `${sentence(endpoint.label)} returned no response body.`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const delta = extractChatCompletionsDelta(line);
      if (delta) yield delta;
    }
  }
  const tail = extractChatCompletionsDelta(buffer);
  if (tail) yield tail;
}
