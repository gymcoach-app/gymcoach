import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateProgram } from '@/lib/program-generation';
import { aiParseSet } from '@/lib/set-parse';
import { getLlmProvider, resolveProviderId } from './index';
import {
  OpenAiCompatibleProvider,
  resetOpenAiCompatibleLogForTests,
  validateOpenAiCompatibleBaseUrl,
} from './openai-compatible';
import { OpenRouterProvider } from './openrouter';
import { LlmError } from './types';

// generateProgram reads the profile and the exercise list before it calls the
// model; nothing here reaches a database.
vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn(async () => null) },
    exercise: { findMany: vi.fn(async () => []) },
  },
}));

const ENV_KEYS = [
  'LLM_PROVIDER',
  'OPENAI_COMPATIBLE_BASE_URL',
  'OPENAI_COMPATIBLE_MODEL',
  'OPENAI_COMPATIBLE_API_KEY',
  'OPENAI_COMPATIBLE_MAX_TOKENS',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'OPENROUTER_APP_NAME',
  'OPENROUTER_APP_URL',
  'OPENROUTER_MAX_TOKENS',
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  resetOpenAiCompatibleLogForTests();
  // The provider logs a refused setting; keep the test output quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type FakeResponse = Partial<Response> & { json?: () => unknown; text?: () => unknown };

// Every test talks to this stub: no request leaves the process.
function mockFetch(impl: () => FakeResponse) {
  const fn = vi.fn(async (_url: string, _init: RequestInit) => impl() as unknown as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function reply(content: string, extra: Record<string, unknown> = {}): FakeResponse {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { role: 'assistant', content } }], ...extra }),
  };
}

function configure(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
  process.env.LLM_PROVIDER = 'openai-compatible';
  process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://host.docker.internal:11434/v1';
  process.env.OPENAI_COMPATIBLE_MODEL = 'llama3.1';
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
}

const ASK = { system: 'SYSTEM', messages: [{ role: 'user' as const, content: 'payload' }] };

function sseBody(chunks: string[]): Response['body'] {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('provider selection', () => {
  it('selects openai-compatible, case-insensitive and with its aliases', () => {
    for (const value of ['openai-compatible', 'OpenAI-Compatible', ' openai_compatible ']) {
      process.env.LLM_PROVIDER = value;
      expect(resolveProviderId()).toBe('openai-compatible');
      expect(getLlmProvider().id).toBe('openai-compatible');
    }
    process.env.LLM_PROVIDER = 'openaicompatible';
    expect(resolveProviderId()).toBe('openai-compatible');
  });

  it('does not select it for a nearby value', () => {
    process.env.LLM_PROVIDER = 'openai';
    expect(resolveProviderId()).toBe('anthropic');
  });
});

describe('validateOpenAiCompatibleBaseUrl', () => {
  it('accepts http and https and drops trailing slashes', () => {
    expect(validateOpenAiCompatibleBaseUrl('http://host.docker.internal:11434/v1')).toEqual({
      ok: true,
      url: 'http://host.docker.internal:11434/v1',
    });
    expect(validateOpenAiCompatibleBaseUrl('  https://llm.example.test/v1///  ')).toEqual({
      ok: true,
      url: 'https://llm.example.test/v1',
    });
    expect(validateOpenAiCompatibleBaseUrl('http://127.0.0.1:1234/')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:1234',
    });
  });

  it.each([
    ['unset', undefined, 'not configured'],
    ['blank', '   ', 'not configured'],
    ['not a URL', 'localhost:11434/v1', 'http:// or https://'],
    ['no scheme at all', 'just some words', 'not a valid URL'],
    ['a file URL', 'file:///etc/passwd', 'http:// or https://'],
    ['another scheme', 'ftp://host/v1', 'http:// or https://'],
    ['credentials', 'https://user:hunter2@llm.example.test/v1', 'must not contain credentials'],
    ['a user only', 'https://token-abc@llm.example.test/v1', 'must not contain credentials'],
    ['a query string', 'https://llm.example.test/v1?api_key=hunter2', 'query string'],
    ['a fragment', 'https://llm.example.test/v1#frag', 'query string'],
  ])('refuses %s without repeating the value', (_name, value, expected) => {
    const result = validateOpenAiCompatibleBaseUrl(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(expected);
    expect(result.reason).not.toContain('hunter2');
    expect(result.reason).not.toContain('token-abc');
    expect(result.reason).not.toContain('example.test');
  });
});

describe('OpenAiCompatibleProvider', () => {
  it('is not configured without a base URL and names that variable', async () => {
    process.env.OPENAI_COMPATIBLE_MODEL = 'llama3.1';
    const fetchFn = mockFetch(() => reply('unused'));
    const p = new OpenAiCompatibleProvider();
    expect(p.isConfigured()).toBe(false);
    expect(p.apiKeyEnvVar).toBe('OPENAI_COMPATIBLE_BASE_URL');
    await expect(p.complete(ASK)).rejects.toMatchObject({
      status: 503,
      message: 'OPENAI_COMPATIBLE_BASE_URL is not configured.',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is not configured without a model and names that variable', async () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://127.0.0.1:11434/v1';
    const fetchFn = mockFetch(() => reply('unused'));
    const p = new OpenAiCompatibleProvider();
    expect(p.isConfigured()).toBe(false);
    expect(p.apiKeyEnvVar).toBe('OPENAI_COMPATIBLE_MODEL');
    await expect(p.complete(ASK)).rejects.toMatchObject({
      status: 503,
      message: 'OPENAI_COMPATIBLE_MODEL is not configured.',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a base URL with credentials before any request, without leaking it', async () => {
    configure({ OPENAI_COMPATIBLE_BASE_URL: 'https://user:hunter2@llm.example.test/v1' });
    const fetchFn = mockFetch(() => reply('unused'));
    const p = new OpenAiCompatibleProvider();
    expect(p.isConfigured()).toBe(false);
    expect(p.apiKeyEnvVar).toBe('OPENAI_COMPATIBLE_BASE_URL');

    const failure = await p.complete(ASK).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(LlmError);
    expect((failure as LlmError).status).toBe(503);
    expect((failure as LlmError).message).toContain('must not contain credentials');
    expect((failure as LlmError).message).not.toContain('hunter2');

    const streamFailure = await (async () => {
      for await (const _ of p.stream(ASK)) void _;
    })().catch((err: unknown) => err);
    expect((streamFailure as LlmError).status).toBe(503);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is configured with a base URL and a model, no key needed', () => {
    configure();
    const p = new OpenAiCompatibleProvider();
    expect(p.isConfigured()).toBe(true);
    expect(p.model).toBe('llama3.1');
    expect(p.label).toBe('OpenAI-compatible endpoint');
  });

  it('posts to <base>/chat/completions with no Authorization header when no key is set', async () => {
    configure({ OPENAI_COMPATIBLE_BASE_URL: 'http://host.docker.internal:11434/v1/' });
    const fetchFn = mockFetch(() => reply('  hi there  ', { model: 'llama3.1:8b' }));

    const res = await new OpenAiCompatibleProvider().complete({
      ...ASK,
      temperature: 0.4,
      maxTokens: 999,
    });
    expect(res).toEqual({ text: 'hi there', modelUsed: 'llama3.1:8b' });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://host.docker.internal:11434/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: 'llama3.1',
      messages: [
        { role: 'system', content: 'SYSTEM' },
        { role: 'user', content: 'payload' },
      ],
      temperature: 0.4,
      max_tokens: 999,
    });
  });

  it('treats a blank key as no key', async () => {
    configure({ OPENAI_COMPATIBLE_API_KEY: '   ' });
    const fetchFn = mockFetch(() => reply('ok'));
    await new OpenAiCompatibleProvider().complete(ASK);
    expect(fetchFn.mock.calls[0]![1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('sends the key as a Bearer token and never the OpenRouter attribution headers', async () => {
    configure({ OPENAI_COMPATIBLE_API_KEY: 'sk-local-secret' });
    process.env.OPENROUTER_APP_NAME = 'GymCoach';
    process.env.OPENROUTER_APP_URL = 'https://gym.example.test';
    process.env.OPENROUTER_API_KEY = 'or-key';
    const fetchFn = mockFetch(() => reply('ok'));

    await new OpenAiCompatibleProvider().complete(ASK);

    expect(fetchFn.mock.calls[0]![1].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-local-secret',
    });
  });

  it('falls back to the configured model when the server names none', async () => {
    configure();
    mockFetch(() => reply('ok'));
    const res = await new OpenAiCompatibleProvider().complete(ASK);
    expect(res.modelUsed).toBe('llama3.1');
  });

  it('omits temperature when the caller gives none', async () => {
    configure();
    const fetchFn = mockFetch(() => reply('ok'));
    await new OpenAiCompatibleProvider().complete(ASK);
    const body = JSON.parse(fetchFn.mock.calls[0]![1].body as string);
    expect('temperature' in body).toBe(false);
    expect(body.max_tokens).toBe(8000);
    expect('stream' in body).toBe(false);
  });

  it('OPENAI_COMPATIBLE_MAX_TOKENS sets the budget of every call exactly, up or down', async () => {
    configure({ OPENAI_COMPATIBLE_MAX_TOKENS: '2048' });
    // The OpenRouter floor is a different setting and must not apply here.
    process.env.OPENROUTER_MAX_TOKENS = '999999';
    const fetchFn = mockFetch(() => reply('ok'));
    const p = new OpenAiCompatibleProvider();
    const budgets = async () => {
      fetchFn.mockClear();
      await p.complete({ ...ASK, maxTokens: 200 });
      await p.complete(ASK);
      await p.complete({ ...ASK, maxTokens: 8000 });
      return fetchFn.mock.calls.map(([, init]) => JSON.parse(init.body as string).max_tokens);
    };
    // Lowered for a small context window, raised for the tiny set-parse call.
    expect(await budgets()).toEqual([2048, 2048, 2048]);

    process.env.OPENAI_COMPATIBLE_MAX_TOKENS = '100000';
    expect(await budgets()).toEqual([100000, 100000, 100000]);

    process.env.OPENAI_COMPATIBLE_MAX_TOKENS = ' 256 ';
    expect(await budgets()).toEqual([256, 256, 256]);
  });

  it.each(['', 'nope', '255', '0', '-4096', '4096.5', '1e5', '4096 tokens'])(
    "ignores OPENAI_COMPATIBLE_MAX_TOKENS=%j and keeps each call's own budget",
    async (value) => {
      configure({ OPENAI_COMPATIBLE_MAX_TOKENS: value });
      const fetchFn = mockFetch(() => reply('ok'));
      const p = new OpenAiCompatibleProvider();
      await p.complete({ ...ASK, maxTokens: 200 });
      await p.complete(ASK);
      const budgets = fetchFn.mock.calls.map(
        ([, init]) => JSON.parse(init.body as string).max_tokens,
      );
      expect(budgets).toEqual([200, 8000]);
    },
  );

  it('refuses a redirect instead of re-sending the prompt and the key elsewhere', async () => {
    configure({ OPENAI_COMPATIBLE_API_KEY: 'sk-local-secret' });
    const fetchFn = mockFetch(() => ({
      ok: false,
      status: 307,
      headers: new Headers({ location: 'https://elsewhere.example.test/v1/chat/completions' }),
      text: async () => '',
    }));
    const p = new OpenAiCompatibleProvider();

    const failure = await p.complete(ASK).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(LlmError);
    expect((failure as LlmError).status).toBe(502);
    expect((failure as LlmError).message).toBe(
      'The model server answered with a redirect, which is not followed. ' +
        'Set OPENAI_COMPATIBLE_BASE_URL to the final address of the server.',
    );
    expect((failure as LlmError).message).not.toContain('elsewhere.example.test');
    // One request only, and fetch was told not to follow.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]![1].redirect).toBe('manual');

    const streamFailure = await (async () => {
      for await (const _ of p.stream(ASK)) void _;
    })().catch((err: unknown) => err);
    expect((streamFailure as LlmError).message).toContain('redirect');
    expect(fetchFn.mock.calls[1]![1].redirect).toBe('manual');

    // The opaque form a browser-like fetch gives for a manual redirect.
    mockFetch(() => ({ ok: false, status: 0, type: 'opaqueredirect', text: async () => '' }));
    await expect(p.complete(ASK)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('redirect'),
    });
  });

  it('logs why it is not usable once, without the URL value or the key', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    configure({
      OPENAI_COMPATIBLE_BASE_URL: 'https://user:hunter2@llm.example.test/v1',
      OPENAI_COMPATIBLE_API_KEY: 'sk-local-secret',
    });
    new OpenAiCompatibleProvider();
    new OpenAiCompatibleProvider();
    new OpenAiCompatibleProvider();

    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]!.join(' ');
    expect(line).toContain('OPENAI_COMPATIBLE_BASE_URL must not contain credentials');
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('llm.example.test');
    expect(line).not.toContain('sk-local-secret');

    // A different reason is logged too, once.
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://127.0.0.1:11434/v1';
    delete process.env.OPENAI_COMPATIBLE_MODEL;
    new OpenAiCompatibleProvider();
    new OpenAiCompatibleProvider();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]!.join(' ')).toContain('OPENAI_COMPATIBLE_MODEL is not configured.');
  });

  it('logs nothing when it is configured', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    configure({ OPENAI_COMPATIBLE_API_KEY: 'sk-local-secret' });
    new OpenAiCompatibleProvider();
    expect(log).not.toHaveBeenCalled();
  });

  it('maps a non-ok response to its status and masks an echoed key', async () => {
    configure({ OPENAI_COMPATIBLE_API_KEY: 'sk-local-secret' });
    mockFetch(() => ({
      ok: false,
      status: 401,
      text: async () => 'invalid token "Bearer sk-local-secret" for this server',
    }));
    const failure = await new OpenAiCompatibleProvider().complete(ASK).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(LlmError);
    expect((failure as LlmError).status).toBe(401);
    expect((failure as LlmError).message).toContain('The model server 401');
    expect((failure as LlmError).message).toContain('[redacted]');
    expect((failure as LlmError).message).not.toContain('sk-local-secret');
  });

  it('maps a refused connection to 502 without the base URL or the key', async () => {
    configure({
      OPENAI_COMPATIBLE_BASE_URL: 'http://llm.internal.example.test:11434/v1',
      OPENAI_COMPATIBLE_API_KEY: 'sk-local-secret',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed (sent Bearer sk-local-secret)');
      }),
    );
    const failure = await new OpenAiCompatibleProvider().complete(ASK).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(LlmError);
    expect((failure as LlmError).status).toBe(502);
    expect((failure as LlmError).message).toContain('Network failure to the model server: ');
    expect((failure as LlmError).message).not.toContain('sk-local-secret');
    expect((failure as LlmError).message).not.toContain('llm.internal.example.test');
  });

  it('throws 502 when the body carries an error field', async () => {
    configure();
    mockFetch(() => ({ ok: true, json: async () => ({ error: { message: 'model not found' } }) }));
    await expect(new OpenAiCompatibleProvider().complete(ASK)).rejects.toMatchObject({
      status: 502,
      message: 'The model server: model not found',
    });
  });

  it.each([
    ['no message', { error: {} }, 'The model server: unknown error'],
    ['a null message', { error: { message: null } }, 'The model server: unknown error'],
    [
      'an object message',
      { error: { message: { detail: 'bad model', key: 'sk-local-secret' } } },
      'The model server: {"detail":"bad model","key":"[redacted]"}',
    ],
    ['a number message', { error: { message: 42 } }, 'The model server: 42'],
  ])('throws 502, not a TypeError, when the error field has %s', async (_name, body, expected) => {
    configure({ OPENAI_COMPATIBLE_API_KEY: 'sk-local-secret' });
    mockFetch(() => ({ ok: true, json: async () => body }));
    const failure = await new OpenAiCompatibleProvider().complete(ASK).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(LlmError);
    expect((failure as LlmError).status).toBe(502);
    expect((failure as LlmError).message).toBe(expected);
  });

  it('throws 502 when a 200 response is not JSON (a proxy page, a wrong path)', async () => {
    configure();
    mockFetch(() => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    }));
    await expect(new OpenAiCompatibleProvider().complete(ASK)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('not JSON'),
    });
  });

  it('throws 502 on an empty choice', async () => {
    configure();
    mockFetch(() => ({ ok: true, json: async () => ({ choices: [] }) }));
    await expect(new OpenAiCompatibleProvider().complete(ASK)).rejects.toMatchObject({
      status: 502,
    });
  });

  it('names its own variable when the reply was cut off by max_tokens', async () => {
    configure();
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        choices: [
          { message: { role: 'assistant', content: '{"name": "trunc' }, finish_reason: 'length' },
        ],
      }),
    }));
    const failure = await new OpenAiCompatibleProvider().complete(ASK).catch((err: unknown) => err);
    expect((failure as LlmError).status).toBe(502);
    expect((failure as LlmError).message).toContain('cut off');
    expect((failure as LlmError).message).toContain('OPENAI_COMPATIBLE_MAX_TOKENS');
    expect((failure as LlmError).message).not.toContain('OPENROUTER');
  });

  it('streams text deltas, across chunk boundaries and without a final newline', async () => {
    configure({ OPENAI_COMPATIBLE_API_KEY: 'sk-local-secret' });
    const fetchFn = mockFetch(() => ({
      ok: true,
      body: sseBody([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hel',
        'lo"}}]}\n\n: keep-alive\n\n',
        'data: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\n',
        'data: {"choices":[{"delta":{"content":"!"}}]}',
      ]),
    }));

    const deltas: string[] = [];
    for await (const delta of new OpenAiCompatibleProvider().stream({ ...ASK, maxTokens: 4096 })) {
      deltas.push(delta);
    }
    expect(deltas).toEqual(['Hello', ' there', '!']);

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://host.docker.internal:11434/v1/chat/completions');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-local-secret',
    });
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(4096);
  });

  it('throws when a stream answers with an error status or no body', async () => {
    configure();
    const p = new OpenAiCompatibleProvider();
    const drain = async () => {
      for await (const _ of p.stream(ASK)) void _;
    };

    mockFetch(() => ({ ok: false, status: 404, text: async () => 'model "llama3.1" not found' }));
    await expect(drain()).rejects.toMatchObject({ status: 404 });

    mockFetch(() => ({ ok: true, body: null }));
    await expect(drain()).rejects.toMatchObject({
      status: 502,
      message: 'The model server returned no response body.',
    });
  });
});

describe('OpenRouterProvider on the shared Chat Completions client', () => {
  it('keeps its endpoint, its key and its attribution headers', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    process.env.OPENROUTER_APP_NAME = 'My Gym';
    process.env.OPENROUTER_APP_URL = 'https://gym.example.test';
    // A base URL meant for the other provider must not redirect OpenRouter.
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.OPENAI_COMPATIBLE_MAX_TOKENS = '999999';
    const fetchFn = mockFetch(() => reply('ok'));

    await new OpenRouterProvider().complete({ ...ASK, maxTokens: 300 });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer or-key',
      'HTTP-Referer': 'https://gym.example.test',
      'X-Title': 'My Gym',
    });
    expect(JSON.parse(init.body as string).max_tokens).toBe(300);
  });

  it('follows redirects as before: no redirect option is set', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    const fetchFn = mockFetch(() => reply('ok'));
    await new OpenRouterProvider().complete(ASK);
    expect('redirect' in fetchFn.mock.calls[0]![1]).toBe(false);
  });

  it('keeps OPENROUTER_MAX_TOKENS a floor: it raises a budget, never lowers it', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    process.env.OPENROUTER_MAX_TOKENS = '2048';
    const fetchFn = mockFetch(() => reply('ok'));
    const p = new OpenRouterProvider();
    await p.complete({ ...ASK, maxTokens: 200 });
    await p.complete(ASK);
    const budgets = fetchFn.mock.calls.map(
      ([, init]) => JSON.parse(init.body as string).max_tokens,
    );
    expect(budgets).toEqual([2048, 8000]);
  });

  it.each([
    ['no message', { error: {} }],
    ['a null message', { error: { message: null } }],
    ['an object message', { error: { message: { detail: 'bad model' } } }],
  ])('throws a 502 LlmError when the error field has %s', async (_name, body) => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    mockFetch(() => ({ ok: true, json: async () => body }));
    const failure = await new OpenRouterProvider().complete(ASK).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(LlmError);
    expect((failure as LlmError).status).toBe(502);
    expect((failure as LlmError).message.startsWith('OpenRouter: ')).toBe(true);
  });

  it('streams with the same headers and stream: true', async () => {
    process.env.OPENROUTER_API_KEY = 'or-key';
    const fetchFn = mockFetch(() => ({
      ok: true,
      body: sseBody(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n']),
    }));
    const deltas: string[] = [];
    for await (const delta of new OpenRouterProvider().stream(ASK)) deltas.push(delta);
    expect(deltas).toEqual(['Hi']);
    const init = fetchFn.mock.calls[0]![1];
    expect((init.headers as Record<string, string>)['X-Title']).toBe('GymCoach');
    expect(JSON.parse(init.body as string).stream).toBe(true);
  });
});

// A small local model often returns prose, broken JSON or out-of-range
// values. Whatever the provider hands back still goes through the same Zod
// validation before anything is applied.
describe('structured outputs from a weak model stay validated', () => {
  it('a malformed set parse fills nothing', async () => {
    configure();
    const fetchFn = mockFetch(() => reply('Sure! {"kind": "strength", "weight": 100, "reps": '));
    const result = await aiParseSet('100 x 8', {
      exerciseName: 'Bench Press',
      kind: 'strength',
      unit: 'KG',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('an out-of-range set parse fills nothing', async () => {
    configure();
    mockFetch(() => reply('{"kind":"strength","weight":100,"reps":8,"rir":42}'));
    const result = await aiParseSet('100 x 8', {
      exerciseName: 'Bench Press',
      kind: 'strength',
      unit: 'KG',
    });
    expect(result).toBeNull();
  });

  it('a well-formed set parse still comes through', async () => {
    configure();
    mockFetch(() => reply('{"kind":"strength","weight":100,"reps":8,"rir":2}'));
    const result = await aiParseSet('100 x 8 rir 2', {
      exerciseName: 'Bench Press',
      kind: 'strength',
      unit: 'KG',
    });
    expect(result).toMatchObject({ kind: 'strength', weight: 100, reps: 8, rir: 2 });
  });

  it('a malformed generated program is refused before anything is saved', async () => {
    configure();
    const fetchFn = mockFetch(() =>
      reply('Here is your plan:\n{"name": "Push Pull", "workouts": [{"name": '),
    );
    const failure = await generateProgram('user-1', 'get stronger').catch((err: unknown) => err);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(failure).toBeInstanceOf(LlmError);
    expect((failure as LlmError).status).toBe(502);
    expect((failure as LlmError).message).toContain('could not be parsed');
  });

  it('a generated program with the wrong shape is refused before anything is saved', async () => {
    configure();
    mockFetch(() => reply('{"name":"Push Pull","phase":"NOT_A_PHASE","workouts":"three"}'));
    await expect(generateProgram('user-1', 'get stronger')).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('could not be parsed'),
    });
  });

  it('the generation call reaches the configured server with the configured budget', async () => {
    configure({ OPENAI_COMPATIBLE_MAX_TOKENS: '4096' });
    const fetchFn = mockFetch(() => reply('not a program'));
    await generateProgram('user-1', 'get stronger').catch(() => undefined);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://host.docker.internal:11434/v1/chat/completions');
    expect(JSON.parse(init.body as string).max_tokens).toBe(4096);
    expect(getLlmProvider().id).toBe('openai-compatible');
  });
});
