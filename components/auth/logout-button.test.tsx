import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogoutButton } from './logout-button';

const { replace, toastError, deleteSyncedSets, calls } = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    replace: vi.fn(),
    toastError: vi.fn(),
    deleteSyncedSets: vi.fn(async () => {
      calls.push('dexie');
    }),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { error: toastError } }));
vi.mock('@/lib/sync', () => ({ deleteSyncedSets }));

// Records fetch and cache deletions in one log, so the order is pinned.
function stubCaches() {
  vi.stubGlobal('caches', {
    keys: async () => ['api-get', 'pages', 'static-assets'],
    delete: async (name: string) => {
      calls.push(`delete:${name}`);
      return true;
    },
  });
}

function stubFetch(result: () => Promise<{ ok: boolean }>) {
  const fetchMock = vi.fn(async () => {
    calls.push('fetch');
    return result();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function clickLogout() {
  render(<LogoutButton />);
  await userEvent.click(screen.getByRole('button', { name: /log out/i }));
}

describe('LogoutButton (#357)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    replace.mockReset();
    toastError.mockReset();
    deleteSyncedSets.mockClear();
    calls.length = 0;
  });

  it('purges the per-user caches before and after the logout call, then clears synced sets', async () => {
    stubCaches();
    const fetchMock = stubFetch(async () => ({ ok: true }));

    await clickLogout();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
    });
    expect(calls).toEqual([
      'delete:api-get',
      'delete:pages',
      'fetch',
      'delete:api-get',
      'delete:pages',
      'dexie',
    ]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reports an offline logout, keeps the user on the page and keeps the queue', async () => {
    stubCaches();
    stubFetch(async () => {
      throw new Error('offline');
    });

    await clickLogout();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Could not log out. You are still signed in; try again when online.',
      ),
    );
    // Purged before the call, so a device handed on offline holds no cache.
    expect(calls).toEqual(['delete:api-get', 'delete:pages', 'fetch']);
    expect(replace).not.toHaveBeenCalled();
    expect(deleteSyncedSets).not.toHaveBeenCalled();
  });

  it('treats a refused logout call like a failed one', async () => {
    stubCaches();
    stubFetch(async () => ({ ok: false }));

    await clickLogout();

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(replace).not.toHaveBeenCalled();
    expect(deleteSyncedSets).not.toHaveBeenCalled();
  });
});
