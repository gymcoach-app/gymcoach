import {
  AI_ERROR_CODES_WITH_VARIABLE,
  AI_ERROR_MESSAGE_KEYS,
  isAiErrorCode,
  isEnvVarName,
  type AiErrorMessageKey,
} from '@/lib/llm/error-codes';

// Client-side half of the AI error contract (issue #571). An AI route that
// could not get an answer from the provider returns
// { error: <English text>, code: 'ai_...', variable?: 'SOME_ENV_VAR' }.
// The code picks a translated message under `common.aiErrors`; `variable` is
// the name of the environment variable that message points at.

// The `common` translator, narrowed to what this helper calls.
export type AiErrorTranslator = (
  key: `aiErrors.${AiErrorMessageKey}`,
  values?: { variable: string },
) => string;

export interface AiErrorFields {
  code?: unknown;
  variable?: unknown;
}

// Translated message for a response body that carries a known AI error code,
// or null when it does not (the caller keeps its own fallback).
export function aiErrorMessage(common: AiErrorTranslator, body: AiErrorFields): string | null {
  if (!isAiErrorCode(body.code)) return null;
  const key = AI_ERROR_MESSAGE_KEYS[body.code];
  if (!AI_ERROR_CODES_WITH_VARIABLE.has(body.code)) return common(`aiErrors.${key}`);
  // A message that names a variable is useless without one.
  if (!isEnvVarName(body.variable)) return common('aiErrors.unknown');
  return common(`aiErrors.${key}`, { variable: body.variable });
}
