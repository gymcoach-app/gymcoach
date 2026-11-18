import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StravaImport } from './strava-import';
import { ImportSection } from './import-section';
import { ImportCancelledError } from '@/lib/import/import-queue';
import type { StravaArchiveEntry } from '@/lib/import/strava-archive';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
import { toast } from 'sonner';

// The streaming unzip has its own tests (lib/import/strava-archive.test.ts);
// here it is replaced by a reader that hands over a known list of entries the
// same way: one at a time, waiting for the caller, honouring `wants` and the
// abort signal. The passes, the queue and the component are the real ones.
vi.mock('@/lib/import/strava-archive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/import/strava-archive')>();
  return { ...actual, readStravaArchive: vi.fn() };
});
import { readStravaArchive, StravaArchiveError } from '@/lib/import/strava-archive';
const mockRead = vi.mocked(readStravaArchive);

const bytes = (text: string) => new TextEncoder().encode(text);

const CSV = [
  'Activity ID,Activity Date,Activity Name,Activity Type,Filename',
  '1,d,Morning Run,Run,activities/1.gpx',
  '2,d,Evening Ride,Ride,activities/2.tcx',
  '3,d,Watch Run,Run,activities/3.fit.gz',
  '4,d,Seen Before,Run,activities/4.gpx',
  '5,d,Corrupt One,Run,activities/5.gpx',
  '6,d,Yoga,Yoga,',
].join('\n');

const ENTRIES: StravaArchiveEntry[] = [
  { kind: 'csv', text: CSV },
  { kind: 'activity', path: 'activities/1.gpx', format: 'gpx', data: bytes('run-1') },
  { kind: 'activity', path: 'activities/2.tcx', format: 'tcx', data: bytes('ride-2') },
  { kind: 'activity', path: 'activities/3.fit.gz', format: 'fit', data: bytes('run-3') },
  { kind: 'activity', path: 'activities/4.gpx', format: 'gpx', data: bytes('run-dup-4') },
  { kind: 'activity', path: 'activities/5.gpx', format: 'gpx', data: bytes('bad-5') },
  { kind: 'skipped', path: 'activities/7.gpx', reason: 'too-large' },
  { kind: 'skipped', path: 'activities/8.json', reason: 'unsupported' },
];

function readerOf(entries: StravaArchiveEntry[]): typeof readStravaArchive {
  return async (file, options) => {
    let handed = 0;
    for (const entry of entries) {
      if (options.signal?.aborted) throw new ImportCancelledError();
      if (entry.kind === 'activity' && options.wants && !options.wants(entry.path)) continue;
      handed += 1;
      await options.onEntry(entry);
    }
    options.onProgress?.(file.size, file.size);
    return handed;
  };
}

interface Body {
  mode: 'preview' | 'confirm';
  gpx?: string;
  xml?: string;
  fits?: string[];
}

function reply(status: number, json: unknown) {
  return { ok: status < 300, status, headers: new Headers(), json: async () => json };
}

// The three import routes, reduced to what the flow reads from them.
function routes(url: string, init: RequestInit) {
  const body = JSON.parse(init.body as string) as Body;
  const summary = (tag: string) => ({
    mode: body.mode,
    exerciseName: tag.startsWith('ride') ? 'Cycling' : 'Running',
    duplicateSessions: tag.includes('dup') ? ['2024-01-01T00:00:00.000Z'] : [],
    ...(body.mode === 'confirm' ? { createdSessions: 1, createdExercises: 0 } : {}),
  });
  if (url === '/api/import/fit') {
    const tags = (body.fits ?? []).map((b64) => atob(b64));
    return reply(
      200,
      body.mode === 'confirm'
        ? { mode: 'confirm', createdSessions: tags.length, createdExercises: 0, skipped: 0 }
        : {
            mode: 'preview',
            activities: tags.map((tag, index) => ({ index, ok: true, ...summary(tag) })),
          },
    );
  }
  const tag = body.gpx ?? body.xml ?? '';
  if (tag.includes('bad')) return reply(400, { error: 'Unreadable file.' });
  return reply(200, summary(tag));
}

function archiveFile() {
  return new File(['PK'], 'export_123.zip', { type: 'application/zip' });
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not found');
  return input as HTMLInputElement;
}

function callsOf(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: url as string,
    body: JSON.parse((init as RequestInit).body as string) as Body,
  }));
}

describe('StravaImport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async (url: string, init: RequestInit) => routes(url, init));
    vi.stubGlobal('fetch', fetchMock);
    mockRead.mockImplementation(readerOf(ENTRIES));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows one combined preview and writes nothing before the confirm', async () => {
    const user = userEvent.setup();
    render(<StravaImport />);

    await user.upload(fileInput(), archiveFile());
    await waitFor(() => expect(screen.getByTestId('import-preview')).toBeInTheDocument());

    const calls = callsOf(fetchMock);
    expect(calls.map((c) => c.url)).toEqual([
      '/api/import/gpx',
      '/api/import/tcx',
      '/api/import/gpx',
      '/api/import/gpx',
      '/api/import/fit',
    ]);
    expect(calls.every((c) => c.body.mode === 'preview')).toBe(true);

    expect(screen.getByText('3 activities to import')).toBeInTheDocument();
    expect(screen.getByText('Running: 2')).toBeInTheDocument();
    expect(screen.getByText('Cycling: 1')).toBeInTheDocument();
    expect(
      screen.getByText('1 activity already in your history will be skipped'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('1 activity without a file (entered by hand on Strava) will be skipped'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('1 file in a format GymCoach does not read will be skipped'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 file over 5 MB will be skipped')).toBeInTheDocument();
    expect(
      screen.getByText('1 file that could not be read will be skipped'),
    ).toBeInTheDocument();
    // The files left out are listed, named after activities.csv when known.
    expect(screen.getByText('Corrupt One (5.gpx)')).toBeInTheDocument();
    expect(screen.getByText('8.json')).toBeInTheDocument();
    expect(screen.queryByTestId('strava-progress')).not.toBeInTheDocument();
  });

  it('imports the kept files on the explicit confirm', async () => {
    const user = userEvent.setup();
    render(<StravaImport />);

    await user.upload(fileInput(), archiveFile());
    await waitFor(() => screen.getByTestId('import-preview'));
    fetchMock.mockClear();
    await user.click(screen.getByRole('button', { name: 'Import 3 sessions' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const calls = callsOf(fetchMock);
    expect(calls.every((c) => c.body.mode === 'confirm')).toBe(true);
    // The duplicate and the unreadable file are not sent again.
    expect(calls.map((c) => c.url)).toEqual([
      '/api/import/gpx',
      '/api/import/tcx',
      '/api/import/fit',
    ]);
    expect(calls[0]!.body.gpx).toBe('run-1');
    expect(calls[2]!.body.fits).toEqual([btoa('run-3')]);
    expect(toast.success).toHaveBeenCalledWith('Imported 3 activities.');
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
  });

  it('waits out the import rate limit and sends the same request again', async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const sleep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    fetchMock.mockImplementationOnce(async () =>
      reply(429, { error: 'Too many import requests. Retry in 21s.' }),
    );
    render(<StravaImport sleep={sleep} />);

    await user.upload(fileInput(), archiveFile());
    await waitFor(() =>
      expect(screen.getByText('Import limit reached, continuing in 21 s')).toBeInTheDocument(),
    );
    expect(sleep).toHaveBeenCalledWith(21_000, expect.anything());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => screen.getByTestId('import-preview'));
    const calls = callsOf(fetchMock);
    expect(calls[1]).toEqual(calls[0]);
    expect(screen.getByText('3 activities to import')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('cancels the check on request, and sends nothing more', async () => {
    const user = userEvent.setup();
    // The first answer never comes: the flow is parked on it.
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    render(<StravaImport />);

    await user.upload(fileInput(), archiveFile());
    await waitFor(() => expect(screen.getByTestId('strava-progress')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith('Import cancelled. Nothing was imported.'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('strava-progress')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
  });

  it('says that what was written stays when the import itself is cancelled', async () => {
    const user = userEvent.setup();
    render(<StravaImport />);

    await user.upload(fileInput(), archiveFile());
    await waitFor(() => screen.getByTestId('import-preview'));
    fetchMock.mockClear();
    // First confirm request goes through, the second one hangs.
    fetchMock
      .mockImplementationOnce(async (url: string, init: RequestInit) => routes(url, init))
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      );
    await user.click(screen.getByRole('button', { name: 'Import 3 sessions' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        'Import cancelled. The activities already imported stay in your history.',
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('disables the confirm when nothing is left to import', async () => {
    const user = userEvent.setup();
    mockRead.mockImplementation(readerOf([ENTRIES[4]!]));
    render(<StravaImport />);

    await user.upload(fileInput(), archiveFile());
    await waitFor(() => screen.getByTestId('import-preview'));
    expect(screen.getByText('0 activities to import')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 0 sessions' })).toBeDisabled();
  });

  it('explains a zip that is not a Strava archive, without calling the API', async () => {
    const user = userEvent.setup();
    mockRead.mockRejectedValue(new StravaArchiveError('not-strava'));
    render(<StravaImport />);

    await user.upload(fileInput(), archiveFile());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This archive has no activities.csv and no activities folder. Pick the zip Strava emailed you.',
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
  });

  it('surfaces a server failure and drops the run', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(async () => reply(401, { error: 'Not signed in.' }));
    render(<StravaImport />);

    await user.upload(fileInput(), archiveFile());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Not signed in.'));
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('strava-progress')).not.toBeInTheDocument();
  });
});

describe('ImportSection with Strava as the source', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => routes(url, init)),
    );
    mockRead.mockImplementation(readerOf(ENTRIES));
    // Radix Select needs these in jsdom.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.scrollIntoView ??= () => {};
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('offers Strava next to the other sources and hands the archive to its own flow', async () => {
    const user = userEvent.setup();
    render(<ImportSection />);

    await user.click(screen.getByRole('combobox', { name: /source app/i }));
    await user.click(await screen.findByRole('option', { name: 'Strava' }));

    expect(screen.getByRole('heading', { name: 'Import from Strava' })).toBeInTheDocument();
    expect(screen.getByText(/Download or Delete Your Account/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose the Strava archive' })).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);

    // An archive far over the 5 MB cap of the single-file imports is fine: it
    // is unzipped on the device, never posted whole.
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'export_1.zip');
    await user.upload(fileInput(), big);
    await waitFor(() => screen.getByTestId('import-preview'));
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
