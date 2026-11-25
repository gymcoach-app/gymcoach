// @vitest-environment jsdom
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
    disabled,
  }: TableProps) => (
    <div
      data-testid="sets-table"
      data-exercise={programExercise.exerciseId}
      data-amend={amend ? 'yes' : 'no'}
      data-disabled={disabled ? 'yes' : 'no'}
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const twoSets = [strengthSet('s1', 1), strengthSet('s2', 2)];

// The answer of PATCH /api/sessions/[id]: the session as stored.
function movedTo(startedAt: Date, minutes: number): Response {
  return new Response(
    JSON.stringify({
      startedAt: startedAt.toISOString(),
      finishedAt: new Date(startedAt.getTime() + minutes * 60 * 1000).toISOString(),
    }),
    { status: 200 },
  );
}

function renderEditor(
  sets: EditorSet[] = twoSets,
  groups: { exercise: Exercise; block: number | null }[] = [{ exercise: bench, block: null }],
  startedAt: Date = STARTED_AT,
  discardable = true,
) {
  render(
    <SessionEditor
      sessionId="sess-1"
      title="Push day"
      startedAt={startedAt.toISOString()}
      finishedAt={new Date(startedAt.getTime() + 47 * 60 * 1000).toISOString()}
      groups={groups}
      sets={sets}
      catalog={[bench, run, curl]}
      unit="KG"
      discardable={discardable}
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
    const fetchMock = stubFetch(() => movedTo(new Date(2026, 10, 18, 7, 15), 47));
    renderEditor([], []);
    expect(screen.getByText('No exercise yet. Add one to enter its sets.')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));
    expect(screen.getByLabelText('Start time')).toHaveValue('18:30');
    expect(screen.getByLabelText('Duration (min)')).toHaveValue(47);

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-18' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '07:15' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Date and duration saved.'));
    // Only the start changed, so only the start is sent.
    expect(requestOf(fetchMock.mock.calls[0])).toEqual({
      url: '/api/sessions/sess-1',
      method: 'PATCH',
      body: { startedAt: new Date(2026, 10, 18, 7, 15).toISOString() },
    });
    // The form now shows what the server stored, and has nothing left to save.
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-18'));
    expect(screen.getByText('Save').closest('button')).toBeDisabled();
  });

  it('writes nothing when Save is pressed on an untouched form, seconds in the start included', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    renderEditor([], [], new Date(STARTED_AT.getTime() + 27_450));
    await waitFor(() => expect(screen.getByLabelText('Start time')).toHaveValue('18:30'));

    const save = screen.getByText('Save').closest('button') as HTMLButtonElement;
    expect(save).toBeDisabled();
    fireEvent.click(save);
    // Retyping the same values is not a change either.
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '18:31' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '18:30' } });
    expect(save).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends only the duration when only the duration changed', async () => {
    const fetchMock = stubFetch(() => movedTo(STARTED_AT, 60));
    renderEditor([], [], new Date(STARTED_AT.getTime() + 27_000));
    await waitFor(() => expect(screen.getByLabelText('Duration (min)')).toHaveValue(47));

    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '60' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Date and duration saved.'));
    expect(requestOf(fetchMock.mock.calls[0]).body).toEqual({ durationMin: 60 });
  });

  it('locks the set tables while the date is being saved', async () => {
    let release: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    renderEditor();
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));
    expect(screen.getByTestId('sets-table')).toHaveAttribute('data-disabled', 'no');

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-18' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(screen.getByTestId('sets-table')).toHaveAttribute('data-disabled', 'yes'),
    );

    release(movedTo(new Date(2026, 10, 18, 18, 30), 47));
    await waitFor(() =>
      expect(screen.getByTestId('sets-table')).toHaveAttribute('data-disabled', 'no'),
    );
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

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-19' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not save the date and duration.'),
    );
    // What was typed stays, still unsaved.
    expect(screen.getByLabelText('Date')).toHaveValue('2026-11-19');
    expect(screen.getByText('Save').closest('button')).toBeEnabled();
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

  it('deletes a set, leaves the stored numbers alone and counts the rows that remain', async () => {
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
    // Only the delete was sent: no set is renumbered. The 120 kg set keeps
    // its stored number 3 and is simply the second row now.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('amend-set-row-2')).toHaveTextContent('120 x 5');
    expect(toast.success).toHaveBeenCalledWith('Set deleted.');
  });

  it('shows rows by position when stored numbers have gaps or repeat, and lets the server number a new set', async () => {
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify(strengthSet('new', 8, { weight: 90 })), { status: 201 }),
    );
    renderEditor([
      strengthSet('a', 3, { weight: 60 }),
      strengthSet('b', 3, { weight: 70 }),
      strengthSet('c', 7, { weight: 80 }),
    ]);
    expect(screen.getByTestId('amend-set-row-1')).toHaveTextContent('60 x 5');
    expect(screen.getByTestId('amend-set-row-2')).toHaveTextContent('70 x 5');
    expect(screen.getByTestId('amend-set-row-3')).toHaveTextContent('80 x 5');

    fireEvent.click(screen.getByText('add set'));

    // The set the server stored as number 8 is the fourth row.
    await waitFor(() => expect(screen.getByTestId('amend-set-row-4')).toHaveTextContent('90 x 5'));
    expect(requestOf(fetchMock.mock.calls[0]).body).toMatchObject({ setNumber: 4, amend: true });
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

  it('goes back to the session and refreshes it when done', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    renderEditor();
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));
    fireEvent.click(screen.getByText('Done'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/history/sess-1'));
    expect(router.refresh).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves a pending date change on Done instead of dropping it', async () => {
    const fetchMock = stubFetch(() => movedTo(new Date(2026, 10, 18, 18, 30), 47));
    renderEditor();
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-18' } });
    fireEvent.click(screen.getByText('Done'));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/history/sess-1'));
    expect(requestOf(fetchMock.mock.calls[0])).toEqual({
      url: '/api/sessions/sess-1',
      method: 'PATCH',
      body: { startedAt: new Date(2026, 10, 18, 18, 30).toISOString() },
    });
  });

  it('stays in the editor when the pending date change cannot be saved', async () => {
    stubFetch(() => new Response('{"error":"nope"}', { status: 400 }));
    renderEditor();
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-18' } });
    fireEvent.click(screen.getByText('Done'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not save the date and duration.'),
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Date')).toHaveValue('2026-11-18');
  });

  it('asks before leaving a workout without any set, and can keep it', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    renderEditor([], []);
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));

    fireEvent.click(screen.getByText('Done'));
    expect(await screen.findByText('Keep this empty workout?')).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Keep it'));
    expect(router.push).toHaveBeenCalledWith('/history/sess-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('discards an empty workout through the route that refuses a session with sets', async () => {
    const fetchMock = stubFetch(() => new Response('{"ok":true}', { status: 200 }));
    renderEditor([], []);
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));

    fireEvent.click(screen.getByText('Done'));
    fireEvent.click(await screen.findByText('Discard it'));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/history'));
    expect(requestOf(fetchMock.mock.calls[0])).toEqual({
      url: '/api/sessions/sess-1?discardEmpty=1',
      method: 'DELETE',
      body: undefined,
    });
  });

  it('does not offer to discard an empty workout that has notes or a watch recording', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    renderEditor([], [], STARTED_AT, false);
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));

    fireEvent.click(screen.getByText('Done'));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/history/sess-1'));
    expect(screen.queryByText('Keep this empty workout?')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps Done locked while a set is on its way to the server', async () => {
    let release: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    renderEditor([], [{ exercise: bench, block: null }]);
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));
    const done = screen.getByText('Done').closest('button') as HTMLButtonElement;
    expect(done).toBeEnabled();

    fireEvent.click(screen.getByText('add set'));
    await waitFor(() => expect(done).toBeDisabled());
    fireEvent.click(done);
    // Nothing happened: no prompt to discard a workout that is about to have a set.
    expect(screen.queryByText('Keep this empty workout?')).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();

    release(new Response(JSON.stringify(strengthSet('s1', 1)), { status: 201 }));
    await waitFor(() => expect(done).toBeEnabled());
    fireEvent.click(done);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/history/sess-1'));
  });

  it('stays when the empty workout cannot be discarded', async () => {
    stubFetch(() => new Response('{"error":"has sets"}', { status: 409 }));
    renderEditor([], []);
    await waitFor(() => expect(screen.getByLabelText('Date')).toHaveValue('2026-11-20'));

    fireEvent.click(screen.getByText('Done'));
    fireEvent.click(await screen.findByText('Discard it'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not discard the workout.'),
    );
    expect(router.push).not.toHaveBeenCalled();
  });
});
