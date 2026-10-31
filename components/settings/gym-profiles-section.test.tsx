import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as nextIntl from 'next-intl';
import { GymProfilesSection } from './gym-profiles-section';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubSave() {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: 'g1', exerciseConfigs: [], ...body }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function savedBody(fetchMock: ReturnType<typeof stubSave>) {
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body));
}

describe('GymProfilesSection weight lists', () => {
  it('saves typed plates as an ascending list in English', async () => {
    const user = userEvent.setup();
    const fetchMock = stubSave();
    render(<GymProfilesSection initialGyms={[]} activeGymId={null} exercises={[]} />);

    await user.type(screen.getByLabelText('Gym name'), 'Home');
    const plates = screen.getByLabelText('Plate denominations (kg, per side)');
    expect(plates).toHaveAttribute('placeholder', '1.25, 2.5, 5, 10, 15, 20');
    await user.type(plates, '20, 2.5, 10');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(savedBody(fetchMock).plateWeights).toEqual([2.5, 10, 20]);
  });

  describe('in a comma-decimal locale (issue #514)', () => {
    it('saves "2,5" as one 2.5 kg plate, never 2 and 5', async () => {
      vi.spyOn(nextIntl, 'useLocale').mockReturnValue('fr');
      const user = userEvent.setup();
      const fetchMock = stubSave();
      render(<GymProfilesSection initialGyms={[]} activeGymId={null} exercises={[]} />);

      await user.type(screen.getByLabelText('Gym name'), 'Home');
      const plates = screen.getByLabelText('Plate denominations (kg, per side)');
      expect(plates).toHaveAttribute('placeholder', '1,25, 2,5, 5, 10, 15, 20');
      await user.type(plates, '20, 2,5, 1,25');
      await user.tab();
      expect(screen.getByLabelText('Plate denominations (kg, per side)')).toHaveValue(
        '1,25, 2,5, 20',
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(savedBody(fetchMock).plateWeights).toEqual([1.25, 2.5, 20]);
    });
  });
});
