import { afterEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import englishMessages from '@/messages/en';
import {
  AI_ERROR_CODES,
  AI_ERROR_MESSAGE_KEYS,
  LLM_FAILURE_CLASSES,
  formatStreamError,
  isAiErrorCode,
  isEnvVarName,
  parseStreamError,
} from './error-codes';
import {
  AI_ERROR_MESSAGES,
  classifyProviderFailure,
  describeLlmFailure,
  logLlmFailure,
} from './errors';
import { LlmError } from './types';

// A key-shaped value planted in the fake upstream errors: it must never come
// out of the classifier, the description or the log line.
const SECRET = 'sk-ant-api03-PLANTED-SECRET-VALUE';

// The real SDK error for an HTTP answer, built the way the SDK builds it.
function anthropicHttpError(status: number, type: string, message: string) {
  return Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type, message } },
    undefined,
    new Headers({ 'request-id': 'req_011CSHoEeqs5C35K2UUqR7Fy', 'x-api-key': SECRET }),
  );
}

// What undici's fetch rejects with when the socket never connects.
function fetchFailed(code: string): TypeError {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error(`connect ${code} 127.0.0.1:11434`), { code }),
  });
}

describe('classifyProviderFailure: invalid key', () => {
  it('Anthropic SDK 401 authentication_error', () => {
    const err = anthropicHttpError(401, 'authentication_error', 'invalid x-api-key');
    expect(classifyProviderFailure(err)).toEqual({ class: 'invalid_key', status: 401 });
  });

  it('Anthropic SDK 403 permission_error', () => {
    const err = anthropicHttpError(
      403,
      'permission_error',
      'Your API key does not have permission to use the specified resource.',
    );
    expect(classifyProviderFailure(err)).toEqual({ class: 'invalid_key', status: 403 });
  });

  it('OpenRouter 401 body', () => {
    const body = JSON.stringify({ error: { message: 'No auth credentials found', code: 401 } });
    expect(classifyProviderFailure({ status: 401, body })).toEqual({
      class: 'invalid_key',
      status: 401,
    });
  });

  it('OpenAI-compatible 401 invalid_api_key body', () => {
    const body = JSON.stringify({
      error: {
        message: `Incorrect API key provided: ${SECRET}.`,
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
    expect(classifyProviderFailure({ status: 401, body }).class).toBe('invalid_key');
  });

  it('codex-lb error object without a status', () => {
    expect(
      classifyProviderFailure({ code: 'invalid_api_key', type: 'invalid_request_error' }),
    ).toEqual({ class: 'invalid_key', status: null });
  });
});

describe('classifyProviderFailure: quota or rate limit', () => {
  it('Anthropic SDK 429 rate_limit_error', () => {
    const err = anthropicHttpError(
      429,
      'rate_limit_error',
      'This request would exceed your organization rate limit of 50 requests per minute.',
    );
    expect(classifyProviderFailure(err)).toEqual({ class: 'quota', status: 429 });
  });

  it('Anthropic reports an empty credit balance as a 400', () => {
    const err = anthropicHttpError(
      400,
      'invalid_request_error',
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
    );
    expect(classifyProviderFailure(err)).toEqual({ class: 'quota', status: 400 });
  });

  it('OpenRouter 402 insufficient credits', () => {
    const body = JSON.stringify({
      error: { message: 'Insufficient credits. Add more using https://openrouter.ai/credits', code: 402 },
    });
    expect(classifyProviderFailure({ status: 402, body })).toEqual({ class: 'quota', status: 402 });
  });

  it('OpenRouter answers 200 with the status in error.code', () => {
    expect(
      classifyProviderFailure({ status: 429, message: 'Rate limit exceeded: free-models-per-day' }),
    ).toEqual({ class: 'quota', status: 429 });
  });

  it('OpenAI-compatible 429 insufficient_quota', () => {
    const body = JSON.stringify({
      error: {
        message: 'You exceeded your current quota, please check your plan and billing details.',
        type: 'insufficient_quota',
        code: 'insufficient_quota',
      },
    });
    expect(classifyProviderFailure({ status: 429, body }).class).toBe('quota');
  });

  it('codex-lb plain-text 429 and a status-less rate_limit_exceeded', () => {
    expect(classifyProviderFailure({ status: 429, body: 'quota exhausted' }).class).toBe('quota');
    expect(classifyProviderFailure({ code: 'rate_limit_exceeded' })).toEqual({
      class: 'quota',
      status: null,
    });
  });
});

describe('classifyProviderFailure: model or bad request', () => {
  it('Anthropic SDK 404 not_found_error for an unknown model', () => {
    const err = anthropicHttpError(404, 'not_found_error', 'model: claude-opus-9');
    expect(classifyProviderFailure(err)).toEqual({ class: 'model', status: 404 });
  });

  it('Anthropic SDK 400 invalid_request_error', () => {
    const err = anthropicHttpError(
      400,
      'invalid_request_error',
      'temperature: Extra inputs are not permitted',
    );
    expect(classifyProviderFailure(err)).toEqual({ class: 'model', status: 400 });
  });

  it('OpenRouter 400 for a model id that does not exist', () => {
    const body = JSON.stringify({
      error: { message: 'nope/nothing is not a valid model ID', code: 400 },
    });
    expect(classifyProviderFailure({ status: 400, body })).toEqual({ class: 'model', status: 400 });
  });

  it('Ollama 404 for a model that is not pulled', () => {
    const body = JSON.stringify({
      error: { message: 'model "llama9" not found, try pulling it first', type: 'api_error' },
    });
    expect(classifyProviderFailure({ status: 404, body })).toEqual({ class: 'model', status: 404 });
  });

  it('422 from a schema mismatch and a status-less model_not_found', () => {
    expect(classifyProviderFailure({ status: 422, body: '{"detail":"validation"}' }).class).toBe(
      'model',
    );
    expect(classifyProviderFailure({ code: 'model_not_found' }).class).toBe('model');
  });

  it('keeps the class a throw site already decided (structured output that failed validation)', () => {
    const err = new LlmError(502, 'The generated program could not be parsed: ...', 'model');
    expect(classifyProviderFailure(err)).toEqual({ class: 'model', status: 502 });
  });
});

describe('classifyProviderFailure: provider outage', () => {
  it('Anthropic SDK 529 overloaded_error and 500 api_error', () => {
    expect(
      classifyProviderFailure(anthropicHttpError(529, 'overloaded_error', 'Overloaded')),
    ).toEqual({ class: 'outage', status: 529 });
    expect(
      classifyProviderFailure(anthropicHttpError(500, 'api_error', 'Internal server error')),
    ).toEqual({ class: 'outage', status: 500 });
  });

  it('an overloaded_error event in the middle of an Anthropic stream has no status', () => {
    // The SDK's stream reader builds it with the constructor, without a status.
    const err = new Anthropic.APIError(
      undefined,
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      undefined,
      undefined,
    );
    expect(classifyProviderFailure(err)).toEqual({ class: 'outage', status: null });
  });

  it('OpenRouter 502 / 503 and an HTML gateway page', () => {
    expect(classifyProviderFailure({ status: 502, body: 'upstream boom' }).class).toBe('outage');
    expect(
      classifyProviderFailure({ status: 503, body: '<html><h1>503 Service Unavailable</h1></html>' })
        .class,
    ).toBe('outage');
  });

  it('does not read a quota hint into a 5xx body', () => {
    expect(classifyProviderFailure({ status: 500, body: 'payment required upstream' }).class).toBe(
      'outage',
    );
  });
});

describe('classifyProviderFailure: timeout or network error', () => {
  it('Anthropic SDK connection and timeout errors', () => {
    expect(classifyProviderFailure(new Anthropic.APIConnectionTimeoutError())).toEqual({
      class: 'timeout',
      status: null,
    });
    expect(
      classifyProviderFailure(new Anthropic.APIConnectionError({ cause: fetchFailed('ECONNRESET') })),
    ).toEqual({ class: 'timeout', status: null });
  });

  it('recognises the SDK connection errors by message when class names are minified', () => {
    for (const message of ['Connection error.', 'Request timed out.']) {
      const minified = Object.assign(new Error(message), { status: undefined, error: undefined });
      expect(classifyProviderFailure(minified), message).toEqual({
        class: 'timeout',
        status: null,
      });
    }
  });

  it('fetch rejections from undici', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT']) {
      expect(classifyProviderFailure(fetchFailed(code)), code).toEqual({
        class: 'timeout',
        status: null,
      });
    }
    // No cause at all: still a failed fetch.
    expect(classifyProviderFailure(new TypeError('fetch failed')).class).toBe('timeout');
  });

  it('an aborted or timed out fetch', () => {
    expect(
      classifyProviderFailure(new DOMException('This operation was aborted', 'AbortError')).class,
    ).toBe('timeout');
    expect(
      classifyProviderFailure(
        new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      ).class,
    ).toBe('timeout');
  });

  it('408 and 504 answers', () => {
    expect(classifyProviderFailure({ status: 408, body: '' }).class).toBe('timeout');
    expect(classifyProviderFailure({ status: 504, body: 'Gateway Timeout' }).class).toBe('timeout');
  });
});

describe('classifyProviderFailure: unknown', () => {
  it('does not guess', () => {
    for (const input of [undefined, null, 'boom', 42, {}, new Error('something else')]) {
      expect(classifyProviderFailure(input)).toEqual({ class: 'unknown', status: null });
    }
    expect(classifyProviderFailure({ status: 302 })).toEqual({ class: 'unknown', status: 302 });
    // A status that is not an HTTP status is ignored.
    expect(classifyProviderFailure({ status: 99999 })).toEqual({ class: 'unknown', status: null });
  });

  it('classifies an untagged LlmError by its status', () => {
    expect(classifyProviderFailure(new LlmError(429, 'x')).class).toBe('quota');
    expect(classifyProviderFailure(new LlmError(401, 'x')).class).toBe('invalid_key');
  });
});

describe('describeLlmFailure', () => {
  const anthropic = { id: 'anthropic', apiKeyEnvVar: 'ANTHROPIC_API_KEY' } as const;
  const openrouter = { id: 'openrouter', apiKeyEnvVar: 'OPENROUTER_API_KEY' } as const;
  const compatible = {
    id: 'openai-compatible',
    apiKeyEnvVar: 'OPENAI_COMPATIBLE_BASE_URL',
  } as const;
  const codexLb = { id: 'codex-lb', apiKeyEnvVar: 'CODEX_LB_API_KEY' } as const;

  it('names the key variable of the active provider and answers 502, never 401', () => {
    const err = new LlmError(401, `Anthropic: 401 invalid x-api-key ${SECRET}`, 'invalid_key');
    expect(describeLlmFailure(err, anthropic)).toMatchObject({
      class: 'invalid_key',
      status: 401,
      code: 'ai_invalid_key',
      variable: 'ANTHROPIC_API_KEY',
      httpStatus: 502,
      body: {
        error:
          'The AI provider rejected the API key. Check ANTHROPIC_API_KEY in your .env and restart.',
        code: 'ai_invalid_key',
        variable: 'ANTHROPIC_API_KEY',
      },
    });
    expect(describeLlmFailure(err, openrouter).variable).toBe('OPENROUTER_API_KEY');
    // The optional key of a local server, not the base URL the UI asks for
    // when the provider is unconfigured.
    expect(describeLlmFailure(err, compatible).variable).toBe('OPENAI_COMPATIBLE_API_KEY');
    expect(describeLlmFailure(err, codexLb).variable).toBe('CODEX_LB_API_KEY');
  });

  it('answers 503 for quota (not 429) and carries no variable', () => {
    const d = describeLlmFailure(new LlmError(429, 'OpenRouter 429: ...', 'quota'), openrouter);
    expect(d.httpStatus).toBe(503);
    expect(d.body).toEqual({ error: AI_ERROR_MESSAGES.quota, code: 'ai_quota' });
  });

  it('points a model failure at the model variable', () => {
    const d = describeLlmFailure(new LlmError(404, 'x', 'model'), openrouter);
    expect(d).toMatchObject({ httpStatus: 502, variable: 'OPENROUTER_MODEL', code: 'ai_model' });
    expect(d.message).toContain('OPENROUTER_MODEL');
  });

  it('maps outage to 503 and timeout to 504', () => {
    expect(describeLlmFailure(new LlmError(529, 'x', 'outage'), anthropic).httpStatus).toBe(503);
    expect(describeLlmFailure(new LlmError(502, 'x', 'timeout'), anthropic).httpStatus).toBe(504);
  });

  it('names the output budget variable for a cut-off answer', () => {
    const d = describeLlmFailure(new LlmError(502, 'cut off', 'truncated'), compatible);
    expect(d).toMatchObject({ code: 'ai_truncated', variable: 'OPENAI_COMPATIBLE_MAX_TOKENS' });
  });

  it('uses the variable the provider reports as missing when it is not configured', () => {
    const d = describeLlmFailure(
      new LlmError(503, 'OPENAI_COMPATIBLE_BASE_URL is not configured.', 'not_configured'),
      compatible,
    );
    expect(d).toMatchObject({
      code: 'ai_not_configured',
      variable: 'OPENAI_COMPATIBLE_BASE_URL',
      httpStatus: 503,
    });
  });

  it('falls back to the generic message when the provider has no variable for the class', () => {
    const d = describeLlmFailure(new LlmError(502, 'cut off', 'truncated'), anthropic);
    expect(d.body).toEqual({ error: AI_ERROR_MESSAGES.unknown, code: 'ai_unknown' });
  });

  it('never repeats the upstream text, whatever the class', () => {
    const inputs: unknown[] = [
      anthropicHttpError(401, 'authentication_error', `invalid x-api-key ${SECRET}`),
      new LlmError(500, `OpenRouter 500: echo Authorization: Bearer ${SECRET}`),
      new LlmError(400, `The model server 400: {"prompt":"${SECRET}"}`, 'model'),
      { status: 429, body: `quota for key ${SECRET}` },
      new Error(SECRET),
    ];
    for (const input of inputs) {
      for (const provider of [anthropic, openrouter, compatible, codexLb]) {
        const serialized = JSON.stringify(describeLlmFailure(input, provider));
        expect(serialized).not.toContain(SECRET);
        expect(serialized).not.toContain('PLANTED');
      }
    }
  });

  it('keeps the English server text identical to the en catalog', () => {
    const catalog = englishMessages.common.aiErrors;
    for (const failureClass of LLM_FAILURE_CLASSES) {
      const key = AI_ERROR_MESSAGE_KEYS[AI_ERROR_CODES[failureClass]];
      expect(AI_ERROR_MESSAGES[failureClass], failureClass).toBe(catalog[key]);
    }
  });
});

describe('logLlmFailure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the scope, provider, class and status, and nothing from the error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new LlmError(401, `OpenRouter 401: bad key ${SECRET}`, 'invalid_key');
    const provider = { id: 'openrouter', apiKeyEnvVar: 'OPENROUTER_API_KEY' } as const;
    logLlmFailure('coach debrief', provider, describeLlmFailure(err, provider));
    expect(spy.mock.calls).toEqual([
      ['[llm] coach debrief: provider call failed (provider=openrouter class=invalid_key status=401)'],
    ]);
  });
});

describe('stream error marker', () => {
  it('round-trips a code with and without a variable', () => {
    const withVar = `Half an answer${formatStreamError('ai_model', 'OPENROUTER_MODEL', 'English text.')}`;
    expect(parseStreamError(withVar)).toEqual({
      text: 'Half an answer',
      code: 'ai_model',
      variable: 'OPENROUTER_MODEL',
    });
    const bare = `Half${formatStreamError('ai_outage', null, 'English text.')}`;
    expect(parseStreamError(bare)).toEqual({ text: 'Half', code: 'ai_outage', variable: null });
  });

  it('ignores text that is not a trailing marker with a known code', () => {
    expect(parseStreamError('A normal answer.')).toBeNull();
    expect(parseStreamError('x\n\n[error:ai_made_up] nope')).toBeNull();
    expect(parseStreamError('x\n\n[error:ai_outage] gone\nand more text')).toBeNull();
    expect(parseStreamError('x\n\n[error] The coach is unavailable right now.')).toBeNull();
  });

  it('validates codes and variable names', () => {
    expect(isAiErrorCode('ai_quota')).toBe(true);
    expect(isAiErrorCode('constructor')).toBe(false);
    expect(isAiErrorCode(undefined)).toBe(false);
    expect(isEnvVarName('ANTHROPIC_API_KEY')).toBe(true);
    expect(isEnvVarName('sk-ant-api03-abc')).toBe(false);
    expect(isEnvVarName('<img src=x>')).toBe(false);
    expect(isEnvVarName('')).toBe(false);
  });
});
