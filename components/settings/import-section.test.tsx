import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportSection } from './import-section';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
import { toast } from 'sonner';

const PREVIEW = {
  mode: 'preview',
  sessions: 2,
  sets: 3,
  newExercises: ['Bench Press'],
  existingSessionDates: [],
  duplicatesSkipped: 0,
  cardioSets: 1,
  cardioSkipped: 1,
  nonSetRowsSkipped: 3,
  errorCount: 1,
  errors: [{ line: 4, reason: 'Invalid or missing date.' }],
};

function csvFile(content = 'Date,Workout Name\n') {
  return new File([content], 'strong.csv', { type: 'text/csv' });
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not found');
  return input as HTMLInputElement;
}

describe('ImportSection', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => PREVIEW });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('previews the picked file before any import', async () => {
    const user = userEvent.setup();
    render(<ImportSection />);

    await user.upload(fileInput(), csvFile());

    await waitFor(() => {
      expect(screen.getByTestId('import-preview')).toBeInTheDocument();
    });
    // Dry run only: one POST in preview mode.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string,
    ) as { mode: string; unit: string };
    expect(body.mode).toBe('preview');
    expect(body.unit).toBe('KG');

    expect(screen.getByText(/2 sessions, 3 sets to import/)).toBeInTheDocument();
    expect(screen.getByText(/1 new exercise will be created/)).toBeInTheDocument();
    expect(screen.getByText(/1 cardio set \(duration\/distance\) included/)).toBeInTheDocument();
    expect(screen.getByText(/1 cardio row without a usable duration/)).toBeInTheDocument();
    expect(
      screen.getByText(/3 rest timer or note rows \(not sets\) will be skipped/),
    ).toBeInTheDocument();
    expect(screen.getByText(/line 4: invalid or missing date/i)).toBeInTheDocument();
  });

  it('confirms only on the explicit button, in confirm mode', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => PREVIEW })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          mode: 'confirm',
          createdSessions: 2,
          createdSets: 3,
          createdExercises: 1,
        }),
      });
    render(<ImportSection />);

    await user.upload(fileInput(), csvFile());
    await waitFor(() => screen.getByTestId('import-preview'));
    await user.click(screen.getByRole('button', { name: /confirm import/i }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(
      (fetchMock.mock.calls[1]?.[1] as RequestInit).body as string,
    ) as { mode: string };
    expect(body.mode).toBe('confirm');
    expect(toast.success).toHaveBeenCalled();
  });

  it('rejects an oversized file client-side without calling the API', async () => {
    const user = userEvent.setup();
    render(<ImportSection />);

    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.csv', {
      type: 'text/csv',
    });
    await user.upload(fileInput(), big);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('A file is too large: the limit is 5 MB each.');
  });

  it('surfaces a server rejection and resets the picker', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Unrecognized format.' }),
    });
    render(<ImportSection />);

    await user.upload(fileInput(), csvFile('foo,bar\n'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Unrecognized format.');
    });
    expect(screen.queryByTestId('import-preview')).not.toBeInTheDocument();
  });
});
