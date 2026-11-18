import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppleHealthImport } from './apple-health-import';
import { ImportSection } from './import-section';
import type { AppleHealthScanResult } from '@/lib/import/apple-health';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
import { toast } from 'sonner';

// The streaming reader has its own tests (lib/import/apple-health-file.test.ts);
// here it is replaced so the component sees a known scan result.
vi.mock('@/lib/import/apple-health-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/import/apple-health-file')>();
  return { ...actual, readAppleHealthFile: vi.fn() };
});
import { AppleHealthFileError, readAppleHealthFile } from '@/lib/import/apple-health-file';
const mockRead = vi.mocked(readAppleHealthFile);

function workoutAt(index: number) {
  return {
    activityType: 'Running',
    startedAt: new Date(Date.UTC(2020, 0, 1) + index * 86_400_000).toISOString(),
    durationSec: 1800,
    distanceM: 5000,
    avgHr: 150,
    maxHr: 170,
  };
}

const SCAN: AppleHealthScanResult = {
  workouts: [workoutAt(0), workoutAt(1), { ...workoutAt(2), activityType: 'Walking' }],
  skippedStrength: 4,
  skippedInvalid: 1,
  bodyMass: [
    { measuredAt: '2020-01-01T07:00:00.000Z', weightKg: 80, utcOffsetMin: 60 },
    { measuredAt: '2020-01-02T07:00:00.000Z', weightKg: 80.5, utcOffsetMin: 60 },
  ],
};

const PREVIEW = {
  mode: 'preview',
  workouts: {
    importable: 2,
    duplicates: 1,
    conflicts: 0,
    byExercise: [
      { exerciseName: 'Running', count: 1 },
      { exerciseName: 'Walking', count: 1 },
    ],
  },
  bodyMass: { importable: 1, duplicates: 1 },
};

const CONFIRM = {
  mode: 'confirm',
  createdSessions: 2,
  createdSets: 2,
  createdExercises: 2,
  skippedDuplicates: 1,
  skippedConflicts: 0,
  bodyMass: { created: 1, duplicates: 1 },
};

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function exportFile() {
  return new File(['PK'], 'export.zip', { type: 'application/zip' });
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not found');
  return input as HTMLInputElement;
}

function bodyOf(call: unknown[] | undefined) {
  return JSON.parse((call?.[1] as RequestInit).body as string) as {
    mode: string;
    workouts: unknown[];
    bodyMass: unknown[];
  };
}

describe('AppleHealthImport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(ok(PREVIEW));
    vi.stubGlobal('fetch', fetchMock);
    mockRead.mockResolvedValue(SCAN);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the counts of the dry run before anything is imported', async () => {
    const user = userEvent.setup();
    render(<AppleHealthImport />);

    await user.upload(fileInput(), exportFile());
    await waitFor(() => expect(screen.getByTestId('import-preview')).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/import/apple-health');
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.mode).toBe('preview');
    expect(body.workouts).toHaveLength(3);
    expect(body.bodyMass).toHaveLength(2);

    expect(screen.getByText('2 cardio workouts to import')).toBeInTheDocument();
    expect(screen.getByText('Running: 1')).toBeInTheDocument();
    expect(screen.getByText('Walking: 1')).toBeInTheDocument();
    expect(
      screen.getByText('1 workout already in your history will be skipped'),
    ).toBeInTheDocument();
    expect(screen.getByText('4 strength workouts will be skipped')).toBeInTheDocument();
    expect(
      screen.getByText('1 workout without a usable date or duration will be skipped'),
    ).toBeInTheDocument();
    expect(screen.getByText('Also import 1 bodyweight entry')).toBeInTheDocument();
    expect(
      screen.getByText('1 bodyweight entry on days you already logged will be skipped'),
    ).toBeInTheDocument();
  });

  it('imports on the explicit confirm, body weight included by default', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok(PREVIEW)).mockResolvedValueOnce(ok(CONFIRM));
    render(<AppleHealthImport />);

    await user.upload(fileInput(), exportFile());
    await waitFor(() => screen.getByTestId('import-preview'));
    await user.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = bodyOf(fetchMock.mock.calls[1]);
    expect(body.mode).toBe('confirm');
    expect(body.workouts).toHaveLength(3);
    expect(body.bodyMass).toHaveLength(2);
    expect(toast.success).toHaveBeenCalledWith(
      'Imported 2 workouts, 1 bodyweight entry (1 skipped).',
    );
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
  });

  it('leaves body weight out when its switch is turned off', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok(PREVIEW)).mockResolvedValueOnce(ok(CONFIRM));
    render(<AppleHealthImport />);

    await user.upload(fileInput(), exportFile());
    await waitFor(() => screen.getByTestId('import-preview'));
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: /confirm import/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(bodyOf(fetchMock.mock.calls[1]).bodyMass).toEqual([]);
  });

  it('sends a long history in batches within the server cap', async () => {
    const user = userEvent.setup();
    mockRead.mockResolvedValue({
      workouts: Array.from({ length: 1200 }, (_, i) => workoutAt(i)),
      skippedStrength: 0,
      skippedInvalid: 0,
      bodyMass: [],
    });
    render(<AppleHealthImport />);

    await user.upload(fileInput(), exportFile());
    await waitFor(() => screen.getByTestId('import-preview'));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((c) => bodyOf(c).workouts.length)).toEqual([500, 500, 200]);
    // Three batches of the same canned preview, summed.
    expect(screen.getByText('6 cardio workouts to import')).toBeInTheDocument();
    expect(screen.getByText('Running: 3')).toBeInTheDocument();
  });

  it('removes the duplicates inside the file before batching, so preview and confirm agree', async () => {
    const user = userEvent.setup();
    // Workouts 499 and 500 are one effort recorded twice (a minute apart) and
    // would land on either side of the 500-workout batch boundary; another
    // pair sits inside the first batch.
    const twin = (index: number) => ({
      ...workoutAt(index),
      activityType: 'Walking',
      startedAt: new Date(Date.parse(workoutAt(index).startedAt) + 60_000).toISOString(),
    });
    const workouts = [
      ...Array.from({ length: 500 }, (_, i) => workoutAt(i)),
      twin(499),
      ...Array.from({ length: 99 }, (_, i) => workoutAt(500 + i)),
      twin(10),
    ];
    mockRead.mockResolvedValue({ workouts, skippedStrength: 0, skippedInvalid: 0, bodyMass: [] });
    const empty = {
      mode: 'preview',
      workouts: { importable: 0, duplicates: 0, conflicts: 0, byExercise: [] },
      bodyMass: { importable: 0, duplicates: 0 },
    };
    const none = {
      mode: 'confirm',
      createdSessions: 0,
      createdSets: 0,
      createdExercises: 0,
      skippedDuplicates: 0,
      skippedConflicts: 0,
      bodyMass: { created: 0, duplicates: 0 },
    };
    fetchMock
      .mockResolvedValueOnce(
        ok({ ...empty, workouts: { importable: 498, duplicates: 2, conflicts: 0, byExercise: [] } }),
      )
      .mockResolvedValueOnce(
        ok({ ...empty, workouts: { importable: 99, duplicates: 0, conflicts: 0, byExercise: [] } }),
      )
      .mockResolvedValueOnce(ok({ ...none, createdSessions: 498, skippedDuplicates: 2 }))
      .mockResolvedValueOnce(ok({ ...none, createdSessions: 99 }));
    render(<AppleHealthImport />);

    await user.upload(fileInput(), exportFile());
    await waitFor(() => screen.getByTestId('import-preview'));

    // 601 workouts in the file, 599 sent: neither twin reaches the server.
    const previewed = fetchMock.mock.calls.map((c) => bodyOf(c).workouts as Array<{ startedAt: string }>);
    expect(previewed.map((b) => b.length)).toEqual([500, 99]);
    const sent = previewed.flat().map((w) => w.startedAt);
    expect(sent).not.toContain(twin(499).startedAt);
    expect(sent).not.toContain(twin(10).startedAt);
    expect(sent).toContain(workoutAt(499).startedAt);
    // The preview counts them with the duplicates the server found.
    expect(screen.getByText('597 cardio workouts to import')).toBeInTheDocument();
    expect(
      screen.getByText('4 workouts already in your history will be skipped'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /confirm import/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    // Confirm sends exactly what was previewed.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(bodyOf(fetchMock.mock.calls[2]).workouts).toEqual(previewed[0]);
    expect(bodyOf(fetchMock.mock.calls[3]).workouts).toEqual(previewed[1]);
    expect(toast.success).toHaveBeenCalledWith('Imported 597 workouts (4 skipped).');
  });

  it('waits out the import rate limit and retries the same batch', async () => {
    const user = userEvent.setup();
    const sleep = vi.fn().mockResolvedValue(undefined);
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Too many import requests. Retry in 7s.', retryAfterSec: 7 }),
      })
      .mockResolvedValueOnce(ok(PREVIEW));
    render(<AppleHealthImport sleep={sleep} />);

    await user.upload(fileInput(), exportFile());
    await waitFor(() => screen.getByTestId('import-preview'));

    expect(sleep).toHaveBeenCalledWith(7000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual(bodyOf(fetchMock.mock.calls[0]));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('disables confirm when everything is already imported', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      ok({
        mode: 'preview',
        workouts: { importable: 0, duplicates: 3, conflicts: 0, byExercise: [] },
        bodyMass: { importable: 0, duplicates: 2 },
      }),
    );
    render(<AppleHealthImport />);

    await user.upload(fileInput(), exportFile());
    await waitFor(() => screen.getByTestId('import-preview'));

    expect(screen.getByRole('button', { name: /confirm import/i })).toBeDisabled();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('says so when the file holds nothing to import, without calling the API', async () => {
    const user = userEvent.setup();
    mockRead.mockResolvedValue({ workouts: [], skippedStrength: 0, skippedInvalid: 0, bodyMass: [] });
    render(<AppleHealthImport />);

    await user.upload(fileInput(), exportFile());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('No workout or bodyweight entry found in this file.'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains an archive without export.xml', async () => {
    const user = userEvent.setup();
    mockRead.mockRejectedValue(new AppleHealthFileError('no-export-xml'));
    render(<AppleHealthImport />);

    await user.upload(fileInput(), exportFile());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This archive has no export.xml. Pick the export.zip made by the Health app.',
      ),
    );
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
  });

  it('explains an export over the size limit', async () => {
    const user = userEvent.setup();
    mockRead.mockRejectedValue(new AppleHealthFileError('too-large'));
    render(<AppleHealthImport />);

    await user.upload(fileInput(), exportFile());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This export is too large to read here: its data is over 2 GB once unzipped.',
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
  });

  it('surfaces a server rejection and drops the preview', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Date out of range.' }),
    });
    render(<AppleHealthImport />);

    await user.upload(fileInput(), exportFile());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Date out of range.'));
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
  });
});

describe('ImportSection with Apple Health as the source', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(PREVIEW)));
    mockRead.mockResolvedValue(SCAN);
    // Radix Select needs these in jsdom.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.scrollIntoView ??= () => {};
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('offers Apple Health next to the other sources and hands the file to its own flow', async () => {
    const user = userEvent.setup();
    render(<ImportSection />);

    await user.click(screen.getByRole('combobox', { name: /source app/i }));
    await user.click(await screen.findByRole('option', { name: 'Apple Health' }));

    expect(screen.getByRole('heading', { name: 'Import from Apple Health' })).toBeInTheDocument();
    expect(screen.getByText(/Export All Health Data/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose export\.zip/i })).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);

    // A file far over the 5 MB cap of the other imports is fine here: it is
    // streamed on the device, never posted.
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'export.zip');
    await user.upload(fileInput(), big);
    await waitFor(() => screen.getByTestId('import-preview'));
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
