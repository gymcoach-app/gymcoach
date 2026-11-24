import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { WorkoutCard } from './workout-card';

// Drag-and-drop reordering in the program editor (issue #557, step 2). The
// geometry and the block rules are unit-tested in
// lib/programs/drag-reorder.test.ts; this pins the wiring of a drag: the
// labelled grip, what a drop sends, the optimistic order and its rollback,
// the ways a drag is aborted, and the fallback when the browser has no
// Pointer Events.
//
// jsdom has no layout and no PointerEvent, so both are provided here: every
// row is 60px tall, 8px apart, the first one at y = 100.
//
// Apart from the first test, which checks what assistive technology gets,
// the helpers read the DOM directly instead of querying by role: a role
// query walks the whole card and this file makes hundreds of them, which is
// what pushes jsdom UI tests towards the timeout on a busy machine (lesson
// L42). For the same reason the second way of moving a row used here is the
// arrow keys on the grip, not the menu, which workout-card.test.tsx covers.

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type CardProps = Parameters<typeof WorkoutCard>[0];
type Row = CardProps['workout']['exercises'][number];

function row(name: string, order: number, supersetGroup: number | null = null): Row {
  const id = name.toLowerCase();
  return {
    id: `pe-${id}`,
    workoutId: 'w1',
    exerciseId: `ex-${id}`,
    order,
    targetSets: 3,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetRIR: 2,
    restSec: 90,
    tempo: null,
    notes: null,
    supersetGroup,
    autoregulationMode: 'PRESERVE_RIR',
    fatigueRate: 0.75,
    loadAdjustmentPct: 2.5,
    exercise: { id: `ex-${id}`, name, muscleGroup: 'CHEST', category: 'COMPOUND' },
  } as unknown as Row;
}

function workout(exercises: Row[]): CardProps['workout'] {
  return {
    id: 'w1',
    programId: 'p1',
    name: 'Full body',
    dayOfWeek: null,
    order: 1,
    exercises,
  } as unknown as CardProps['workout'];
}

const ROW_HEIGHT = 60;
const ROW_GAP = 8;
const LIST_TOP = 100;
// The vertical middle of the row at `index`.
const middleOf = (index: number) => LIST_TOP + index * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2;

// How far the page is scrolled (moves every rectangle up).
let scrolled = 0;

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 300,
    width: 300,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function fakeLayout(this: HTMLElement): DOMRect {
  if (this.tagName === 'LI' && this.parentElement) {
    const index = Array.prototype.indexOf.call(this.parentElement.children, this);
    return rect(LIST_TOP - scrolled + index * (ROW_HEIGHT + ROW_GAP), ROW_HEIGHT);
  }
  const list = this.tagName === 'UL' ? this : this.querySelector(':scope > ul');
  if (list) {
    const count = list.children.length;
    return rect(LIST_TOP - scrolled, count * (ROW_HEIGHT + ROW_GAP) - ROW_GAP);
  }
  return rect(0, 0);
}

class FakePointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

const fetchMock = vi.fn();
const scrollBy = vi.fn();

beforeEach(() => {
  scrolled = 0;
  fetchMock.mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('PointerEvent', FakePointerEvent);
  vi.stubGlobal('scrollBy', scrollBy);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(fakeLayout);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('li[data-reorder-id]'));

// Exercise names top to bottom, with the superset label when there is one.
function shown(): string[] {
  return rows().map((li) => {
    const name = li.querySelector('p')?.textContent ?? '';
    const label = Array.from(li.querySelectorAll('div')).find(
      (el) => el.children.length === 0 && /^Superset /.test(el.textContent ?? ''),
    )?.textContent;
    return label ? `${name} (${label.replace('Superset ', '')})` : name;
  });
}

const grips = () => Array.from(document.querySelectorAll<HTMLElement>('[data-drag-handle]'));
const grip = (name: string) => {
  const found = grips().find((el) => el.getAttribute('aria-label') === `Reorder ${name}`);
  if (!found) throw new Error(`No grip for ${name}`);
  return found;
};
const listItem = (name: string) => grip(name).closest('li')!;
const indicator = () => document.querySelector<HTMLElement>('[data-drop-indicator]');
const status = () => document.querySelector<HTMLElement>('[role="status"]')!;

function sentOrder(call = 0): { url: string; method?: string; ids: string[] } {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  const body = JSON.parse(String(init.body)) as { programExerciseIds: string[] };
  return { url, method: init.method, ids: body.programExerciseIds };
}

interface PressOptions {
  pointerId?: number;
  pointerType?: string;
  button?: number;
}

// Presses the grip of `name` in its vertical middle.
function press(name: string, options: PressOptions = {}) {
  const index = rows().indexOf(listItem(name));
  fireEvent.pointerDown(grip(name), {
    pointerId: 1,
    pointerType: 'touch',
    button: 0,
    clientY: middleOf(index),
    ...options,
  });
}

function moveTo(clientY: number, pointerId = 1) {
  fireEvent.pointerMove(document.body, { pointerId, clientY });
}

function release(clientY: number, pointerId = 1) {
  fireEvent.pointerUp(document.body, { pointerId, clientY });
}

function dragTo(name: string, clientY: number) {
  press(name);
  moveTo(clientY);
  release(clientY);
}

describe('WorkoutCard drag-and-drop (issue #557)', () => {
  const three = () => [row('Bench', 1), row('Squat', 2), row('Running', 3)];
  const mixed = () => [row('Warmup', 1), row('Bench', 2, 1), row('Row', 3, 1), row('Squat', 4)];

  describe('the grip', () => {
    it('gives every row a labelled, described grip', () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      const found = screen.getAllByRole('button', { name: /^Reorder / });
      expect(found.map((el) => el.getAttribute('aria-label'))).toEqual([
        'Reorder Bench',
        'Reorder Squat',
        'Reorder Running',
      ]);
      expect(found).toEqual(grips());
      for (const el of found) {
        expect(el).toHaveAccessibleDescription(/^Drag to move this exercise, or press/);
      }
    });

    it('turns touch scrolling off on the grip and nowhere else', () => {
      const { container } = render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      expect(grips()).toHaveLength(3);
      expect(Array.from(container.querySelectorAll('.touch-none'))).toEqual(grips());
    });

    it('is not rendered when the workout has a single block', () => {
      const { unmount } = render(<WorkoutCard workout={workout([row('Bench', 1)])} catalog={[]} />);
      expect(rows()).toHaveLength(1);
      expect(grips()).toEqual([]);
      unmount();

      // One superset alone is one block too.
      render(
        <WorkoutCard workout={workout([row('Bench', 1, 1), row('Row', 2, 1)])} catalog={[]} />,
      );
      expect(rows()).toHaveLength(2);
      expect(grips()).toEqual([]);
    });

    it('is not rendered without Pointer Events, which leaves the menu', () => {
      // Safari 12 and older. This is also the browser workout-card.test.tsx
      // runs in (jsdom has no PointerEvent), so every menu move there is a
      // move made without grips.
      vi.stubGlobal('PointerEvent', undefined);
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      expect(grips()).toEqual([]);
      expect(document.querySelectorAll('button[aria-label="Exercise actions"]')).toHaveLength(3);
    });
  });

  describe('a drag', () => {
    it('moves the last exercise to the top in one drop and saves the full order', async () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(middleOf(0) - 10);

      // The row follows the pointer, up to the top of the list (two rows
      // higher); the list itself has not changed yet.
      expect(listItem('Running').style.transform).toBe(
        `translate3d(0, ${-2 * (ROW_HEIGHT + ROW_GAP)}px, 0)`,
      );
      expect(shown()).toEqual(['Bench', 'Squat', 'Running']);
      // The line sits in the middle of the gap above the first row.
      expect(indicator()).toHaveStyle({ top: `${-ROW_GAP / 2}px` });
      expect(fetchMock).not.toHaveBeenCalled();

      release(middleOf(0) - 10);
      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);
      expect(listItem('Running').style.transform).toBe('');
      expect(indicator()).toBeNull();
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentOrder()).toEqual({
        url: '/api/workouts/w1/order',
        method: 'PUT',
        ids: ['pe-running', 'pe-bench', 'pe-squat'],
      });
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('moves the first exercise down between the two others', async () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      dragTo('Bench', middleOf(1) + 5);
      expect(shown()).toEqual(['Squat', 'Bench', 'Running']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(sentOrder().ids).toEqual(['pe-squat', 'pe-bench', 'pe-running']);
    });

    it('saves nothing when the row is dropped where it was', () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Squat');
      moveTo(middleOf(1) + 20);
      // Over its own place: no line.
      expect(indicator()).toBeNull();
      release(middleOf(1) + 20);

      // A press and release without moving is not a move either.
      press('Squat');
      release(middleOf(1));
      expect(shown()).toEqual(['Bench', 'Squat', 'Running']);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('works with a mouse and a pen, main button only', async () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running', { pointerType: 'mouse', button: 2 });
      moveTo(middleOf(0) - 10);
      expect(listItem('Running').style.transform).toBe('');
      release(middleOf(0) - 10);
      expect(fetchMock).not.toHaveBeenCalled();

      press('Running', { pointerType: 'mouse', button: 0 });
      moveTo(middleOf(0) - 10);
      release(middleOf(0) - 10);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);

      press('Squat', { pointerType: 'pen' });
      moveTo(middleOf(0) - 10);
      release(middleOf(0) - 10);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
      expect(shown()).toEqual(['Squat', 'Running', 'Bench']);
    });

    it('ignores other pointers while one is dragging', () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      // A second finger moves, lifts, and presses another grip.
      moveTo(middleOf(0), 2);
      expect(listItem('Running').style.transform).toBe('translate3d(0, 0px, 0)');
      release(middleOf(0), 2);
      press('Bench', { pointerId: 2 });
      expect(listItem('Bench').style.transform).toBe('');
      expect(fetchMock).not.toHaveBeenCalled();

      release(middleOf(2));
      expect(shown()).toEqual(['Bench', 'Squat', 'Running']);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never carries the row out of the list', () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Squat');
      moveTo(-5000);
      expect(listItem('Squat').style.transform).toBe(
        `translate3d(0, ${-(ROW_HEIGHT + ROW_GAP)}px, 0)`,
      );
      moveTo(5000);
      expect(listItem('Squat').style.transform).toBe(
        `translate3d(0, ${ROW_HEIGHT + ROW_GAP}px, 0)`,
      );
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });

    it('keeps the row under the pointer when the page scrolls during the drag', () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Squat');
      moveTo(middleOf(1) - 20);
      expect(listItem('Squat').style.transform).toBe('translate3d(0, -20px, 0)');
      scrolled = 30;
      fireEvent.scroll(window);
      // The list moved up by 30px, so the row is pushed down by as much.
      expect(listItem('Squat').style.transform).toBe('translate3d(0, 10px, 0)');
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
  });

  describe('aborting', () => {
    it('drops nothing when Escape is pressed during a drag', () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(middleOf(0) - 10);
      expect(indicator()).not.toBeNull();

      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(indicator()).toBeNull();
      expect(listItem('Running').style.transform).toBe('');

      // The finger lifts afterwards: still nothing.
      release(middleOf(0) - 10);
      expect(shown()).toEqual(['Bench', 'Squat', 'Running']);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps Escape for itself during a drag and leaves it alone otherwise', () => {
      const onKeyDown = vi.fn();
      render(
        <div onKeyDown={onKeyDown}>
          <WorkoutCard workout={workout(three())} catalog={[]} />
        </div>,
      );
      press('Running');
      fireEvent.keyDown(grip('Running'), { key: 'Escape' });
      expect(onKeyDown).not.toHaveBeenCalled();

      fireEvent.keyDown(grip('Running'), { key: 'Escape' });
      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('drops nothing when the browser cancels the pointer', () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(middleOf(0) - 10);
      fireEvent.pointerCancel(document.body, { pointerId: 1 });
      expect(indicator()).toBeNull();
      expect(listItem('Running').style.transform).toBe('');
      release(middleOf(0) - 10);
      expect(shown()).toEqual(['Bench', 'Squat', 'Running']);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('drops nothing when the window loses focus', () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(middleOf(0) - 10);
      fireEvent.blur(window);
      release(middleOf(0) - 10);
      expect(shown()).toEqual(['Bench', 'Squat', 'Running']);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('drops nothing when the dragged row disappears under the pointer', () => {
      const { rerender } = render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(middleOf(0) - 10);
      // Another tab removed the exercise and the refreshed rows arrived.
      rerender(<WorkoutCard workout={workout([row('Bench', 1), row('Squat', 2)])} catalog={[]} />);
      release(middleOf(0) - 10);
      expect(shown()).toEqual(['Bench', 'Squat']);
      expect(indicator()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('stops listening when the card goes away mid-drag', () => {
      const { unmount } = render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(middleOf(0) - 10);
      unmount();
      release(middleOf(0) - 10);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('with a superset', () => {
    it('moves the whole pair when one of its members is dragged', async () => {
      render(<WorkoutCard workout={workout(mixed())} catalog={[]} />);
      expect(shown()).toEqual(['Warmup', 'Bench (A1)', 'Row (A2)', 'Squat']);

      press('Row');
      moveTo(middleOf(0) - 10);
      // Both members travel together, by the same distance.
      const travelled = listItem('Row').style.transform;
      expect(travelled).toBe(`translate3d(0, ${-(ROW_HEIGHT + ROW_GAP)}px, 0)`);
      expect(listItem('Bench').style.transform).toBe(travelled);
      expect(listItem('Warmup').style.transform).toBe('');

      release(middleOf(0) - 10);
      expect(shown()).toEqual(['Bench (A1)', 'Row (A2)', 'Warmup', 'Squat']);
      expect(listItem('Bench').style.transform).toBe('');
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(sentOrder().ids).toEqual(['pe-bench', 'pe-row', 'pe-warmup', 'pe-squat']);
    });

    it('never drops an exercise between the two members of a pair', async () => {
      render(<WorkoutCard workout={workout(mixed())} catalog={[]} />);
      // The pair spans rows 1 and 2; its middle is the gap between them.
      const pairMiddle = (middleOf(1) + middleOf(2)) / 2;

      // Released over the second member: below the pair's middle, so the
      // exercise stays after the pair, where it already is.
      press('Squat');
      moveTo(pairMiddle + 10);
      expect(indicator()).toBeNull();
      release(pairMiddle + 10);
      expect(fetchMock).not.toHaveBeenCalled();

      // Released over the first member: it lands before the whole pair.
      press('Squat');
      moveTo(pairMiddle - 10);
      // The line is above the first member, not between the two.
      expect(indicator()).toHaveStyle({
        top: `${ROW_HEIGHT + ROW_GAP - ROW_GAP / 2}px`,
      });
      release(pairMiddle - 10);
      expect(shown()).toEqual(['Warmup', 'Squat', 'Bench (A1)', 'Row (A2)']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(sentOrder().ids).toEqual(['pe-warmup', 'pe-squat', 'pe-bench', 'pe-row']);
    });
  });

  describe('saving', () => {
    it.each([
      [
        'the server refuses',
        () => Promise.resolve(Response.json({ error: 'no' }, { status: 400 })),
      ],
      ['the network fails', () => Promise.reject(new TypeError('offline'))],
    ])('restores the previous order and shows an error when %s', async (_label, respond) => {
      fetchMock.mockImplementation(respond);
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      dragTo('Running', middleOf(0) - 10);
      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith('Could not save the new order.'),
      );
      expect(shown()).toEqual(['Bench', 'Squat', 'Running']);
      expect(refresh).not.toHaveBeenCalled();

      // The row can be dragged again afterwards.
      fetchMock.mockResolvedValue(Response.json({ ok: true }));
      await waitFor(() => expect(grip('Running')).not.toHaveAttribute('aria-disabled'));
      dragTo('Running', middleOf(0) - 10);
      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    });

    it('keeps an earlier saved drop when a later one fails', async () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      dragTo('Running', middleOf(0) - 10);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

      fetchMock.mockResolvedValueOnce(Response.json({ error: 'no' }, { status: 500 }));
      dragTo('Squat', middleOf(0) - 10);
      expect(shown()).toEqual(['Squat', 'Running', 'Bench']);
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);
    });

    it('starts no second save while one is in flight', async () => {
      let answer: (res: Response) => void = () => {};
      fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);

      dragTo('Running', middleOf(0) - 10);
      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Neither a new drag nor the arrow keys can move anything meanwhile.
      expect(grip('Squat')).toHaveAttribute('aria-disabled', 'true');
      press('Squat');
      moveTo(middleOf(0) - 10);
      expect(listItem('Squat').style.transform).toBe('');
      expect(indicator()).toBeNull();
      release(middleOf(0) - 10);
      fireEvent.keyDown(grip('Squat'), { key: 'ArrowUp' });
      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Once it is answered, the next drop starts from the order it produced.
      answer(Response.json({ ok: true }));
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(grip('Squat')).not.toHaveAttribute('aria-disabled'));
      dragTo('Squat', middleOf(0) - 10);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sentOrder(1).ids).toEqual(['pe-squat', 'pe-running', 'pe-bench']);
    });

    it('refuses the drop of a drag that was overtaken by another move', async () => {
      let answer: (res: Response) => void = () => {};
      fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);

      // A finger holds Running over the top of the list...
      press('Running');
      moveTo(middleOf(0) - 10);
      expect(indicator()).not.toBeNull();
      // ...while Bench is moved down from the keyboard.
      fireEvent.keyDown(grip('Bench'), { key: 'ArrowDown' });
      expect(shown()).toEqual(['Squat', 'Bench', 'Running']);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // The drop arrives while that save is in flight: it is not applied,
      // so the screen still shows exactly what was sent.
      release(middleOf(0) - 10);
      expect(shown()).toEqual(['Squat', 'Bench', 'Running']);
      expect(listItem('Running').style.transform).toBe('');
      answer(Response.json({ ok: true }));
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentOrder().ids).toEqual(['pe-squat', 'pe-bench', 'pe-running']);
    });

    it('follows the server order once the refreshed rows arrive', async () => {
      const { rerender } = render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      dragTo('Running', middleOf(0) - 10);
      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

      rerender(
        <WorkoutCard
          workout={workout([row('Squat', 1), row('Running', 2), row('Bench', 3)])}
          catalog={[]}
        />,
      );
      expect(shown()).toEqual(['Squat', 'Running', 'Bench']);
    });
  });

  describe('assistive technology', () => {
    it('announces where the exercise went, and nothing after a failed save', async () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      expect(status()).toHaveAttribute('aria-live', 'polite');
      expect(status()).toBeEmptyDOMElement();

      dragTo('Running', middleOf(0) - 10);
      expect(status()).toHaveTextContent('Running moved to position 1 of 3.');
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

      fetchMock.mockResolvedValueOnce(Response.json({ error: 'no' }, { status: 500 }));
      dragTo('Squat', middleOf(0) - 10);
      expect(status()).toHaveTextContent('Squat moved to position 1 of 3.');
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(status()).toBeEmptyDOMElement();
    });

    it('moves the row with the arrow keys on the grip and keeps the focus on it', async () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      grip('Running').focus();

      fireEvent.keyDown(grip('Running'), { key: 'ArrowUp' });
      expect(shown()).toEqual(['Bench', 'Running', 'Squat']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(sentOrder().ids).toEqual(['pe-bench', 'pe-running', 'pe-squat']);
      expect(grip('Running')).toHaveFocus();
      expect(status()).toHaveTextContent('Running moved to position 2 of 3.');

      await waitFor(() => expect(grip('Running')).not.toHaveAttribute('aria-disabled'));
      fireEvent.keyDown(grip('Running'), { key: 'ArrowDown' });
      expect(shown()).toEqual(['Bench', 'Squat', 'Running']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
      expect(grip('Running')).toHaveFocus();

      // At the bottom edge there is nothing further down, and the arrow
      // still does not scroll the page.
      await waitFor(() => expect(grip('Running')).not.toHaveAttribute('aria-disabled'));
      expect(fireEvent.keyDown(grip('Running'), { key: 'ArrowDown' })).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // Other keys are left alone.
      expect(fireEvent.keyDown(grip('Running'), { key: 'Tab' })).toBe(true);
    });

    it('moves a whole pair with the arrow keys on one of its grips', async () => {
      render(<WorkoutCard workout={workout(mixed())} catalog={[]} />);
      fireEvent.keyDown(grip('Row'), { key: 'ArrowUp' });
      expect(shown()).toEqual(['Bench (A1)', 'Row (A2)', 'Warmup', 'Squat']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(sentOrder().ids).toEqual(['pe-bench', 'pe-row', 'pe-warmup', 'pe-squat']);
    });
  });

  describe('autoscroll', () => {
    it('scrolls the page while the pointer rests near the bottom edge', async () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Bench');
      moveTo(window.innerHeight - 4);
      await waitFor(() => expect(scrollBy).toHaveBeenCalled());
      const [x, y] = scrollBy.mock.calls[0] as [number, number];
      expect(x).toBe(0);
      expect(y).toBeGreaterThan(0);

      // It stops with the drag.
      fireEvent.keyDown(document.body, { key: 'Escape' });
      scrollBy.mockClear();
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('scrolls up near the top edge', async () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(3);
      await waitFor(() => expect(scrollBy).toHaveBeenCalled());
      expect((scrollBy.mock.calls[0] as [number, number])[1]).toBeLessThan(0);
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });

    it('does not scroll for a grip that is only pressed, or held mid-screen', async () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      fireEvent.pointerDown(grip('Bench'), {
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        clientY: window.innerHeight - 2,
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(scrollBy).not.toHaveBeenCalled();
      fireEvent.pointerCancel(document.body, { pointerId: 1 });

      press('Bench');
      moveTo(window.innerHeight / 2);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(scrollBy).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
  });
});
