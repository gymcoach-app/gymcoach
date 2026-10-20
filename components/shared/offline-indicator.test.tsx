import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { countUnsyncedSets, flushPendingSets, liveQuery } = vi.hoisted(() => ({
  countUnsyncedSets: vi.fn(async (_userId: string) => 2),
  flushPendingSets: vi.fn(async (_userId: string) => ({
    flushed: 0,
    failed: 0,
    pending: 0,
    droppedEquipment: [],
  })),
  // The query function of the last useLiveQuery call, and the value it shows.
  liveQuery: { fn: null as null | (() => Promise<number>), value: 0 },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    values?.count === undefined ? key : `${key}:${values.count}`,
}));
vi.mock('@/lib/sync', () => ({ countUnsyncedSets, flushPendingSets }));
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn: () => Promise<number>) => {
    liveQuery.fn = fn;
    return liveQuery.value;
  },
}));

import { OfflineIndicator } from './offline-indicator';

async function mount(userId: string | null) {
  await act(async () => {
    render(<OfflineIndicator userId={userId} />);
  });
}

describe('OfflineIndicator per account (#490)', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    countUnsyncedSets.mockClear();
    flushPendingSets.mockClear();
    liveQuery.fn = null;
    liveQuery.value = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts the signed-in account's unsynced sets only", async () => {
    await mount('user-a');

    expect(await liveQuery.fn?.()).toBe(2);
    expect(countUnsyncedSets).toHaveBeenCalledWith('user-a');
  });

  it('counts nothing without a signed-in account', async () => {
    await mount(null);

    expect(await liveQuery.fn?.()).toBe(0);
    expect(countUnsyncedSets).not.toHaveBeenCalled();
  });

  it("retries the signed-in account's queue from the badge", async () => {
    liveQuery.value = 2;
    await mount('user-a');

    await userEvent.click(screen.getByRole('button', { name: 'syncNow' }));

    expect(flushPendingSets).toHaveBeenCalledWith('user-a');
  });
});
