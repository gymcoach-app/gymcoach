import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CoachClient } from './coach-client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderClient() {
  render(
    <CoachClient
      initialHistory={[]}
      hasApiKey
      providerLabel="Demo"
      apiKeyEnvVar="ANTHROPIC_API_KEY"
      programDefaults={{}}
    />,
  );
}

describe('CoachClient debrief request', () => {
  it('shows a translated message when the debrief is rate-limited', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'Too many debrief requests. Please try again later.' }, {
          status: 429,
          headers: { 'Retry-After': '60' },
        }),
      ),
    );
    renderClient();
    fireEvent.click(screen.getByRole('button', { name: 'Request a weekly debrief' }));
    expect(
      await screen.findByText('You have requested too many debriefs. Try again later.'),
    ).toBeTruthy();
    expect(screen.queryByText('Too many debrief requests. Please try again later.')).toBeNull();
  });

  it('still shows the server message for other errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Provider unavailable.' }, { status: 503 })),
    );
    renderClient();
    fireEvent.click(screen.getByRole('button', { name: 'Request a weekly debrief' }));
    expect(await screen.findByText('Provider unavailable.')).toBeTruthy();
  });

  // Issue #571: a provider failure carries a stable code; the message shown is
  // the translation of that code, not the English text of the response.
  it('shows the translated message of a provider failure code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: 'server English text', code: 'ai_invalid_key', variable: 'OPENROUTER_API_KEY' },
          { status: 502 },
        ),
      ),
    );
    renderClient();
    fireEvent.click(screen.getByRole('button', { name: 'Request a weekly debrief' }));
    expect(
      await screen.findByText(
        'The AI provider rejected the API key. Check OPENROUTER_API_KEY in your .env and restart.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('server English text')).toBeNull();
  });

  it('shows the quota message for a provider rate limit, not the debrief rate-limit one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'x', code: 'ai_quota' }, { status: 503 })),
    );
    renderClient();
    fireEvent.click(screen.getByRole('button', { name: 'Request a weekly debrief' }));
    expect(await screen.findByText(/rate limit reached or credits used up/)).toBeTruthy();
    expect(screen.queryByText('You have requested too many debriefs. Try again later.')).toBeNull();
  });
});
