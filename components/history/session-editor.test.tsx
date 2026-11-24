import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exercise } from '@/lib/prisma-client';
import { SessionEditor, type EditorSet } from './session-editor';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

function exercise(id: string, name: string, category: Exercise['category']): Exercise {
  return {
    id,
    userId: 'u1',
    name,
    muscleGroup: category === 'CARDIO' ? 'OTHER' : 'CHEST',
    category,
    defaultRestSec: 90,
    notes: null,
    usesBodyweight: false,
    equipmentType: 'OTHER',
    isFavorite: false,
    createdAt: new Date(0),
  } as Exercise;
}

const bench = exercise('bench', 'Editor Bench', 'COMPOUND');
const run = exercise('run', 'Editor Run', 'CARDIO');
const curl = exercise('curl', 'Editor Curl', 'ISOLATION');

function strengthSet(id: string, setNumber: number, overrides: Partial<EditorSet> = {}): EditorSet {
  return {
    id,
    exerciseId: 'bench',
    gymEquipmentId: null,
    setNumber,
    weight: 100,
    reps: 5,
    rir: 2,
    durationSec: null,
    distanceM: null,
    avgHr: null,
    maxHr: null,
    notes: null,
    isWarmup: false,
    isDropSet: false,
    block: null,
    ...overrides,
  };
}

// 18:30 on 2026-11-20 in the zone the test runs in, for 47 minutes.
const STARTED_AT = new Date(2026, 10, 20, 18, 30);
const FINISHED_AT = new Date(STARTED_AT.getTime() + 47 * 60 * 1000);

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
  HTMLElement.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const threeSets = [strengthSet('s1', 1), strengthSet('s2', 2), strengthSet('s3', 3)];

// Each test renders only the cards it reads: a card mounts a whole set table,
// and the unit tier runs on a loaded machine (lesson L42).
function renderEditor(sets: EditorSet[] = threeSets, exercises: Exercise[] = [bench]) {
  render(
    <SessionEditor
      sessionId="sess-1"
      title="Push day"
      startedAt={STARTED_AT.toISOString()}
      finishedAt={FINISHED_AT.toISOString()}
      groups={exercises.map((item) => ({ exercise: item, block: null }))}
      sets={sets}
      catalog={[bench, run, curl]}
      unit="KG"
    />,
  );
}

function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init ?? {}));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

describe('SessionEditor (issue #389)', () => {
  it('shows the date, start time and duration in the local zone and saves them as an instant', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    renderEditor([], []);
    expect(screen.getByText('No exercise yet. Add one to enter its sets.')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));
    expect(screen.getByLabelText('Start time')).toHaveValue('18:30');
    expect(screen.getByLabelText('Duration (min)')).toHaveValue(47);

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-18' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '07:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Date and duration saved.'));
    const call = fetchMock.mock.calls[0] as unknown[];
    expect(call[0]).toBe('/api/sessions/sess-1');
    expect((call[1] as RequestInit).method).toBe('PATCH');
    expect(bodyOf(call)).toEqual({
      startedAt: new Date(2026, 10, 18, 7, 15).toISOString(),
      durationMin: 47,
    });
  });

  it('refuses a future date without calling the server', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    renderEditor([], []);
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(toast.error).toHaveBeenCalledWith('A workout cannot be in the future.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds a set to the finished session with amend and the next set number', async () => {
    const created = strengthSet('s4', 4);
    const fetchMock = stubFetch(() => new Response(JSON.stringify(created), { status: 201 }));
    renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm set 4' }));

    await waitFor(() => expect(screen.getByTestId('amend-set-row-4')).toBeInTheDocument());
    const call = fetchMock.mock.calls[0] as unknown[];
    expect(call[0]).toBe('/api/sessions/sess-1/sets');
    expect(bodyOf(call)).toEqual({
      exerciseId: 'bench',
      setNumber: 4,
      block: null,
      weight: 100,
      reps: 5,
      rir: 2,
      amend: true,
    });
    expect(screen.getByRole('button', { name: 'Confirm set 5' })).toBeInTheDocument();
  });

  it('keeps the list as it was when the server refuses a set', async () => {
    stubFetch(() => new Response('{"error":"nope"}', { status: 400 }));
    renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm set 4' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save the set.'));
    expect(screen.queryByTestId('amend-set-row-4')).not.toBeInTheDocument();
  });

  it('marks a set as a warm-up through the set route, with amend', async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify(strengthSet('s1', 1, { isWarmup: true })), { status: 200 }),
    );
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Actions for set 1' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Warmup' }));

    await waitFor(() => expect(screen.getByTestId('amend-set-row-1')).toHaveTextContent('Warmup'));
    const call = fetchMock.mock.calls[0] as unknown[];
    expect(call[0]).toBe('/api/sets/s1');
    expect((call[1] as RequestInit).method).toBe('PATCH');
    expect(bodyOf(call)).toEqual({
      weight: 100,
      reps: 5,
      rir: 2,
      isWarmup: true,
      isDropSet: false,
      amend: true,
    });
  });

  it('deletes a set and closes the gap in the numbers, like the server', async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(() => new Response('{"ok":true}', { status: 200 }));
    renderEditor([
      strengthSet('s1', 1),
      strengthSet('s2', 2, { weight: 110 }),
      strengthSet('s3', 3, { weight: 120 }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Actions for set 2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete set 2' }));

    await waitFor(() => expect(screen.queryByTestId('amend-set-row-3')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/sets/s2');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE');
    // The 120 kg set moved up to number 2.
    expect(screen.getByRole('button', { name: 'Set 2 weight in KG' })).toHaveTextContent('120');
    expect(screen.getByRole('button', { name: 'Confirm set 3' })).toBeInTheDocument();
  });

  it('enters a cardio set with the cardio fields', async () => {
    const fetchMock = stubFetch(
      () =>
        new Response(
          JSON.stringify(
            strengthSet('c1', 1, {
              exerciseId: 'run',
              weight: 0,
              reps: 1,
              rir: null,
              durationSec: 1500,
              distanceM: 5000,
            }),
          ),
          { status: 201 },
        ),
    );
    renderEditor([], [run]);
    const card = screen.getByTestId('session-edit-exercise');

    fireEvent.change(within(card).getByLabelText('Set 1 duration (mm:ss)'), {
      target: { value: '25:00' },
    });
    fireEvent.change(within(card).getByLabelText('Set 1 distance (km)'), { target: { value: '5' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Add set 1' }));

    await waitFor(() => expect(within(card).getByTestId('cardio-set-row-1')).toBeInTheDocument());
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[])).toEqual({
      exerciseId: 'run',
      setNumber: 1,
      block: null,
      weight: 0,
      reps: 1,
      durationSec: 1500,
      distanceM: 5000,
      avgHr: null,
      maxHr: null,
      amend: true,
    });
  });

  it('adds an exercise from the catalog, offering only the ones not in the session', async () => {
    renderEditor([], [run]);
    expect(screen.getAllByTestId('session-edit-exercise')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Add an exercise' }));
    expect(screen.queryByRole('button', { name: 'Editor Run' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editor Bench' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editor Curl' }));

    const cards = screen.getAllByTestId('session-edit-exercise');
    expect(cards).toHaveLength(2);
    expect(cards[1]).toHaveTextContent('Editor Curl');
    expect(
      within(cards[1] as HTMLElement).getByRole('button', { name: 'Confirm set 1' }),
    ).toBeInTheDocument();
  });

  it('goes back to the session and refreshes it when done', () => {
    renderEditor([], []);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(router.push).toHaveBeenCalledWith('/history/sess-1');
    expect(router.refresh).toHaveBeenCalled();
  });
});
