// Stable codes for a failed AI provider call. This file has no imports so a
// client component can use it without pulling a provider SDK into its bundle.
//
// The API returns the code next to the English `error` text; the UI maps it to
// a translated message (see lib/ai-error-message.ts).

export const LLM_FAILURE_CLASSES = [
  // The provider rejected the key (401/403).
  'invalid_key',
  // Rate limit or no credits left (429, 402, "credit balance too low").
  'quota',
  // Unknown model, bad request, or an answer that could not be used
  // (400/404/422, empty answer, structured output that failed validation).
  'model',
  // The provider is down or overloaded (5xx, 529).
  'outage',
  // No answer in time, or the provider could not be reached at all.
  'timeout',
  // The answer hit the output token budget.
  'truncated',
  // A required setting is missing or refused before any request is sent.
  'not_configured',
  'unknown',
] as const;

export type LlmFailureClass = (typeof LLM_FAILURE_CLASSES)[number];

export const AI_ERROR_CODES = {
  invalid_key: 'ai_invalid_key',
  quota: 'ai_quota',
  model: 'ai_model',
  outage: 'ai_outage',
  timeout: 'ai_timeout',
  truncated: 'ai_truncated',
  not_configured: 'ai_not_configured',
  unknown: 'ai_unknown',
} as const satisfies Record<LlmFailureClass, string>;

export type AiErrorCode = (typeof AI_ERROR_CODES)[LlmFailureClass];

// Key of the translated message under `common.aiErrors`.
export const AI_ERROR_MESSAGE_KEYS = {
  ai_invalid_key: 'invalidKey',
  ai_quota: 'quota',
  ai_model: 'model',
  ai_outage: 'outage',
  ai_timeout: 'timeout',
  ai_truncated: 'truncated',
  ai_not_configured: 'notConfigured',
  ai_unknown: 'unknown',
} as const satisfies Record<AiErrorCode, string>;

export type AiErrorMessageKey = (typeof AI_ERROR_MESSAGE_KEYS)[AiErrorCode];

// Codes whose message names an environment variable.
export const AI_ERROR_CODES_WITH_VARIABLE: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>([
  'ai_invalid_key',
  'ai_model',
  'ai_truncated',
  'ai_not_configured',
]);

export function isAiErrorCode(value: unknown): value is AiErrorCode {
  return typeof value === 'string' && Object.hasOwn(AI_ERROR_MESSAGE_KEYS, value);
}

// An environment variable NAME (never a value): upper-case letters, digits and
// underscores only, so nothing else can ride along in that field.
export function isEnvVarName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value);
}

// In-band marker for a failure after a text stream has started (the status
// line is already sent by then): "\n\n[error:<code>] <English message>" or
// "\n\n[error:<code>:<VARIABLE>] <English message>" at the very end.
export function formatStreamError(
  code: AiErrorCode,
  variable: string | null,
  message: string,
): string {
  return `\n\n[error:${code}${variable ? `:${variable}` : ''}] ${message}`;
}

const STREAM_ERROR_RE = /\n\n\[error:([a-z_]+)(?::([A-Z][A-Z0-9_]{1,63}))?\] [^\n]*$/;

export interface StreamError {
  // Text before the marker.
  text: string;
  code: AiErrorCode;
  variable: string | null;
}

export function parseStreamError(content: string): StreamError | null {
  const match = STREAM_ERROR_RE.exec(content);
  const code = match?.[1];
  if (!match || !isAiErrorCode(code)) return null;
  return { text: content.slice(0, match.index), code, variable: match[2] ?? null };
}
