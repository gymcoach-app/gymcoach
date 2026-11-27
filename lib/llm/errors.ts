import {
  AI_ERROR_CODES,
  type AiErrorCode,
  type LlmFailureClass,
} from './error-codes';
import { LlmError, type LlmProvider } from './types';

// ============================================================
// Provider failure classification
// ============================================================
// One pure function turns whatever a provider path produced (an SDK error, a
// fetch rejection, an HTTP status with its body, an error object inside a 200
// response) into a small class. The class decides the message the user reads,
// the status the route answers with and the one line the server logs. The
// upstream body, headers and the request are read for classification only and
// never copied into the result.

export interface LlmFailure {
  class: LlmFailureClass;
  // Upstream HTTP status when there was one.
  status: number | null;
}

// Node / undici codes of a request that never got an HTTP answer.
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_ABORTED',
]);

// Error names of an aborted, timed out or unreachable request: fetch
// (AbortError, TimeoutError) and the Anthropic SDK connection errors.
const NETWORK_NAMES = new Set([
  'AbortError',
  'TimeoutError',
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'APIUserAbortError',
]);

// Error type / code strings, used when the failure carries no HTTP status (an
// error event inside a stream, an error object inside a 200 response).
const CODE_CLASSES: Record<string, LlmFailureClass> = {
  authentication_error: 'invalid_key',
  invalid_api_key: 'invalid_key',
  permission_error: 'invalid_key',
  rate_limit_error: 'quota',
  rate_limit_exceeded: 'quota',
  insufficient_quota: 'quota',
  billing_error: 'quota',
  not_found_error: 'model',
  model_not_found: 'model',
  invalid_request_error: 'model',
  request_too_large: 'model',
  overloaded_error: 'outage',
  api_error: 'outage',
  server_error: 'outage',
  timeout_error: 'timeout',
};

// Some providers report exhausted credits as a 400 or a 403 (Anthropic:
// "Your credit balance is too low", status 400).
const QUOTA_HINT =
  /credit balance|insufficient[ _]quota|insufficient credits|insufficient funds|exceeded your current quota|payment required/i;

const NETWORK_TEXT = /fetch failed|connection error|timed out|network (error|failure)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

interface Signal {
  status: number | null;
  names: string[];
  codes: string[];
  text: string;
}

function readSignal(input: unknown): Signal {
  const signal: Signal = { status: null, names: [], codes: [], text: '' };
  if (!isRecord(input)) return signal;

  const status = input.status;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
    signal.status = status;
  }

  const name = str(input.name);
  if (name) signal.names.push(name);
  const ctor = str((input as { constructor?: { name?: unknown } }).constructor?.name);
  if (ctor) signal.names.push(ctor);

  const texts: string[] = [];
  // The object itself, then the bodies nested in it: the Anthropic SDK keeps
  // the parsed response in `error` ({ type: 'error', error: { type, message } }),
  // the OpenAI wire format nests one level ({ error: { code, type, message } }).
  const layers: unknown[] = [input, input.error, isRecord(input.error) ? input.error.error : null];
  for (const layer of layers) {
    if (!isRecord(layer)) continue;
    for (const key of ['code', 'type'] as const) {
      const value = str(layer[key]);
      if (value) signal.codes.push(value);
    }
    const message = str(layer.message);
    if (message) texts.push(message);
  }
  const body = str(input.body);
  if (body) texts.push(body);

  const cause = input.cause;
  if (isRecord(cause)) {
    const code = str(cause.code);
    if (code) signal.codes.push(code);
    const causeName = str(cause.name);
    if (causeName) signal.names.push(causeName);
  }

  signal.text = texts.join('\n');
  return signal;
}

function classOfStatus(status: number): LlmFailureClass {
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 402 || status === 429) return 'quota';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'outage';
  if (status >= 400) return 'model';
  return 'unknown';
}

// Accepts an Error (SDK, fetch, LlmError) or a plain description of an HTTP
// failure: { status?, body?, code?, type?, message? }.
export function classifyProviderFailure(input: unknown): LlmFailure {
  if (input instanceof LlmError && input.failure) {
    return { class: input.failure, status: statusOf(input.status) };
  }

  const signal = readSignal(input);
  const { status } = signal;

  if (status === null) {
    // An explicit error type from the provider wins over the transport clues.
    for (const code of signal.codes) {
      const known = CODE_CLASSES[code.toLowerCase()];
      if (known) return { class: known, status };
    }
    if (signal.names.some((n) => NETWORK_NAMES.has(n))) return { class: 'timeout', status };
    if (signal.codes.some((c) => NETWORK_CODES.has(c))) return { class: 'timeout', status };
    // By message, for when the name is of no help: undici rejects with a bare
    // TypeError('fetch failed'), and a minified server bundle renames the SDK
    // classes ("Connection error.", "Request timed out.").
    if (NETWORK_TEXT.test(signal.text)) return { class: 'timeout', status };
    if (QUOTA_HINT.test(signal.text)) return { class: 'quota', status };
    return { class: 'unknown', status };
  }

  if (status === 401) return { class: 'invalid_key', status };
  if (status < 500 && status >= 400) {
    const quotaCode = signal.codes.some((c) => CODE_CLASSES[c.toLowerCase()] === 'quota');
    if (quotaCode || QUOTA_HINT.test(signal.text)) return { class: 'quota', status };
  }
  return { class: classOfStatus(status), status };
}

function statusOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

// ============================================================
// What the route answers
// ============================================================

type ProviderId = LlmProvider['id'];

// Environment variable NAMES only. The values are never read here.
const KEY_VARIABLE: Record<ProviderId, string | null> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  llmtr: 'LLMTR_API_KEY',
  'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY',
  'codex-lb': 'CODEX_LB_API_KEY',
  demo: null,
};

const MODEL_VARIABLE: Record<ProviderId, string | null> = {
  anthropic: 'ANTHROPIC_MODEL',
  openrouter: 'OPENROUTER_MODEL',
  llmtr: 'LLMTR_MODEL',
  'openai-compatible': 'OPENAI_COMPATIBLE_MODEL',
  'codex-lb': 'CODEX_LB_MODEL',
  demo: null,
};

const MAX_TOKENS_VARIABLE: Record<ProviderId, string | null> = {
  anthropic: null,
  openrouter: 'OPENROUTER_MAX_TOKENS',
  llmtr: 'LLMTR_MAX_TOKENS',
  'openai-compatible': 'OPENAI_COMPATIBLE_MAX_TOKENS',
  'codex-lb': null,
  demo: null,
};

// English text of each class. `{variable}` is replaced by an environment
// variable name. The same sentences live in messages/en/common.ts
// (`aiErrors`), where the UI reads its translations; a unit test keeps the two
// in step.
export const AI_ERROR_MESSAGES: Record<LlmFailureClass, string> = {
  invalid_key:
    'The AI provider rejected the API key. Check {variable} in your .env and restart.',
  quota:
    'The AI provider refused the request: rate limit reached or credits used up. ' +
    'Wait a moment and retry, or check the credits of your provider account.',
  model:
    'The AI model rejected the request or returned an answer that could not be used. ' +
    'Check the model name in {variable}, or pick another model.',
  outage: 'The AI provider is unavailable right now. Try again later.',
  timeout:
    'The AI provider did not answer in time or could not be reached. Try again.',
  truncated:
    'The AI answer was cut off: the model ran out of output tokens. Raise {variable} or try again.',
  not_configured:
    'The AI provider is not configured correctly. Check {variable} in your .env and restart.',
  unknown: 'The AI request failed. Try again; if it keeps failing, check the server log.',
};

// Status the route answers with. Never 401/403/429: for the browser those
// mean "you are signed out" and "you are rate limited by this app", which is
// not what happened.
const HTTP_STATUS: Record<LlmFailureClass, number> = {
  invalid_key: 502,
  quota: 503,
  model: 502,
  outage: 503,
  timeout: 504,
  truncated: 502,
  not_configured: 503,
  unknown: 502,
};

export interface AiErrorBody {
  // English message, kept so a client that ignores `code` still shows text.
  error: string;
  code: AiErrorCode;
  // Name of the environment variable the message points at, when it has one.
  variable?: string;
}

export interface LlmFailureDescription extends LlmFailure {
  code: AiErrorCode;
  variable: string | null;
  message: string;
  httpStatus: number;
  body: AiErrorBody;
}

function variableFor(
  failureClass: LlmFailureClass,
  provider: Pick<LlmProvider, 'id' | 'apiKeyEnvVar'>,
): string | null {
  switch (failureClass) {
    case 'invalid_key':
      return KEY_VARIABLE[provider.id];
    case 'model':
      return MODEL_VARIABLE[provider.id];
    case 'truncated':
      return MAX_TOKENS_VARIABLE[provider.id];
    case 'not_configured':
      // The provider already knows which required setting is missing.
      return provider.apiKeyEnvVar || null;
    default:
      return null;
  }
}

export function describeLlmFailure(
  err: unknown,
  provider: Pick<LlmProvider, 'id' | 'apiKeyEnvVar'>,
): LlmFailureDescription {
  const failure = classifyProviderFailure(err);
  let failureClass = failure.class;
  let variable = variableFor(failureClass, provider);
  const template = AI_ERROR_MESSAGES[failureClass];
  // A message that needs a variable this provider does not have falls back to
  // the generic one instead of showing a hole.
  if (template.includes('{variable}') && !variable) {
    failureClass = 'unknown';
    variable = null;
  }
  const message = AI_ERROR_MESSAGES[failureClass].replace('{variable}', variable ?? '');
  const code = AI_ERROR_CODES[failureClass];
  return {
    class: failureClass,
    status: failure.status,
    code,
    variable,
    message,
    httpStatus: HTTP_STATUS[failureClass],
    body: { error: message, code, ...(variable ? { variable } : {}) },
  };
}

// The only trace of a provider failure in the server log: where, which
// provider, the class and the upstream status. No body, header or prompt.
export function logLlmFailure(
  scope: string,
  provider: Pick<LlmProvider, 'id'>,
  failure: LlmFailure,
): void {
  console.error(
    `[llm] ${scope}: provider call failed (provider=${provider.id} class=${failure.class} status=${failure.status ?? 'none'})`,
  );
}
