// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// The fake page. Each test may move the list, give rows their own heights,
// scroll, or put a sticky header at the top of the viewport.
let listTop = 100;
let rowHeights: number[] = [];
// How far the page is scrolled (moves every rectangle of the list up).
let scrolled = 0;
let headerHeight = 0;

const heightOf = (index: number) => rowHeights[index] ?? ROW_HEIGHT;
// Top of the row at `index`, in the unscrolled page.
function topOf(index: number): number {
  let top = listTop;
  for (let i = 0; i < index; i += 1) top += heightOf(i) + ROW_GAP;
  return top;
}
// The vertical middle of the row at `index`, in the unscrolled page.
const middleOf = (index: number) => topOf(index) + heightOf(index) / 2;

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
  if (this.tagName === 'HEADER') return rect(0, headerHeight);
  if (this.tagName === 'LI' && this.parentElement) {
    const index = Array.prototype.indexOf.call(this.parentElement.children, this);
    return rect(topOf(index) - scrolled, heightOf(index));
  }
  const list = this.tagName === 'UL' ? this : this.querySelector(':scope > ul');
  if (list) {
    const count = list.children.length;
    return rect(listTop - scrolled, topOf(count) - ROW_GAP - listTop);
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

// Animation frames run by hand, with the timestamps the test chooses.
let frameCallbacks = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let frameTime = 0;
const cancelFrame = vi.fn((id: number) => {
  frameCallbacks.delete(id);
});
// Runs the pending frame, `elapsedMs` after the previous one.
function frame(elapsedMs = 1000 / 60) {
  frameTime += elapsedMs;
  const pending = Array.from(frameCallbacks.values());
  frameCallbacks.clear();
  act(() => {
    for (const callback of pending) callback(frameTime);
  });
}

beforeEach(() => {
  listTop = 100;
  rowHeights = [];
  scrolled = 0;
  headerHeight = 0;
  frameCallbacks = new Map();
  nextFrameId = 1;
  frameTime = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frameCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  fetchMock.mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('PointerEvent', FakePointerEvent);
  scrollBy.mockReset();
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

// The kind of pointer of the last press: its moves are of the same kind.
let pressedWith = 'touch';

// Presses the grip of `name` in the vertical middle of its row.
function press(name: string, options: PressOptions = {}) {
  const box = listItem(name).getBoundingClientRect();
  pressedWith = options.pointerType ?? 'touch';
  fireEvent.pointerDown(grip(name), {
    pointerId: 1,
    pointerType: pressedWith,
    button: 0,
    buttons: 1,
    clientY: (box.top + box.bottom) / 2,
    ...options,
  });
}

function moveTo(clientY: number, pointerId = 1, init: PointerEventInit = {}) {
  fireEvent.pointerMove(document.body, {
    pointerId,
    pointerType: pressedWith,
    buttons: 1,
    clientY,
    ...init,
  });
}

function release(clientY: number, pointerId = 1) {
  fireEvent.pointerUp(document.body, { pointerId, pointerType: pressedWith, clientY });
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

    it('numbers the grips of an exercise that is in the workout twice', () => {
      // 5/3/1 Boring But Big repeats the main lift in one workout.
      const again = { ...row('Squat', 3), id: 'pe-squat-again' };
      render(
        <WorkoutCard workout={workout([row('Squat', 1), row('Bench', 2), again])} catalog={[]} />,
      );
      expect(grips().map((el) => el.getAttribute('aria-label'))).toEqual([
        'Reorder Squat (1)',
        'Reorder Bench',
        'Reorder Squat (2)',
      ]);
    });

    it('keeps a dragged row below the sticky app header', () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      // The list is a stacking context of its own (z-index 0); the header is
      // above it whatever z-index a row gets inside.
      expect(listItem('Bench').closest('ul')!.parentElement).toHaveClass('relative', 'z-0');
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

    it('saves once when the capture is released right after the drop', async () => {
      // What a browser does at the end of every drag: pointerup, then
      // lostpointercapture for the same pointer.
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(middleOf(0) - 10);
      const handle = grip('Running');
      release(middleOf(0) - 10);
      fireEvent(handle, new FakePointerEvent('lostpointercapture', { pointerId: 1 }));

      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentOrder().ids).toEqual(['pe-running', 'pe-bench', 'pe-squat']);
      expect(toast.error).not.toHaveBeenCalled();
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

      // A pen's barrel button does not drag either; its tip does.
      await waitFor(() => expect(grip('Squat')).not.toHaveAttribute('aria-disabled'));
      press('Squat', { pointerType: 'pen', button: 2 });
      moveTo(middleOf(0) - 10);
      expect(listItem('Squat').style.transform).toBe('');
      release(middleOf(0) - 10);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      press('Squat', { pointerType: 'pen' });
      moveTo(middleOf(0) - 10);
      release(middleOf(0) - 10);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
      expect(shown()).toEqual(['Squat', 'Running', 'Bench']);
    });

    it('uses the real height of every row', async () => {
      // A long note makes the first row much taller than the others:
      // Bench 100-300, Squat 308-368, Running 376-436.
      rowHeights = [200, 60, 60];
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);

      // Above the middle of the tall row (200): before it, by its full height.
      press('Running');
      moveTo(190);
      expect(listItem('Running').style.transform).toBe('translate3d(0, -216px, 0)');
      expect(indicator()).toHaveStyle({ top: '-4px' });
      // Below its middle, although still over it: after it.
      moveTo(210);
      expect(indicator()).toHaveStyle({ top: '204px' });
      release(210);
      expect(shown()).toEqual(['Bench', 'Running', 'Squat']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(sentOrder().ids).toEqual(['pe-bench', 'pe-running', 'pe-squat']);

      // The tall row itself: it may travel down by the two short rows only.
      await waitFor(() => expect(grip('Bench')).not.toHaveAttribute('aria-disabled'));
      press('Bench');
      moveTo(5000);
      expect(listItem('Bench').style.transform).toBe('translate3d(0, 136px, 0)');
      // Just past the middle of the first short row (338): after it.
      moveTo(345);
      release(345);
      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
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

    it('drops nothing when a mouse comes back with no button held', () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running', { pointerType: 'mouse' });
      moveTo(middleOf(0) - 10);
      expect(indicator()).not.toBeNull();

      // The button was released outside the window: no pointerup reached the
      // page, and the next move reports that nothing is pressed.
      moveTo(middleOf(0) - 12, 1, { buttons: 0 });
      expect(indicator()).toBeNull();
      expect(listItem('Running').style.transform).toBe('');

      // Moving on does not carry the row, and a late release drops nothing.
      moveTo(middleOf(0) - 20, 1, { buttons: 0 });
      expect(listItem('Running').style.transform).toBe('');
      release(middleOf(0) - 20);
      expect(shown()).toEqual(['Bench', 'Squat', 'Running']);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('drops nothing when the pointer capture is lost', () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(middleOf(0) - 10);
      // Another pointer's capture is not this drag's business.
      fireEvent(grip('Running'), new FakePointerEvent('lostpointercapture', { pointerId: 2 }));
      expect(indicator()).not.toBeNull();

      fireEvent(grip('Running'), new FakePointerEvent('lostpointercapture', { pointerId: 1 }));
      expect(indicator()).toBeNull();
      expect(listItem('Running').style.transform).toBe('');
      release(middleOf(0) - 10);
      expect(shown()).toEqual(['Bench', 'Squat', 'Running']);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // Another tab changed the workout and the refreshed rows arrive while a
    // row is held: the rectangles the drag measured are no longer true.
    it.each([
      ['the dragged row is removed', () => [row('Bench', 1), row('Squat', 2)], ['Bench', 'Squat']],
      ['another row is removed', () => [row('Squat', 1), row('Running', 2)], ['Squat', 'Running']],
      [
        'a row is added',
        () => [row('Bench', 1), row('Squat', 2), row('Running', 3), row('Curl', 4)],
        ['Bench', 'Squat', 'Running', 'Curl'],
      ],
      [
        'the rows are reordered',
        () => [row('Squat', 1), row('Bench', 2), row('Running', 3)],
        ['Squat', 'Bench', 'Running'],
      ],
      [
        'two rows are paired',
        () => [row('Bench', 1, 1), row('Squat', 2, 1), row('Running', 3)],
        ['Bench (A1)', 'Squat (A2)', 'Running'],
      ],
    ])('aborts the drag when %s under it', (_label, next, expected) => {
      const { rerender } = render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(middleOf(0) - 10);
      expect(indicator()).not.toBeNull();

      rerender(<WorkoutCard workout={workout(next())} catalog={[]} />);
      // Aborted at once, not at the next pointer event.
      expect(indicator()).toBeNull();
      for (const li of rows()) expect(li.style.transform).toBe('');
      expect(shown()).toEqual(expected);

      moveTo(middleOf(0) - 20);
      for (const li of rows()) expect(li.style.transform).toBe('');
      release(middleOf(0) - 20);
      expect(shown()).toEqual(expected);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps the drag when the same rows come back unchanged', async () => {
      const { rerender } = render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(middleOf(0) - 10);
      // A refresh that changes nothing in the order (a new array, same rows).
      rerender(<WorkoutCard workout={workout(three())} catalog={[]} />);
      expect(indicator()).not.toBeNull();
      release(middleOf(0) - 10);
      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    });

    it('removes every listener and its animation frame when the card goes away', () => {
      const added: Array<[string, unknown, unknown]> = [];
      const removed: Array<[string, unknown, unknown]> = [];
      const { unmount } = render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      const handle = grip('Running');
      for (const target of [window, handle] as EventTarget[]) {
        const add = target.addEventListener.bind(target);
        const remove = target.removeEventListener.bind(target);
        vi.spyOn(target, 'addEventListener').mockImplementation(
          (type: string, listener: unknown, options?: unknown) => {
            if (/^pointer|^lostpointer|^keydown$|^blur$|^scroll$/.test(type)) {
              added.push([type, listener, options]);
            }
            add(type, listener as EventListener, options as AddEventListenerOptions);
          },
        );
        vi.spyOn(target, 'removeEventListener').mockImplementation(
          (type: string, listener: unknown, options?: unknown) => {
            removed.push([type, listener, options]);
            remove(type, listener as EventListener, options as EventListenerOptions);
          },
        );
      }

      // A drag resting in the bottom edge zone of a list that goes on below.
      listTop = 650;
      press('Running');
      moveTo(window.innerHeight - 4);
      frame();
      expect(scrollBy).toHaveBeenCalled();
      expect(added.map(([type]) => type).sort()).toEqual([
        'blur',
        'keydown',
        'lostpointercapture',
        'pointercancel',
        'pointermove',
        'pointerup',
        'scroll',
      ]);
      expect(frameCallbacks.size).toBe(1);
      const pendingFrame = Array.from(frameCallbacks.keys())[0];

      unmount();
      // Each listener is removed with the function and the capture flag it
      // was added with: anything else would leave it in place.
      for (const [type, listener, options] of added) {
        expect(
          removed.some(
            ([t, l, o]) => t === type && l === listener && Boolean(o) === Boolean(options),
          ),
        ).toBe(true);
      }
      expect(cancelFrame).toHaveBeenCalledWith(pendingFrame);
      expect(frameCallbacks.size).toBe(0);

      // Nothing reacts any more.
      scrollBy.mockClear();
      frame();
      moveTo(window.innerHeight - 2);
      release(window.innerHeight - 2);
      frame();
      expect(scrollBy).not.toHaveBeenCalled();
      expect(frameCallbacks.size).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('removes every listener after a drop and after an abort', () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      const add = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(window, 'removeEventListener');
      const dragTypes = (calls: unknown[][]) =>
        calls.map(([type]) => String(type)).filter((type) => /^pointer|^scroll$|^blur$/.test(type));

      press('Squat');
      moveTo(middleOf(1) + 5);
      release(middleOf(1) + 5);
      expect(dragTypes(remove.mock.calls).sort()).toEqual(dragTypes(add.mock.calls).sort());
      expect(frameCallbacks.size).toBe(0);

      press('Squat');
      moveTo(middleOf(0) - 10);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(dragTypes(remove.mock.calls).sort()).toEqual(dragTypes(add.mock.calls).sort());
      expect(dragTypes(add.mock.calls)).toHaveLength(10);
      expect(frameCallbacks.size).toBe(0);
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

      // The list changed under the finger, so the drag is over: the row is
      // back in the list and its release is not a drop. The screen still
      // shows exactly what was sent.
      expect(indicator()).toBeNull();
      expect(listItem('Running').style.transform).toBe('');
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

    it('makes a second identical announcement a new message', async () => {
      // Two rows of the same exercise: both moves read the same.
      const again = { ...row('Squat', 3), id: 'pe-squat-again' };
      render(
        <WorkoutCard workout={workout([row('Bench', 1), row('Squat', 2), again])} catalog={[]} />,
      );

      dragTo('Squat (2)', middleOf(0) - 10);
      expect(status()).toHaveTextContent('Squat moved to position 1 of 3.');
      const first = status().textContent;
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(grip('Squat (2)')).not.toHaveAttribute('aria-disabled'));

      // The other Squat, now third, goes to the top in turn.
      dragTo('Squat (2)', middleOf(0) - 10);
      expect(sentOrder(1).ids).toEqual(['pe-squat', 'pe-squat-again', 'pe-bench']);
      expect(status()).toHaveTextContent('Squat moved to position 1 of 3.');
      // Same words, different text node content: a live region speaks it.
      expect(status().textContent).not.toBe(first);
    });

    it('moves the row with the arrow keys on the grip and keeps the focus on it', async () => {
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      grip('Running').focus();

      fireEvent.keyDown(grip('Running'), { key: 'ArrowUp' });
      expect(shown()).toEqual(['Bench', 'Running', 'Squat']);
      // The focus is put back on the next frame.
      grip('Running').blur();
      frame();
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
    const steps = () => scrollBy.mock.calls.map((call) => (call as [number, number])[1]);

    it('scrolls down while the pointer rests near the bottom edge of a list that goes on', () => {
      // Rows at 650-710, 718-778, 786-846 in a 768px viewport.
      listTop = 650;
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Bench');
      moveTo(window.innerHeight - 4);
      frame();
      frame();
      expect(scrollBy.mock.calls.map((call) => (call as [number, number])[0])).toEqual([0, 0]);
      expect(steps()[0]).toBeGreaterThan(0);

      // It stops with the drag.
      fireEvent.keyDown(document.body, { key: 'Escape' });
      scrollBy.mockClear();
      frame();
      expect(scrollBy).not.toHaveBeenCalled();
      expect(frameCallbacks.size).toBe(0);
    });

    it('scrolls up near the top edge while the top of the list is hidden', () => {
      // Rows at -100 to -40, -32 to 28, 36 to 96.
      listTop = -100;
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(3);
      frame();
      expect(steps()[0]).toBeLessThan(0);
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });

    it('stops at the ends of the list', () => {
      // The whole list (100-296) is on screen: there is nothing to reveal,
      // however close to an edge the pointer is.
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Bench');
      moveTo(window.innerHeight - 2);
      frame();
      frame();
      moveTo(1);
      frame();
      frame();
      expect(scrollBy).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });

    it('scrolls no further than what is left of the list', () => {
      // The last row ends at 846; the viewport is 768 high. With 16px kept
      // below the list, 94px are left to reveal.
      listTop = 650;
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      scrollBy.mockImplementation((_x: number, y: number) => {
        scrolled += y;
      });
      press('Bench');
      moveTo(window.innerHeight);
      for (let i = 0; i < 20; i += 1) frame();
      expect(scrolled).toBe(94);
      // Full speed, then the last step is cut to what remains.
      expect(steps().slice(0, 6)).toEqual([14, 14, 14, 14, 14, 14]);
      expect(steps()[steps().length - 1]).toBe(94 - 6 * 14);
      expect(steps()).toHaveLength(7);
      // The row stayed under the pointer all the way.
      expect(listItem('Bench').style.transform).toBe(
        `translate3d(0, ${2 * (ROW_HEIGHT + ROW_GAP)}px, 0)`,
      );
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });

    it('scrolls at the same speed on a 120 Hz screen', () => {
      listTop = 650;
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Bench');
      // At the very edge: 14px per 60 Hz frame.
      moveTo(window.innerHeight);
      frame(1000 / 120);
      scrollBy.mockClear();
      for (let i = 0; i < 4; i += 1) frame(1000 / 120);
      expect(steps()).toEqual([7, 7, 7, 7]);

      // A long pause counts for three frames at most, not for a jump.
      scrollBy.mockClear();
      frame(2000);
      expect(steps()).toEqual([42]);
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });

    it('keeps the slowest speed moving at 120 Hz, in whole pixels', () => {
      listTop = 650;
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Bench');
      // Just inside the 64px zone: 1px per 60 Hz frame.
      moveTo(window.innerHeight - 62);
      frame(1000 / 120);
      scrollBy.mockClear();
      for (let i = 0; i < 6; i += 1) frame(1000 / 120);
      expect(steps().every((step) => Number.isInteger(step) && step > 0)).toBe(true);
      expect(steps().reduce((sum, step) => sum + step, 0)).toBe(3);
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });

    it('does not scroll for a grip that is only pressed, or held mid-screen', () => {
      listTop = 650;
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      fireEvent.pointerDown(grip('Bench'), {
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        clientY: window.innerHeight - 2,
      });
      frame();
      frame();
      expect(scrollBy).not.toHaveBeenCalled();
      fireEvent.pointerCancel(document.body, { pointerId: 1 });

      press('Bench');
      moveTo(window.innerHeight / 2);
      frame();
      frame();
      expect(scrollBy).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
  });

  describe('under a sticky header', () => {
    // The app header is sticky and about 97px tall.
    function renderUnderHeader() {
      headerHeight = 97;
      return render(
        <>
          <header style={{ position: 'sticky', top: 0 }} />
          <WorkoutCard workout={workout(three())} catalog={[]} />
        </>,
      );
    }

    it('starts the top autoscroll zone at the bottom of the header', () => {
      // The top of the list is hidden: rows at -100 to -40, -32 to 28, 36 to 96.
      listTop = -100;
      renderUnderHeader();
      press('Running');
      // 23px below the header: inside its 64px zone.
      moveTo(120);
      frame();
      expect(scrollBy).toHaveBeenCalledTimes(1);
      expect((scrollBy.mock.calls[0] as [number, number])[1]).toBeLessThan(0);
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });

    it('does not scroll at that height without a header', () => {
      listTop = -100;
      render(<WorkoutCard workout={workout(three())} catalog={[]} />);
      press('Running');
      moveTo(120);
      frame();
      frame();
      expect(scrollBy).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });

    it('keeps scrolling until the top of the list is clear of the header', () => {
      listTop = 60;
      renderUnderHeader();
      scrollBy.mockImplementation((_x: number, y: number) => {
        scrolled += y;
      });
      press('Running');
      moveTo(98);
      for (let i = 0; i < 20; i += 1) frame();
      // The list top went from 60 to 16px below the header (113).
      expect(listTop - scrolled).toBe(headerHeight + 16);
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });

    it('does not offer a place whose line is hidden behind the header', () => {
      // Bench is half under the header (80-140): the gap above it is at 76.
      listTop = 80;
      renderUnderHeader();
      press('Running');
      // The pointer is over the header: it counts as its bottom edge, which
      // is above the middle of Bench, so the only candidate is that gap.
      moveTo(70);
      expect(listItem('Running').style.transform).not.toBe('');
      expect(indicator()).toBeNull();
      release(70);
      expect(shown()).toEqual(['Bench', 'Squat', 'Running']);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('offers the same place once its line can be seen', async () => {
      // Bench starts 23px below the header: the gap above it is at 116.
      listTop = 120;
      renderUnderHeader();
      press('Running');
      moveTo(70);
      expect(indicator()).toHaveStyle({ top: '-4px' });
      release(70);
      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    });

    it('ignores a header that is not stuck to the top of the screen', async () => {
      listTop = 80;
      headerHeight = 97;
      render(
        <>
          <header />
          <WorkoutCard workout={workout(three())} catalog={[]} />
        </>,
      );
      press('Running');
      moveTo(70);
      expect(indicator()).toHaveStyle({ top: '-4px' });
      release(70);
      expect(shown()).toEqual(['Running', 'Bench', 'Squat']);
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    });
  });
});
