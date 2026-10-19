import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogoutButton } from './logout-button';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
}));

function stubCaches() {
  const deleted: string[] = [];
  vi.stubGlobal('caches', {
    keys: async () => ['api-get', 'pages', 'static-assets'],
    delete: async (name: string) => {
      deleted.push(name);
      return true;
    },
  });
  return deleted;
}

describe('LogoutButton (#357)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    replace.mockReset();
  });

  it('purges the per-user service-worker caches after logging out', async () => {
    const deleted = stubCaches();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<LogoutButton />);
    await userEvent.click(screen.getByRole('button', { name: /log out/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
    });
    expect(deleted.sort()).toEqual(['api-get', 'pages']);
  });

  it('still purges the caches when the logout call fails', async () => {
    const deleted = stubCaches();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    render(<LogoutButton />);
    await userEvent.click(screen.getByRole('button', { name: /log out/i }));

    await waitFor(() => expect(deleted.sort()).toEqual(['api-get', 'pages']));
    // The session may still be live, so the user is not sent to the login page.
    expect(replace).not.toHaveBeenCalled();
  });
});
