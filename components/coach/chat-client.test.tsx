// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatClient } from './chat-client';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

beforeAll(() => {
  // jsdom has no layout: the thread's scroll-to-bottom is a no-op here.
  Element.prototype.scrollTo = () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  toastError.mockReset();
});

function renderChat() {
  render(
    <ChatClient
      initialConversations={[]}
      initialActiveId={null}
      initialMessages={[]}
      hasApiKey
      providerLabel="OpenRouter"
      apiKeyEnvVar="OPENROUTER_API_KEY"
    />,
  );
}

function sendMessage(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Message your coach...'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]![1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

const INVALID_KEY =
  'The AI provider rejected the API key. Check OPENROUTER_API_KEY in your .env and restart.';

// Issue #571: provider failures reach the chat as a stable code, either in a
// JSON error (the provider refused the call) or in a trailing stream marker
// (it failed after the first chunk). Both show the translated message.
describe('ChatClient provider failure', () => {
  it('shows the translated message of a JSON error and stays on the conversation', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: 'server English text', code: 'ai_invalid_key', variable: 'OPENROUTER_API_KEY' },
        { status: 502, headers: { 'X-Conversation-Id': 'conv-1' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderChat();

    sendMessage('How do I break a plateau?');
    expect(await screen.findByText(`[error] ${INVALID_KEY}`)).toBeTruthy();
    expect(toastError).toHaveBeenCalledWith(INVALID_KEY);
    expect(screen.queryByText(/server English text/)).toBeNull();

    // The user message was stored in conv-1: the retry continues it.
    sendMessage('Again');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentBody(fetchMock, 0).conversationId).toBeUndefined();
    expect(sentBody(fetchMock, 1).conversationId).toBe('conv-1');
  });

  it('replaces a trailing stream marker with the translated message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('Start of the answer\n\n[error:ai_outage] server English text', {
            status: 200,
            headers: { 'X-Conversation-Id': 'conv-2' },
          }),
      ),
    );
    renderChat();

    sendMessage('Hello');
    const outage = 'The AI provider is unavailable right now. Try again later.';
    expect(await screen.findByText(`[error] ${outage}`)).toBeTruthy();
    expect(screen.getByText('Start of the answer')).toBeTruthy();
    expect(screen.queryByText(/server English text/)).toBeNull();
    expect(toastError).toHaveBeenCalledWith(outage);
  });

  it('leaves a normal answer untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Add a back-off set.', { status: 200 })),
    );
    renderChat();

    sendMessage('Hello');
    expect(await screen.findByText('Add a back-off set.')).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });
});
