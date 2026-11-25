// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeloadBanner } from './deload-banner';

// next/navigation is a client hook; stub the router used for refresh-on-action.
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

beforeEach(() => {
  refresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeloadBanner (recommendation state)', () => {
  it('renders nothing without reasons and without an active deload', () => {
    const { container } = render(<DeloadBanner reasons={[]} deloadUntil={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists the stalled lifts by name', () => {
    render(
      <DeloadBanner
        reasons={[
          { kind: 'stalled-lifts', exerciseNames: ['Bench press', 'Squat'] },
        ]}
        deloadUntil={null}
      />,
    );
    expect(screen.getByText('A deload week looks due')).toBeInTheDocument();
    expect(
      screen.getByText('2 lifts have stalled: Bench press, Squat.'),
    ).toBeInTheDocument();
  });

  it('explains a chronically low readiness average', () => {
    render(
      <DeloadBanner
        reasons={[
          { kind: 'low-readiness', averageReadiness: 1.7, checkins: 5 },
        ]}
        deloadUntil={null}
      />,
    );
    expect(
      screen.getByText(
        'Your readiness has averaged 1.7/5 over your last 5 check-ins.',
      ),
    ).toBeInTheDocument();
  });

  it('shows one line per reason when both triggers hold', () => {
    render(
      <DeloadBanner
        reasons={[
          { kind: 'stalled-lifts', exerciseNames: ['Squat', 'Deadlift'] },
          { kind: 'low-readiness', averageReadiness: 2, checkins: 4 },
        ]}
        deloadUntil={null}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('starts the deload via POST /api/deload and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deloadUntil: '2026-06-18T00:00:00.000Z' }), {
        status: 201,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <DeloadBanner
        reasons={[{ kind: 'low-readiness', averageReadiness: 2, checkins: 4 }]}
        deloadUntil={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Start a deload week' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/deload',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(refresh).toHaveBeenCalled();
  });
});

describe('DeloadBanner (active state)', () => {
  it('shows the end date and an end button while a deload is active', () => {
    render(<DeloadBanner reasons={[]} deloadUntil="2026-06-18T12:00:00.000Z" />);
    expect(screen.getByText('Deload week in progress')).toBeInTheDocument();
    expect(screen.getByText(/Until Jun 18/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End deload now' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Start a deload week' }),
    ).not.toBeInTheDocument();
  });

  it('takes precedence over the recommendation copy when both apply', () => {
    render(
      <DeloadBanner
        reasons={[{ kind: 'stalled-lifts', exerciseNames: ['Squat', 'Bench'] }]}
        deloadUntil="2026-06-18T12:00:00.000Z"
      />,
    );
    expect(screen.getByText('Deload week in progress')).toBeInTheDocument();
    expect(screen.queryByText('A deload week looks due')).not.toBeInTheDocument();
  });

  it('ends the deload via DELETE /api/deload and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ deloadUntil: null }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<DeloadBanner reasons={[]} deloadUntil="2026-06-18T12:00:00.000Z" />);

    await user.click(screen.getByRole('button', { name: 'End deload now' }));

    expect(fetchMock).toHaveBeenCalledWith('/api/deload', { method: 'DELETE' });
    expect(refresh).toHaveBeenCalled();
  });
});
