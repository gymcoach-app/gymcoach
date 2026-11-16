import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AttachWatchFileButton,
  RemoveWatchFileButton,
  watchFormatOf,
} from './attach-watch-file-button';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const PREVIEW = {
  mode: 'preview',
  avgHr: 118,
  maxHr: 165,
  startedAt: '2026-06-10T07:30:00.000Z',
  durationSec: 3600,
  offsetMinutes: 2,
  farFromSession: false,
  replaces: false,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function open() {
  render(<AttachWatchFileButton sessionId="s1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Attach a watch file' }));
}

function pick(file: File) {
  fireEvent.change(screen.getByLabelText('Watch file (.fit, .tcx, .gpx)'), {
    target: { files: [file] },
  });
}

function bodyOf(call: unknown[]) {
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe('watchFormatOf', () => {
  it('reads the format from the extension, case-insensitively', () => {
    expect(watchFormatOf('leg-day.FIT')).toBe('fit');
    expect(watchFormatOf('activity.2026.tcx')).toBe('tcx');
    expect(watchFormatOf('track.gpx')).toBe('gpx');
    expect(watchFormatOf('history.csv')).toBeNull();
    expect(watchFormatOf('fit')).toBeNull();
  });
});

describe('AttachWatchFileButton (issue #562)', () => {
  it('previews a TCX file as text, then attaches it on confirm', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(PREVIEW))
      .mockResolvedValueOnce(json({ ...PREVIEW, mode: 'confirm' }));
    vi.stubGlobal('fetch', fetchMock);
    open();
    pick(new File(['<TrainingCenterDatabase/>'], 'legs.tcx'));

    expect(await screen.findByText('118 bpm')).toBeInTheDocument();
    expect(screen.getByText('165 bpm')).toBeInTheDocument();
    expect(screen.getByText('1:00:00')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/replaces the heart rate/)).toBeNull();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/sessions/s1/watch-file');
    expect(bodyOf(fetchMock.mock.calls[0]!)).toEqual({
      format: 'tcx',
      file: '<TrainingCenterDatabase/>',
      mode: 'preview',
    });
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Heart rate attached.'));
    expect(bodyOf(fetchMock.mock.calls[1]!)).toEqual({
      format: 'tcx',
      file: '<TrainingCenterDatabase/>',
      mode: 'confirm',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('sends a FIT file base64-encoded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(PREVIEW));
    vi.stubGlobal('fetch', fetchMock);
    open();
    pick(new File([new Uint8Array([0x0e, 0x02, 0xff, 0x00])], 'legs.fit'));

    await screen.findByText('118 bpm');
    expect(bodyOf(fetchMock.mock.calls[0]!)).toEqual({
      format: 'fit',
      file: 'DgL/AA==',
      mode: 'preview',
    });
  });

  it('warns when the recording is far from the session and when it replaces data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ ...PREVIEW, farFromSession: true, replaces: true })),
    );
    open();
    pick(new File(['<gpx/>'], 'legs.gpx'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This recording starts more than 6 hours away from this session.',
    );
    expect(
      screen.getByText('This replaces the heart rate already attached to this session.'),
    ).toBeInTheDocument();
    // The warning does not block: the confirm action stays available.
    expect(screen.getByRole('button', { name: 'Attach' })).toBeEnabled();
  });

  it('refuses another extension without calling the server', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    open();
    pick(new File(['a,b'], 'history.csv'));

    expect(toast.error).toHaveBeenCalledWith('Choose a .fit, .tcx or .gpx file.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull();
  });

  it('says so when the file has no heart rate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ error: 'This file has no heart rate data.' }, 400)),
    );
    open();
    pick(new File(['<gpx/>'], 'ride.gpx'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('This file has no heart rate data.'),
    );
    expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull();
  });

  it('shows the generic read error on an unreadable file, offline included', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    open();
    pick(new File(['junk'], 'broken.tcx'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not read this file.'));
    expect(screen.queryByRole('button', { name: 'Attach' })).toBeNull();
  });

  it('keeps the dialog open with an error toast when the confirm fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(PREVIEW))
      .mockResolvedValueOnce(json({ error: 'Session not found.' }, 404));
    vi.stubGlobal('fetch', fetchMock);
    open();
    pick(new File(['<gpx/>'], 'legs.gpx'));
    await screen.findByText('118 bpm');

    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not attach the file.'));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Attach' })).toBeEnabled();
  });
});

describe('RemoveWatchFileButton (issue #562)', () => {
  it('clears the attached heart rate and refreshes the page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RemoveWatchFileButton sessionId="s1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Heart rate removed.'));
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/watch-file', { method: 'DELETE' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the error toast when the removal fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'nope' }, 404)));
    render(<RemoveWatchFileButton sessionId="s1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not remove the heart rate.'),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
