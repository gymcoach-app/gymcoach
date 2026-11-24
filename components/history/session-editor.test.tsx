import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Exercise } from '@/lib/prisma-client';
import type { EditableSetsTable } from '@/components/session/editable-sets-table';
import { SessionEditor, type EditorSet } from './session-editor';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

// The set table has its own suite (editable-sets-table.test.tsx, amend mode
// included) and is heavy to mount in jsdom (lesson L42). This suite is about
// what the editor does with the table's callbacks, so the table is replaced
// by a stand-in that exposes them as plain buttons. The two together are
// exercised for real by tests/e2e/edit-past-session.spec.ts.
type TableProps = Parameters<typeof EditableSetsTable>[0];
vi.mock('@/components/session/editable-sets-table', () => ({
  EditableSetsTable: ({
    programExercise,
    sets,
    onSubmit,
    onDeleteSet,
    onUpdateSet,
    amend,
  }: TableProps) => (
    <div
      data-testid="sets-table"
      data-exercise={programExercise.exerciseId}
      data-amend={amend ? 'yes' : 'no'}
    >
      {sets.map((set) => (
        <div key={set.localId} data-testid={`amend-set-row-${set.setNumber}`}>
          <span>
            {set.weight} x {set.reps} {set.isWarmup ? 'warm-up' : set.isDropSet ? 'drop' : 'work'}
          </span>
          <button
            type="button"
            onClick={() =>
              void onUpdateSet(set, { weight: set.weight + 5, reps: set.reps, rir: set.rir }).catch(
                () => undefined,
              )
            }
          >
            heavier {set.setNumber}
          </button>
          <button type="button" onClick={() => void amend?.onSetTypeChange(set, 'warmup')}>
            warm-up {set.setNumber}
          </button>
          <button type="button" onClick={() => void onDeleteSet(set)}>
            delete {set.setNumber}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          void onSubmit({
            weight: 100,
            reps: 5,
            rir: 2,
            durationSec: null,
            distanceM: null,
            isWarmup: false,
            isDropSet: false,
            notes: null,
            gymEquipmentId: null,
          })
        }
      >
        add set
      </button>
    </div>
  ),
}));

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const twoSets = [strengthSet('s1', 1), strengthSet('s2', 2)];

function renderEditor(
  sets: EditorSet[] = twoSets,
  groups: { exercise: Exercise; block: number | null }[] = [{ exercise: bench, block: null }],
) {
  render(
    <SessionEditor
      sessionId="sess-1"
      title="Push day"
      startedAt={STARTED_AT.toISOString()}
      finishedAt={FINISHED_AT.toISOString()}
      groups={groups}
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

function requestOf(call: unknown[] | undefined) {
  if (!call) throw new Error('no request was sent');
  const init = call[1] as RequestInit;
  return {
    url: call[0] as string,
    method: init.method,
    body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined,
  };
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
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Date and duration saved.'));
    expect(requestOf(fetchMock.mock.calls[0])).toEqual({
      url: '/api/sessions/sess-1',
      method: 'PATCH',
      body: { startedAt: new Date(2026, 10, 18, 7, 15).toISOString(), durationMin: 47 },
    });
  });

  it('refuses a future date without calling the server', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    renderEditor([], []);
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByText('Save'));

    expect(toast.error).toHaveBeenCalledWith('A workout cannot be in the future.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says so when the server refuses the new date', async () => {
    stubFetch(() => new Response('{"error":"A session cannot be in the future."}', { status: 400 }));
    renderEditor([], []);
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not save the date and duration.'),
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('hands the table its sets in amend mode, in set order', () => {
    renderEditor([strengthSet('s2', 2, { weight: 110 }), strengthSet('s1', 1, { isWarmup: true })]);
    const table = screen.getByTestId('sets-table');
    expect(table).toHaveAttribute('data-exercise', 'bench');
    expect(table).toHaveAttribute('data-amend', 'yes');
    expect(screen.getByTestId('amend-set-row-1')).toHaveTextContent('100 x 5 warm-up');
    expect(screen.getByTestId('amend-set-row-2')).toHaveTextContent('110 x 5 work');
  });

  it('adds a set to the finished session with amend and the next set number', async () => {
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify(strengthSet('s3', 3)), { status: 201 }),
    );
    renderEditor();

    fireEvent.click(screen.getByText('add set'));

    await waitFor(() => expect(screen.getByTestId('amend-set-row-3')).toBeInTheDocument());
    expect(requestOf(fetchMock.mock.calls[0])).toEqual({
      url: '/api/sessions/sess-1/sets',
      method: 'POST',
      body: {
        exerciseId: 'bench',
        setNumber: 3,
        block: null,
        weight: 100,
        reps: 5,
        rir: 2,
        amend: true,
      },
    });
    expect(toast.success).toHaveBeenCalledWith('Set saved.');
  });

  it('sends the block of a later block of a repeated exercise, and keeps its sets apart', async () => {
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify(strengthSet('b2', 1, { block: 1 })), { status: 201 }),
    );
    renderEditor(
      [strengthSet('s1', 1), strengthSet('s2', 2, { block: 0 })],
      [
        { exercise: bench, block: null },
        { exercise: bench, block: 1 },
      ],
    );
    const [first, second] = screen.getAllByTestId('sets-table') as [HTMLElement, HTMLElement];
    // Block 0 and no block are the same, first, card.
    expect(within(first).getAllByTestId(/amend-set-row/)).toHaveLength(2);
    expect(within(second).queryAllByTestId(/amend-set-row/)).toHaveLength(0);

    fireEvent.click(within(second).getByText('add set'));

    await waitFor(() => expect(within(second).getByTestId('amend-set-row-1')).toBeInTheDocument());
    expect(requestOf(fetchMock.mock.calls[0]).body).toMatchObject({ setNumber: 1, block: 1 });
    expect(within(first).getAllByTestId(/amend-set-row/)).toHaveLength(2);
  });

  it('keeps the list as it was when the server refuses a set', async () => {
    stubFetch(() => new Response('{"error":"nope"}', { status: 400 }));
    renderEditor();

    fireEvent.click(screen.getByText('add set'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save the set.'));
    expect(screen.queryByTestId('amend-set-row-3')).not.toBeInTheDocument();
  });

  it('corrects the values of a set through the set route, with amend', async () => {
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify(strengthSet('s1', 1, { weight: 105 })), { status: 200 }),
    );
    renderEditor();

    fireEvent.click(screen.getByText('heavier 1'));

    await waitFor(() => expect(screen.getByTestId('amend-set-row-1')).toHaveTextContent('105 x 5'));
    expect(requestOf(fetchMock.mock.calls[0])).toEqual({
      url: '/api/sets/s1',
      method: 'PATCH',
      body: { weight: 105, reps: 5, rir: 2, amend: true },
    });
  });

  it('keeps the stored values when the server refuses an edit', async () => {
    stubFetch(() => new Response('{"error":"nope"}', { status: 400 }));
    renderEditor();

    fireEvent.click(screen.getByText('heavier 1'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save the set.'));
    expect(screen.getByTestId('amend-set-row-1')).toHaveTextContent('100 x 5');
  });

  it('marks a set as a warm-up, sending its values along with the type', async () => {
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify(strengthSet('s1', 1, { isWarmup: true })), { status: 200 }),
    );
    renderEditor();

    fireEvent.click(screen.getByText('warm-up 1'));

    await waitFor(() => expect(screen.getByTestId('amend-set-row-1')).toHaveTextContent('warm-up'));
    expect(requestOf(fetchMock.mock.calls[0])).toEqual({
      url: '/api/sets/s1',
      method: 'PATCH',
      body: { weight: 100, reps: 5, rir: 2, isWarmup: true, isDropSet: false, amend: true },
    });
  });

  it('deletes a set and closes the gap in the numbers, like the server', async () => {
    const fetchMock = stubFetch(() => new Response('{"ok":true}', { status: 200 }));
    renderEditor([
      strengthSet('s1', 1),
      strengthSet('s2', 2, { weight: 110 }),
      strengthSet('s3', 3, { weight: 120 }),
    ]);

    fireEvent.click(screen.getByText('delete 2'));

    await waitFor(() => expect(screen.queryByTestId('amend-set-row-3')).not.toBeInTheDocument());
    expect(requestOf(fetchMock.mock.calls[0])).toEqual({
      url: '/api/sets/s2',
      method: 'DELETE',
      body: undefined,
    });
    // The 120 kg set moved up to number 2.
    expect(screen.getByTestId('amend-set-row-2')).toHaveTextContent('120 x 5');
    expect(toast.success).toHaveBeenCalledWith('Set deleted.');
  });

  it('keeps the set when the delete fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    renderEditor();

    fireEvent.click(screen.getByText('delete 2'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not delete the set.'));
    expect(screen.getByTestId('amend-set-row-2')).toBeInTheDocument();
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
    renderEditor([], [{ exercise: run, block: null }]);
    const card = screen.getByTestId('session-edit-exercise');

    fireEvent.change(within(card).getByLabelText('Set 1 duration (mm:ss)'), {
      target: { value: '25:00' },
    });
    fireEvent.change(within(card).getByLabelText('Set 1 distance (km)'), { target: { value: '5' } });
    fireEvent.click(within(card).getByLabelText('Add set 1'));

    await waitFor(() => expect(within(card).getByTestId('cardio-set-row-1')).toBeInTheDocument());
    expect(requestOf(fetchMock.mock.calls[0]).body).toEqual({
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

  it('adds an exercise from the catalog, offering only the ones not in the session', () => {
    renderEditor([], [{ exercise: run, block: null }]);
    expect(screen.getAllByTestId('session-edit-exercise')).toHaveLength(1);

    fireEvent.click(screen.getByText('Add an exercise'));
    // "Editor Run" is the title of its card, and no longer a choice.
    expect(screen.getAllByText('Editor Run')).toHaveLength(1);
    expect(screen.getByText('Editor Bench')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Editor Curl'));

    const cards = screen.getAllByTestId('session-edit-exercise');
    expect(cards).toHaveLength(2);
    expect(cards[1]).toHaveTextContent('Editor Curl');
    expect(within(cards[1] as HTMLElement).getByTestId('sets-table')).toHaveAttribute(
      'data-exercise',
      'curl',
    );
  });

  it('goes back to the session and refreshes it when done', () => {
    renderEditor([], []);
    fireEvent.click(screen.getByText('Done'));
    expect(router.push).toHaveBeenCalledWith('/history/sess-1');
    expect(router.refresh).toHaveBeenCalled();
  });
});
