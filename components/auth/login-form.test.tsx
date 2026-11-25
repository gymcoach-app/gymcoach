// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import userEvent from '@testing-library/user-event';

// The router is irrelevant to these assertions; stub it so the component mounts.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

// The demo flag/credentials are read at module load, so re-import after stubbing.
async function renderForm() {
  vi.resetModules();
  const { LoginForm } = await import('./login-form');
  return render(<LoginForm />);
}

describe('LoginForm demo banner', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not render the demo banner when NEXT_PUBLIC_DEMO_MODE is unset', async () => {
    await renderForm();
    expect(screen.queryByText('Demo account')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /log in as demo/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the demo credentials and logs in with one click when demo mode is on', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', 'true');
    vi.stubEnv('NEXT_PUBLIC_DEMO_EMAIL', 'demo@gymcoach.app');
    vi.stubEnv('NEXT_PUBLIC_DEMO_PASSWORD', 'gymcoachdemo');
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await renderForm();

    expect(screen.getByText('Demo account')).toBeInTheDocument();
    expect(
      screen.getByText('demo@gymcoach.app / gymcoachdemo'),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /log in as demo/i }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'demo@gymcoach.app',
          password: 'gymcoachdemo',
        }),
      }),
    );
  });

  it('purges the previous session service-worker caches on a successful login (#357)', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', 'true');
    vi.stubEnv('NEXT_PUBLIC_DEMO_EMAIL', 'demo@gymcoach.app');
    vi.stubEnv('NEXT_PUBLIC_DEMO_PASSWORD', 'gymcoachdemo');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: async () => ['api-get', 'static-assets'],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });

    await renderForm();
    await userEvent.click(
      screen.getByRole('button', { name: /log in as demo/i }),
    );

    await waitFor(() => expect(deleted).toEqual(['api-get']));
  });
});

// Issue #593. On a slow phone the server-rendered form is on screen well
// before its JavaScript, and a password manager fills it at once.
describe('LoginForm before hydration (#593)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  async function serverRendered() {
    vi.resetModules();
    const { LoginForm } = await import('./login-form');
    const host = document.createElement('div');
    host.innerHTML = renderToString(<LoginForm />);
    document.body.appendChild(host);
    return { host, LoginForm };
  }

  it('server-renders a form whose native submit cannot put the password in the URL', async () => {
    const { host } = await serverRendered();
    // Without a method a form submits as GET /login?email=...&password=...
    expect(host.querySelector('form')?.getAttribute('method')).toBe('post');
  });

  it('keeps what was typed or autofilled before hydration and submits it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const { host, LoginForm } = await serverRendered();
    const email = host.querySelector('#email') as HTMLInputElement;
    const password = host.querySelector('#password') as HTMLInputElement;
    email.value = 'alex@example.com';
    password.value = 'longenough1';

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(host, <LoginForm />);
    });

    expect(email).toHaveValue('alex@example.com');
    expect(password).toHaveValue('longenough1');

    await userEvent.click(within(host).getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'alex@example.com', password: 'longenough1' }),
        }),
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => root?.unmount());
  });

  it('takes form fields out of the address bar when it mounts', async () => {
    window.history.replaceState(null, '', '/login?email=a%40b.c&password=hunter22');
    try {
      await renderForm();
      expect(window.location.pathname + window.location.search).toBe('/login');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('still validates an untouched form after hydration', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { host, LoginForm } = await serverRendered();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(host, <LoginForm />);
    });

    await userEvent.click(within(host).getByRole('button', { name: 'Sign in' }));

    expect(await within(host).findByText('Invalid email')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => root?.unmount());
  });
});
