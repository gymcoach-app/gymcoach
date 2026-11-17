import { describe, it, expect, beforeEach, vi } from 'vitest';

// Every server-side consumer of model text, driven with an answer that opens
// with a reasoning block (issue #571). The provider and the database are
// mocked; the parsing and the routes are the real ones.

const { completeMock, streamMock, dbMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  streamMock: vi.fn(),
  dbMock: {
    user: { findUnique: vi.fn() },
    exercise: { findMany: vi.fn() },
    conversation: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    message: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));

vi.mock('@/lib/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm')>()),
  getLlmProvider: () => ({
    id: 'openrouter',
    label: 'OpenRouter',
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    model: 'test/reasoner',
    isConfigured: () => true,
    complete: completeMock,
    stream: streamMock,
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  requireApiUserId: async () => 'user-1',
}));

vi.mock('@/lib/coach', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/coach')>()),
  buildCoachPayload: async () => ({}),
}));

import { LlmError } from '@/lib/llm';
import { callCoach, type CoachPayload } from '@/lib/coach';
import { extractAdjustments } from '@/lib/coach-adjustments';
import { generateProgram } from '@/lib/program-generation';
import { aiParseSet } from '@/lib/set-parse';
import { POST as postChat } from '@/app/api/coach/chat/route';

const THINK = '<think>\nThe user wants {"kind": "a plan"}.\n```json\n{"draft": true}\n```\n</think>\n\n';

const program = {
  name: 'Upper / Lower',
  description: 'A 4-day split.',
  phase: 'Hypertrophy',
  workouts: [
    {
      name: 'Upper',
      dayOfWeek: 1,
      exercises: [
        {
          name: 'Barbell bench press',
          muscleGroup: 'CHEST',
          category: 'COMPOUND',
          targetSets: 4,
          targetRepsMin: 6,
          targetRepsMax: 10,
          targetRIR: 2,
          restSec: 120,
        },
      ],
    },
  ],
};

function reply(text: string) {
  completeMock.mockResolvedValue({ text, modelUsed: 'test/reasoner' });
}

function streamOf(parts: string[]) {
  streamMock.mockImplementation(async function* () {
    for (const part of parts) yield part;
  });
}

beforeEach(() => {
  completeMock.mockReset();
  streamMock.mockReset();
  for (const model of Object.values(dbMock)) {
    for (const fn of Object.values(model)) fn.mockReset();
  }
  dbMock.user.findUnique.mockResolvedValue(null);
  dbMock.exercise.findMany.mockResolvedValue([]);
  dbMock.conversation.create.mockResolvedValue({ id: 'conv-1' });
  dbMock.conversation.update.mockResolvedValue({});
  dbMock.message.create.mockResolvedValue({});
  dbMock.message.findMany.mockResolvedValue([{ role: 'USER', content: 'Hello' }]);
});

describe('program generation', () => {
  it('parses a program that follows a reasoning block', async () => {
    reply(`${THINK}${JSON.stringify(program)}`);
    const out = await generateProgram('user-1', 'Get stronger');
    expect(out.name).toBe('Upper / Lower');
    expect(out.workouts[0]?.exercises[0]?.name).toBe('Barbell bench press');
  });

  it('fails with the existing parse error on an unclosed reasoning block', async () => {
    reply(`<think>Let me plan ${JSON.stringify(program)}`);
    const failure = await generateProgram('user-1', 'Get stronger').catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(LlmError);
    expect((failure as LlmError).status).toBe(502);
    expect((failure as LlmError).message).toBe(
      'The generated program could not be parsed: No JSON object found in the model response.',
    );
  });
});

describe('AI set parse', () => {
  const ctx = { exerciseName: 'Squat', kind: 'strength', unit: 'KG' } as const;

  it('parses a set that follows a reasoning block', async () => {
    reply(`${THINK}{"kind":"strength","weight":100,"reps":8,"rir":2}`);
    expect(await aiParseSet('100 for 8, two in the tank', ctx)).toEqual({
      kind: 'strength',
      weight: 100,
      reps: 8,
      rir: 2,
    });
  });

  it('fills nothing on an unclosed reasoning block', async () => {
    reply('<think>maybe {"kind":"strength","weight":100,"reps":8}');
    expect(await aiParseSet('100 for 8', ctx)).toBeNull();
  });
});

describe('coach debrief', () => {
  const adjustments =
    '<adjustments>[{"exerciseName":"Squat","summary":"Move up to 82.5 kg"}]</adjustments>';

  it('returns the debrief without its reasoning block, adjustments still readable', async () => {
    reply(
      `<think>I could write <adjustments>[{"draft":1}]</adjustments> here.</think>\n## Recap\n\nGood week.\n\n${adjustments}`,
    );
    const out = await callCoach({} as CoachPayload);
    expect(out.markdown.startsWith('## Recap')).toBe(true);
    expect(out.markdown).not.toContain('<think>');

    const extracted = extractAdjustments(out.markdown);
    expect(extracted.parseErrors).toEqual([]);
    expect(extracted.adjustments).toEqual([
      { exerciseName: 'Squat', summary: 'Move up to 82.5 kg' },
    ]);
  });

  it('reports an empty response when the reasoning block never closes', async () => {
    reply('<think>thinking and thinking');
    const failure = await callCoach({} as CoachPayload).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(LlmError);
    expect((failure as LlmError).status).toBe(502);
    expect((failure as LlmError).message).toBe('Empty response from the coach.');
  });
});

describe('POST /api/coach/chat', () => {
  function chatRequest() {
    return new Request('http://localhost/api/coach/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    });
  }

  function storedAssistantMessages() {
    return dbMock.message.create.mock.calls
      .map((call) => call[0].data)
      .filter((data) => data.role === 'ASSISTANT');
  }

  it('streams and stores the answer without the leading reasoning block', async () => {
    streamOf(['<thi', 'nk>The user says hello.', '</think>\n\n', 'Hi! ', 'Ready to train?']);
    const res = await postChat(chatRequest());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Hi! Ready to train?');
    expect(storedAssistantMessages()).toEqual([
      { conversationId: 'conv-1', role: 'ASSISTANT', content: 'Hi! Ready to train?' },
    ]);
  });

  it('streams and stores nothing when the reasoning block never closes', async () => {
    streamOf(['<think>', 'cut off while thinking']);
    const res = await postChat(chatRequest());
    expect(await res.text()).toBe('');
    expect(storedAssistantMessages()).toEqual([]);
  });

  it('leaves an answer without a reasoning block untouched', async () => {
    streamOf(['Hi', ' there']);
    const res = await postChat(chatRequest());
    expect(await res.text()).toBe('Hi there');
    expect(storedAssistantMessages()[0]?.content).toBe('Hi there');
  });
});
