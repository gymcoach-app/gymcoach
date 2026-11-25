// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
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

  // Issue #593. On a slow phone the server-rendered form is on screen well
  // before its JavaScript: people type into it, and may even submit it.
  describe('before hydration (#593)', () => {
    function serverRendered(): HTMLElement {
      const host = document.createElement('div');
      host.innerHTML = renderToString(<SignupForm />);
      document.body.appendChild(host);
      return host;
    }

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('server-renders a form whose native submit cannot put the password in the URL', () => {
      const form = serverRendered().querySelector('form') as HTMLFormElement;
      // Without a method a form submits as GET /signup?...&password=...
      expect(form.getAttribute('method')).toBe('post');
    });

    it('keeps what was typed before hydration and submits it', async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
      vi.stubGlobal('fetch', fetchMock);
      const host = serverRendered();
      const field = (id: string) => host.querySelector(`#${id}`) as HTMLInputElement;
      // Typed while the page is still plain HTML: only the DOM knows.
      field('displayName').value = 'Alex';
      field('email').value = 'alex@example.com';
      field('password').value = 'longenough1';

      let root: ReturnType<typeof hydrateRoot> | undefined;
      await act(async () => {
        root = hydrateRoot(host, <SignupForm />);
      });

      expect(field('displayName')).toHaveValue('Alex');
      expect(field('email')).toHaveValue('alex@example.com');
      expect(field('password')).toHaveValue('longenough1');

      await userEvent.click(within(host).getByRole('button', { name: /create account/i }));

      await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/register',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            displayName: 'Alex',
            email: 'alex@example.com',
            password: 'longenough1',
          }),
        }),
      );
      expect(within(host).queryByText(/required|invalid|at least/i)).not.toBeInTheDocument();
      await act(async () => root?.unmount());
    });

    it('takes form fields out of the address bar when it mounts', () => {
      const leaked = '/signup?displayName=A&email=a%40b.c&password=hunter22';
      window.history.replaceState(null, '', leaked);
      try {
        render(<SignupForm />);
        expect(window.location.pathname + window.location.search).toBe('/signup');
      } finally {
        window.history.replaceState(null, '', '/');
      }
    });

    it('still validates an untouched form after hydration', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const host = serverRendered();
      let root: ReturnType<typeof hydrateRoot> | undefined;
      await act(async () => {
        root = hydrateRoot(host, <SignupForm />);
      });

      await userEvent.click(within(host).getByRole('button', { name: /create account/i }));

      expect(await within(host).findByText('Name required')).toBeInTheDocument();
      expect(within(host).getByText('Invalid email')).toBeInTheDocument();
      expect(within(host).getByText(/at least 8 characters/)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
      await act(async () => root?.unmount());
    });
  });
});
