import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexLbProvider } from './codex-lb';
import { OpenAiCompatibleProvider } from './openai-compatible';
import { OpenRouterProvider } from './openrouter';
import { LlmError, type LlmProvider } from './types';

// Each fetch-based provider tags the LlmError it throws with the failure
// class, from the real HTTP status / body / rejection it saw (issue #571).

const ENV_KEYS = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'OPENROUTER_MAX_TOKENS',
  'OPENAI_COMPATIBLE_BASE_URL',
  'OPENAI_COMPATIBLE_MODEL',
  'OPENAI_COMPATIBLE_API_KEY',
  'OPENAI_COMPATIBLE_MAX_TOKENS',
  'CODEX_LB_API_KEY',
  'CODEX_LB_BASE_URL',
  'CODEX_LB_MODEL',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:11434/v1';
  process.env.OPENAI_COMPATIBLE_MODEL = 'llama3';
  process.env.CODEX_LB_API_KEY = 'codex-test';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

const REQUEST = { system: 'S', messages: [{ role: 'user' as const, content: 'x' }] };

const providers: [string, () => LlmProvider][] = [
  ['openrouter', () => new OpenRouterProvider()],
  ['openai-compatible', () => new OpenAiCompatibleProvider()],
  ['codex-lb', () => new CodexLbProvider()],
];

async function failureOf(run: () => Promise<unknown>): Promise<LlmError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof LlmError) return err;
    throw err;
  }
  throw new Error('expected the provider call to fail');
}

async function drain(stream: AsyncIterable<string>): Promise<void> {
  for await (const chunk of stream) void chunk;
}

describe.each(providers)('%s failure classes', (_name, make) => {
  it.each([
    [401, '{"error":{"message":"No auth credentials found","code":401}}', 'invalid_key'],
    [403, '{"error":{"message":"Forbidden"}}', 'invalid_key'],
    [429, '{"error":{"message":"Rate limit exceeded","code":429}}', 'quota'],
    [402, '{"error":{"message":"Insufficient credits","code":402}}', 'quota'],
    [404, '{"error":{"message":"model not found"}}', 'model'],
    [400, '{"error":{"message":"not a valid model ID"}}', 'model'],
    [422, '{"detail":"schema mismatch"}', 'model'],
    [500, 'Internal Server Error', 'outage'],
    [503, '<html>Service Unavailable</html>', 'outage'],
    [529, '{"error":{"type":"overloaded_error"}}', 'outage'],
    [504, 'Gateway Timeout', 'timeout'],
  ] as const)('HTTP %i -> %s (complete and stream)', async (status, body, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));
    const completeError = await failureOf(() => make().complete(REQUEST));
    expect(completeError).toMatchObject({ status, failure: expected });
    const streamError = await failureOf(() => drain(make().stream(REQUEST)));
    expect(streamError).toMatchObject({ status, failure: expected });
  });

  it('a fetch that rejects is a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
        });
      }),
    );
    expect(await failureOf(() => make().complete(REQUEST))).toMatchObject({ failure: 'timeout' });
  });

  it('a rejection of an unknown shape is still a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    );
    expect(await failureOf(() => make().complete(REQUEST))).toMatchObject({ failure: 'timeout' });
  });

  it('an empty answer is a model failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ choices: [{ message: { content: '' } }], output: [] })),
    );
    expect(await failureOf(() => make().complete(REQUEST))).toMatchObject({ failure: 'model' });
  });
});

describe('chat completions specifics', () => {
  it('reads the status OpenRouter puts in the error of a 200 answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: { code: 429, message: 'Rate limit exceeded: free-models-per-day' } }),
      ),
    );
    expect(await failureOf(() => new OpenRouterProvider().complete(REQUEST))).toMatchObject({
      failure: 'quota',
    });
  });

  it('tags a cut-off answer as truncated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }] }),
      ),
    );
    expect(await failureOf(() => new OpenRouterProvider().complete(REQUEST))).toMatchObject({
      failure: 'truncated',
    });
  });

  it('tags a refused redirect and a missing setting as not configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'http://x/' } })),
    );
    expect(await failureOf(() => new OpenAiCompatibleProvider().complete(REQUEST))).toMatchObject({
      failure: 'not_configured',
    });

    delete process.env.OPENAI_COMPATIBLE_MODEL;
    expect(await failureOf(() => new OpenAiCompatibleProvider().complete(REQUEST))).toMatchObject({
      status: 503,
      failure: 'not_configured',
    });
    delete process.env.OPENROUTER_API_KEY;
    expect(await failureOf(() => new OpenRouterProvider().complete(REQUEST))).toMatchObject({
      status: 503,
      failure: 'not_configured',
    });
  });
});

describe('codex-lb specifics', () => {
  it('classifies the error object of a 200 answer by its code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }),
      ),
    );
    expect(await failureOf(() => new CodexLbProvider().complete(REQUEST))).toMatchObject({
      failure: 'quota',
    });
  });

  it('tags a missing key as not configured', async () => {
    delete process.env.CODEX_LB_API_KEY;
    expect(await failureOf(() => new CodexLbProvider().complete(REQUEST))).toMatchObject({
      status: 503,
      failure: 'not_configured',
    });
  });
});
