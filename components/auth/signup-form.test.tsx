import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignupForm } from './signup-form';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
}));

describe('SignupForm (#357)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    replace.mockReset();
  });

  it('purges the previous session service-worker caches on a successful signup', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls.push('fetch');
        return { ok: true, json: async () => ({}) };
      }),
    );
    vi.stubGlobal('caches', {
      keys: async () => ['api-get', 'static-assets'],
      delete: async (name: string) => {
        calls.push(`delete:${name}`);
        return true;
      },
    });

    const { container } = render(<SignupForm />);
    await userEvent.type(
      container.querySelector('#displayName') as HTMLElement,
      'Alex',
    );
    await userEvent.type(
      container.querySelector('#email') as HTMLElement,
      'alex@example.com',
    );
    await userEvent.type(
      container.querySelector('#password') as HTMLElement,
      'longenough1',
    );
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(calls).toEqual(['fetch', 'delete:api-get']);
  });
});
