// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeasurementsCard, type BodyMeasurementView } from './measurements-card';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

function lastFetchCall(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
}

const entries: BodyMeasurementView[] = [
  { id: 'm3', site: 'WAIST', valueCm: 82, measuredAt: '2026-06-08T08:00:00Z' },
  { id: 'm2', site: 'WAIST', valueCm: 84, measuredAt: '2026-06-01T08:00:00Z' },
  { id: 'm1', site: 'HIPS', valueCm: 95, measuredAt: '2026-06-01T08:00:00Z' },
];

describe('MeasurementsCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the latest value per site', () => {
    render(<MeasurementsCard entries={entries} unit="KG" />);
    // Latest waist (newest entry m3 = 82) appears in the latest-per-site grid
    // and the selected-site list, so it shows at least once.
    expect(screen.getAllByText('82 cm').length).toBeGreaterThanOrEqual(1);
    // Hips (95) is only in the grid (waist is the selected site for the list).
    expect(screen.getByText('95 cm')).toBeInTheDocument();
    // The older waist value (84) shows in the list but never as a "latest".
    expect(screen.getByText('84 cm')).toBeInTheDocument();
  });

  it('shows an empty-state trend message for a site with no data', () => {
    render(<MeasurementsCard entries={[]} unit="KG" />);
    expect(screen.getByText(/no waist measurement yet/i)).toBeInTheDocument();
  });

  it('posts the value in cm for the selected site (metric)', async () => {
    const user = userEvent.setup();
    render(<MeasurementsCard entries={[]} unit="KG" />);

    await user.type(screen.getByLabelText(/value \(cm\)/i), '82.5');
    await user.click(screen.getByRole('button', { name: 'Log' }));

    const [url, init] = lastFetchCall(fetchMock);
    expect(url).toBe('/api/measurements');
    const body = JSON.parse(init?.body as string) as { site: string; valueCm: number };
    expect(body.site).toBe('WAIST');
    expect(body.valueCm).toBeCloseTo(82.5, 6);
    expect(refresh).toHaveBeenCalled();
  });

  it('converts inches to cm before posting (imperial)', async () => {
    const user = userEvent.setup();
    render(<MeasurementsCard entries={[]} unit="LB" />);

    await user.type(screen.getByLabelText(/value \(in\)/i), '32');
    await user.click(screen.getByRole('button', { name: 'Log' }));

    const [, init] = lastFetchCall(fetchMock);
    const body = JSON.parse(init?.body as string) as { valueCm: number };
    // 32 in = 81.28 cm.
    expect(body.valueCm).toBeCloseTo(81.28, 2);
  });

  it('rejects an empty value without calling the API', async () => {
    const user = userEvent.setup();
    render(<MeasurementsCard entries={[]} unit="KG" />);
    await user.click(screen.getByRole('button', { name: 'Log' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletes the selected-site entry through the API', async () => {
    const user = userEvent.setup();
    render(<MeasurementsCard entries={entries} unit="KG" />);
    // Default site is WAIST; the first deletable row is the newest waist (m3).
    await user.click(
      screen.getAllByRole('button', { name: /delete waist measurement/i })[0] as HTMLElement,
    );
    const [url, init] = lastFetchCall(fetchMock);
    expect(url).toBe('/api/measurements/m3');
    expect(init?.method).toBe('DELETE');
    expect(refresh).toHaveBeenCalled();
  });

  it('switches the trend and list to the chosen site', async () => {
    const user = userEvent.setup();
    render(<MeasurementsCard entries={entries} unit="KG" />);
    await user.selectOptions(screen.getByLabelText(/^site$/i), 'HIPS');
    // Hips has a single entry -> the "log a second" trend message appears.
    expect(screen.getByText(/log a second hips measurement/i)).toBeInTheDocument();
  });
});
