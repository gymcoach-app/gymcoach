import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the Anthropic SDK before importing the providers. vi.hoisted makes the
// mock fn available to the hoisted vi.mock factory.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status?: number;
    constructor(status: number | undefined, message: string) {
      super(message);
      this.status = status;
    }
  }
  class Anthropic {
    static APIError = APIError;
    messages = { create: createMock };
    constructor(_opts?: unknown) {}
  }
  return { default: Anthropic, APIError };
});

import AnthropicMock from '@anthropic-ai/sdk';
import { AnthropicProvider } from './anthropic';
import { OpenRouterProvider } from './openrouter';
import { resolveProviderId, getLlmProvider } from './index';
import { LlmError } from './types';

const ENV_KEYS = [
  'LLM_PROVIDER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'OPENROUTER_APP_NAME',
  'OPENROUTER_APP_URL',
  'OPENROUTER_MAX_TOKENS',
  'CODEX_LB_API_KEY',
  'CODEX_LB_BASE_URL',
  'CODEX_LB_MODEL',
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  createMock.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

describe('provider selection', () => {
  it('defaults to anthropic when LLM_PROVIDER is unset', () => {
    expect(resolveProviderId()).toBe('anthropic');
    expect(getLlmProvider().id).toBe('anthropic');
  });

  it('selects openrouter when LLM_PROVIDER=openrouter (case-insensitive)', () => {
    process.env.LLM_PROVIDER = 'OpenRouter';
    expect(resolveProviderId()).toBe('openrouter');
    expect(getLlmProvider().id).toBe('openrouter');
  });

  it('selects codex-lb using its supported aliases', () => {
    process.env.LLM_PROVIDER = 'CODEX_LB';
    expect(resolveProviderId()).toBe('codex-lb');
    expect(getLlmProvider().id).toBe('codex-lb');
  });

  it('falls back to anthropic for an unknown value', () => {
    process.env.LLM_PROVIDER = 'gpt-whatever';
    expect(resolveProviderId()).toBe('anthropic');
  });
});

describe('AnthropicProvider', () => {
  it('reports not configured without a key', () => {
    expect(new AnthropicProvider().isConfigured()).toBe(false);
  });

  it('throws 503 when the key is missing', async () => {
    const p = new AnthropicProvider();
    await expect(
      p.complete({ system: 'S', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('uses the default model and overrides via ANTHROPIC_MODEL', () => {
    expect(new AnthropicProvider().model).toBe('claude-opus-4-7');
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5';
    expect(new AnthropicProvider().model).toBe('claude-haiku-4-5');
  });

  it('caches the system prompt, omits temperature, and joins text blocks', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    createMock.mockResolvedValue({
      model: 'claude-opus-4-7',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text: 'world' },
      ],
    });

    const p = new AnthropicProvider();
    const res = await p.complete({
      system: 'SYSTEM',
      messages: [{ role: 'user', content: 'payload' }],
      temperature: 0.4,
      maxTokens: 1234,
    });

    expect(res).toEqual({ text: 'Hello world', modelUsed: 'claude-opus-4-7' });

    const arg = createMock.mock.calls[0]![0];
    expect(arg.model).toBe('claude-opus-4-7');
    expect(arg.max_tokens).toBe(1234);
    expect(arg.messages).toEqual([{ role: 'user', content: 'payload' }]);
    expect(arg.system).toEqual([
      { type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } },
    ]);
    // Opus 4.7 rejects sampling params: temperature must not be forwarded.
    expect('temperature' in arg).toBe(false);
  });

  it('maps an Anthropic APIError to an LlmError with its status', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    // The runtime class is mocked; cast past the real SDK constructor signature.
    const ApiErrorCtor = AnthropicMock.APIError as unknown as new (
      status: number,
      message: string,
    ) => Error;
    createMock.mockRejectedValue(new ApiErrorCtor(429, 'rate limited'));
    const p = new AnthropicProvider();
    await expect(
      p.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('tags the LlmError with the failure class (issue #571)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const ApiErrorCtor = AnthropicMock.APIError as unknown as new (
      status: number | undefined,
      message: string,
    ) => Error;
    const p = new AnthropicProvider();
    const request = { system: 'S', messages: [{ role: 'user' as const, content: 'x' }] };
    const cases = [
      [new ApiErrorCtor(401, '401 invalid x-api-key'), 'invalid_key'],
      [new ApiErrorCtor(429, '429 rate limited'), 'quota'],
      [new ApiErrorCtor(404, '404 model: nope'), 'model'],
      [new ApiErrorCtor(529, '529 Overloaded'), 'outage'],
      [new ApiErrorCtor(undefined, 'Connection error.'), 'timeout'],
      [new Error('something unexpected'), 'unknown'],
    ] as const;
    for (const [thrown, failure] of cases) {
      createMock.mockRejectedValueOnce(thrown);
      await expect(p.complete(request), failure).rejects.toMatchObject({ failure });
    }

    createMock.mockResolvedValueOnce({ model: 'm', content: [] });
    await expect(p.complete(request)).rejects.toMatchObject({ failure: 'model' });

    delete process.env.ANTHROPIC_API_KEY;
    await expect(new AnthropicProvider().complete(request)).rejects.toMatchObject({
      status: 503,
      failure: 'not_configured',
    });
  });

  it('throws 502 on an empty response', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    createMock.mockResolvedValue({ model: 'm', content: [] });
    const p = new AnthropicProvider();
    await expect(
      p.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(LlmError);
  });
});

describe('OpenRouterProvider', () => {
  function mockFetch(
    impl: () => Partial<Response> & { json?: () => unknown; text?: () => unknown },
  ) {
    const fn = vi.fn(async (_url: string, _init: RequestInit) => impl() as unknown as Response);
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('throws 503 when the key is missing', async () => {
    const p = new OpenRouterProvider();
    await expect(
      p.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('sends the system message, forwards temperature, and parses the reply', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    const fetchFn = mockFetch(() => ({
      ok: true,
      json: async () => ({
        model: 'anthropic/claude-sonnet-4.5',
        choices: [{ message: { role: 'assistant', content: '  hi there  ' } }],
      }),
    }));

    const p = new OpenRouterProvider();
    const res = await p.complete({
      system: 'SYSTEM',
      messages: [{ role: 'user', content: 'payload' }],
      temperature: 0.4,
      maxTokens: 999,
    });

    expect(res).toEqual({ text: 'hi there', modelUsed: 'anthropic/claude-sonnet-4.5' });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer or-key');
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'payload' });
    expect(body.temperature).toBe(0.4);
    expect(body.max_tokens).toBe(999);
  });

  it('throws with the upstream status on a non-ok response', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    mockFetch(() => ({ ok: false, status: 502, text: async () => 'upstream boom' }));
    const p = new OpenRouterProvider();
    await expect(
      p.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('throws 502 when the body carries an error field', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    mockFetch(() => ({ ok: true, json: async () => ({ error: { message: 'bad model' } }) }));
    const p = new OpenRouterProvider();
    await expect(
      p.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('throws 502 on an empty choice', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    mockFetch(() => ({ ok: true, json: async () => ({ choices: [] }) }));
    const p = new OpenRouterProvider();
    await expect(
      p.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it('OPENROUTER_MAX_TOKENS raises the per-call budget but never lowers it', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    process.env.OPENROUTER_MAX_TOKENS = '100000';
    const fetchFn = mockFetch(() => ({
      ok: true,
      json: async () => ({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
    }));
    const p = new OpenRouterProvider();
    await p.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }], maxTokens: 200 });
    await p.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }] });
    await p.complete({
      system: 'S',
      messages: [{ role: 'user', content: 'x' }],
      maxTokens: 250000,
    });
    const budgets = fetchFn.mock.calls.map(
      ([, init]) => JSON.parse(init.body as string).max_tokens,
    );
    expect(budgets).toEqual([100000, 100000, 250000]);

    process.env.OPENROUTER_MAX_TOKENS = 'nope';
    await p.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }], maxTokens: 200 });
    expect(JSON.parse(fetchFn.mock.calls[3]![1].body as string).max_tokens).toBe(200);
  });

  it('throws 502 with a clear message when the reply was cut off by max_tokens', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        choices: [
          { message: { role: 'assistant', content: '{"name": "trunc' }, finish_reason: 'length' },
        ],
      }),
    }));
    const p = new OpenRouterProvider();
    await expect(
      p.complete({ system: 'S', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ status: 502, message: expect.stringContaining('cut off') });
  });
});
