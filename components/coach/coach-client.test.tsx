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
});
