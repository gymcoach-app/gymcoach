import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as requestDebrief } from '@/app/api/coach/route';
import { POST as postChat } from '@/app/api/coach/chat/route';
import { POST as generateProgram } from '@/app/api/programs/generate/route';
import { POST as parseSet } from '@/app/api/sets/parse/route';

// Issue #571: when the provider call fails, every AI route answers with the
// failure class as a stable code, a short message naming what to fix, and a
// 5xx status. Nothing the provider sent (body, echoed key) reaches the client
// or the log. The provider is the real OpenRouter one; only its HTTP call is
// replaced.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SECRET_KEY = 'sk-or-v1-PLANTED-SECRET-KEY';
// What an upstream may send back: its own wording, plus the key it received.
const UPSTREAM_401 = JSON.stringify({
  error: { message: `No auth credentials found for Bearer ${SECRET_KEY}`, code: 401 },
});
const UPSTREAM_429 = JSON.stringify({
  error: { message: 'Rate limit exceeded: free-models-per-day. UPSTREAM-DETAIL', code: 429 },
});

const ENV = {
  LLM_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: SECRET_KEY,
  OPENROUTER_MODEL: 'test/model',
} as const;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [key, value] of Object.entries(ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});
afterAll(() => {
  for (const key of Object.keys(ENV)) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

let logged: ReturnType<typeof vi.spyOn>;
let providerCalls = 0;

beforeEach(() => {
  mockUserId.mockReset();
  providerCalls = 0;
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Answers the provider endpoint only; anything else goes to the real fetch.
function stubProvider(respond: () => Response | Promise<Response>) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === OPENROUTER_URL) {
      providerCalls += 1;
      return respond();
    }
    return realFetch(input, init);
  });
}

async function seed() {
  const user = await db.user.create({ data: { email: 'ai-errors@test.dev', passwordHash: 'x' } });
  mockUserId.mockResolvedValue(user.id);
  const bench = await db.exercise.create({
    data: { userId: user.id, name: 'Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  return { user, bench };
}

function jsonReq(path: string, body: unknown): Request {
  return new Request(`http://test.local${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const routes: [string, (exerciseId: string) => Promise<Response>][] = [
  ['POST /api/coach', () => requestDebrief()],
  [
    'POST /api/coach/chat',
    () => postChat(jsonReq('/api/coach/chat', { message: 'How do I break a plateau?' })),
  ],
  [
    'POST /api/programs/generate',
    () =>
      generateProgram(
        jsonReq('/api/programs/generate', { goal: 'Hypertrophy, four sessions a week' }),
      ),
  ],
  [
    'POST /api/sets/parse',
    (exerciseId) => parseSet(jsonReq('/api/sets/parse', { exerciseId, text: '100 for 8' })),
  ],
];

function expectNothingLeaked(raw: string) {
  expect(raw).not.toContain(SECRET_KEY);
  expect(raw).not.toContain('PLANTED');
  expect(raw).not.toContain('No auth credentials');
  expect(raw).not.toContain('UPSTREAM-DETAIL');
  expect(raw).not.toContain('free-models-per-day');
}

describe.each(routes)('%s when the provider call fails', (_name, call) => {
  it('answers 502 with the invalid-key code and the variable to check on a provider 401', async () => {
    const { bench } = await seed();
    stubProvider(() => new Response(UPSTREAM_401, { status: 401 }));

    const res = await call(bench.id);
    const raw = await res.text();

    expect(providerCalls).toBe(1);
    // Not 401: the browser would read that as "signed out".
    expect(res.status).toBe(502);
    expect(JSON.parse(raw)).toEqual({
      error:
        'The AI provider rejected the API key. Check OPENROUTER_API_KEY in your .env and restart.',
      code: 'ai_invalid_key',
      variable: 'OPENROUTER_API_KEY',
    });
    expectNothingLeaked(raw);

    // One log line: scope, provider, class and upstream status only.
    expect(logged.mock.calls).toHaveLength(1);
    const line = String(logged.mock.calls[0]![0]);
    expect(line).toMatch(
      /^\[llm\] [a-z ]+: provider call failed \(provider=openrouter class=invalid_key status=401\)$/,
    );
    expectNothingLeaked(JSON.stringify(logged.mock.calls));
  });

  it('answers 503 with the quota code on a provider 429', async () => {
    const { bench } = await seed();
    stubProvider(() => new Response(UPSTREAM_429, { status: 429 }));

    const res = await call(bench.id);
    const raw = await res.text();

    // Not 429: that status is this app's own rate limit.
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBeNull();
    expect(JSON.parse(raw)).toEqual({
      error:
        'The AI provider refused the request: rate limit reached or credits used up. ' +
        'Wait a moment and retry, or check the credits of your provider account.',
      code: 'ai_quota',
    });
    expectNothingLeaked(raw);
    expect(String(logged.mock.calls[0]![0])).toContain('class=quota status=429');
    expectNothingLeaked(JSON.stringify(logged.mock.calls));
  });
});

describe('failure side effects', () => {
  it('stores no debrief when the provider refuses the call', async () => {
    const { user } = await seed();
    stubProvider(() => new Response(UPSTREAM_401, { status: 401 }));
    await requestDebrief();
    expect(await db.coachSession.count({ where: { userId: user.id } })).toBe(0);
  });

  it('chat: names the conversation so a retry continues it, and stores no assistant message', async () => {
    const { user } = await seed();
    stubProvider(() => new Response(UPSTREAM_429, { status: 429 }));

    const res = await postChat(jsonReq('/api/coach/chat', { message: 'Hello coach' }));
    expect(res.status).toBe(503);
    const conversation = await db.conversation.findFirstOrThrow({ where: { userId: user.id } });
    expect(res.headers.get('X-Conversation-Id')).toBe(conversation.id);
    const messages = await db.message.findMany({ where: { conversationId: conversation.id } });
    expect(messages.map((m) => m.role)).toEqual(['USER']);
  });

  it('chat: a failure after the first chunk ends the stream with a coded marker', async () => {
    const { user } = await seed();
    const encoder = new TextEncoder();
    stubProvider(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode('data: {"choices":[{"delta":{"content":"Hello there"}}]}\n\n'),
              );
            },
            pull(controller) {
              // What undici raises when the socket closes mid-body.
              controller.error(
                new TypeError('terminated', {
                  cause: Object.assign(new Error(`other side closed ${SECRET_KEY}`), {
                    code: 'UND_ERR_SOCKET',
                  }),
                }),
              );
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );

    const res = await postChat(jsonReq('/api/coach/chat', { message: 'Hello coach' }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(
      'Hello there\n\n[error:ai_timeout] ' +
        'The AI provider did not answer in time or could not be reached. Try again.',
    );
    expectNothingLeaked(text);
    expect(String(logged.mock.calls[0]![0])).toContain('class=timeout status=none');
    expectNothingLeaked(JSON.stringify(logged.mock.calls));

    // The part that did arrive is kept, without the marker.
    const conversation = await db.conversation.findFirstOrThrow({ where: { userId: user.id } });
    const stored = await db.message.findMany({
      where: { conversationId: conversation.id, role: 'ASSISTANT' },
    });
    expect(stored.map((m) => m.content)).toEqual(['Hello there']);
  });

  it('sets/parse: a model answer that is not a set stays a 200 with parsed: null', async () => {
    const { bench } = await seed();
    stubProvider(() =>
      Response.json({ choices: [{ message: { role: 'assistant', content: 'I cannot help.' } }] }),
    );
    const res = await parseSet(
      jsonReq('/api/sets/parse', { exerciseId: bench.id, text: 'how do I squat?' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ parsed: null });
    expect(logged).not.toHaveBeenCalled();
  });
});
