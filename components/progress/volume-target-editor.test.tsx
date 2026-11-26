// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VolumeTargetEditor } from './volume-target-editor';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

function lastFetchCall(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
}

function renderEditor(over: Partial<Parameters<typeof VolumeTargetEditor>[0]> = {}) {
  return render(
    <VolumeTargetEditor
      muscleGroup="CHEST"
      label="Chest"
      mev={10}
      mrv={20}
      custom={false}
      defaultMev={10}
      defaultMrv={20}
      {...over}
    />,
  );
}

describe('VolumeTargetEditor (issue #211)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('saves a valid band as a POST and refreshes', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const mev = screen.getByLabelText(/MEV/i);
    const mrv = screen.getByLabelText(/MRV/i);
    await user.clear(mev);
    await user.type(mev, '12');
    await user.clear(mrv);
    await user.type(mrv, '22');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [url, init] = lastFetchCall(fetchMock);
    expect(url).toBe('/api/volume-targets');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ muscleGroup: 'CHEST', mev: 12, mrv: 22 });
    expect(refresh).toHaveBeenCalled();
  });

  it('blocks save and shows an error when mrv <= mev (no fetch)', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const mev = screen.getByLabelText(/MEV/i);
    const mrv = screen.getByLabelText(/MRV/i);
    await user.clear(mev);
    await user.type(mev, '18');
    await user.clear(mrv);
    await user.type(mrv, '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(/MRV must be greater than MEV/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers reset-to-default only on a custom band and DELETEs it', async () => {
    const user = userEvent.setup();
    renderEditor({ custom: true, mev: 12, mrv: 22 });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: /reset to default/i }));

    const [url, init] = lastFetchCall(fetchMock);
    expect(url).toBe('/api/volume-targets');
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(init?.body as string)).toEqual({ muscleGroup: 'CHEST' });
    expect(refresh).toHaveBeenCalled();
  });

  it('hides reset-to-default when the band is the default', async () => {
    const user = userEvent.setup();
    renderEditor({ custom: false });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(
      screen.queryByRole('button', { name: /reset to default/i }),
    ).not.toBeInTheDocument();
  });
});
