'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  autoScrollSpeed,
  blocksSignature,
  clampOffset,
  dragOffsetBounds,
  dropIndexForPointer,
  dropIndicatorY,
  frameScale,
  isDropLineVisible,
  limitAutoScroll,
  type BlockSpan,
} from '@/lib/programs/drag-reorder';

// Drag-and-drop reordering of the exercises of one workout (issue #557,
// step 2). Pointer Events only, no library: one code path for mouse, touch
// and pen.
//
// How a drag works:
// - It starts on pointerdown on a row's handle and nowhere else. The handle
//   is the only element with `touch-action: none`, so a finger anywhere else
//   on the page still scrolls it.
// - The block of the grabbed row (its whole superset, if any) follows the
//   pointer through a CSS transform written straight to the rows. The list
//   itself does not reflow and React does not re-render per pointer move:
//   the other rows stay put, which also keeps the grabbed handle in the DOM
//   (a touch stream ends when its target is removed).
// - A line shows the gap the block would land in. Gaps exist only between
//   blocks, so a superset cannot be split or dropped into. A gap whose line
//   cannot be seen (under the sticky app header, outside the viewport) is
//   not offered.
// - pointerup drops. Escape, pointercancel, a lost pointer capture, a mouse
//   that comes back with no button held, a window blur and any change of the
//   list under the drag abort it and leave the order untouched.
// - Near the top or bottom of the visible area the page scrolls by itself,
//   until that end of the list is in view.
//
// The geometry is pure and lives in lib/programs/drag-reorder.ts.

// Pointer movement, in pixels, before the page may autoscroll: pressing a
// handle that happens to sit at the edge of the screen must not scroll.
const AUTO_SCROLL_AFTER_PX = 4;
// Fallback for the space between two rows when the list does not report it.
const DEFAULT_ROW_GAP_PX = 8;

// Set on every row (li) of the list by the component that renders it.
const REORDER_ROW_ATTRIBUTE = 'data-reorder-id';

function subscribeToNothing() {
  return () => {};
}

// Whether this browser has Pointer Events (Safari 12 and older do not). The
// server and the first client render say yes, so the markup matches; a
// browser without them drops the handles right after hydration and keeps
// "Move up" / "Move down" in the row menu.
export function usePointerEventsSupported(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => typeof window.PointerEvent !== 'undefined',
    () => true,
  );
}

// The part of the viewport a row can be seen in: below any header stuck to
// the top of the screen (the app header is sticky and about 97px tall), down
// to the bottom edge. Measured, not assumed, so a taller header, a wrapped
// navigation or a page without one all work.
function visibleArea(): BlockSpan {
  let top = 0;
  document.querySelectorAll<HTMLElement>('header').forEach((header) => {
    const position = window.getComputedStyle(header).position;
    if (position !== 'sticky' && position !== 'fixed') return;
    const rect = header.getBoundingClientRect();
    // Stuck to the top edge, and a bar rather than a full-screen overlay.
    if (rect.top <= 0 && rect.bottom > top && rect.bottom < window.innerHeight / 2) {
      top = rect.bottom;
    }
  });
  return { top, bottom: window.innerHeight };
}

interface Options {
  // Row ids per block, top to bottom, as shown.
  blocks: string[][];
  // True while a drop must not be accepted (an order save is in flight).
  disabled: boolean;
  // Called once per completed drag that changes the order. `dropIndex` is
  // the position among the other blocks (lib/programs/drag-reorder.ts).
  onDrop: (id: string, dropIndex: number) => void;
}

export interface DragView {
  // Ids of the rows being dragged (one block).
  ids: string[];
  // Where to draw the drop line, in pixels from the top of the container;
  // null while the block is over its own place or the line would be hidden.
  indicatorTop: number | null;
}

interface Session {
  id: string;
  pointerId: number;
  handle: HTMLElement;
  // The blocks as they were when the drag started (blocksSignature).
  signature: string;
  startY: number;
  lastY: number;
  listTopAtStart: number;
  bounds: { min: number; max: number };
  rows: HTMLElement[];
  moved: boolean;
  frame: number | null;
  lastFrameAt: number | null;
  // Fraction of a pixel of autoscroll not yet applied.
  scrollCarry: number;
  removeListeners: () => void;
}

function spanOf(rows: HTMLElement[]): BlockSpan | null {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return null;
  return { top: first.getBoundingClientRect().top, bottom: last.getBoundingClientRect().bottom };
}

export function useDragReorder({ blocks, disabled, onDrop }: Options) {
  // The element wrapping the list: rows are looked up inside it and the drop
  // line is positioned against it.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragView | null>(null);
  const sessionRef = useRef<Session | null>(null);
  // The window listeners outlive the render that started the drag, so they
  // read the current props from here.
  const latestRef = useRef({ blocks, disabled, onDrop });

  // Rows of every block as they are on screen now, plus the dragged block's
  // index. Null when the list is no longer the one the drag started on.
  const measure = useCallback((session: Session) => {
    const container = containerRef.current;
    if (!container) return null;
    const current = latestRef.current.blocks;
    if (blocksSignature(current) !== session.signature) return null;
    const rowById = new Map<string, HTMLElement>();
    container.querySelectorAll<HTMLElement>(`[${REORDER_ROW_ATTRIBUTE}]`).forEach((row) => {
      const id = row.getAttribute(REORDER_ROW_ATTRIBUTE);
      if (id) rowById.set(id, row);
    });
    const rowsOf = (block: string[]) =>
      block.map((id) => rowById.get(id)).filter((row): row is HTMLElement => row != null);
    const from = current.findIndex((block) => block.indexOf(session.id) !== -1);
    if (from === -1) return null;
    const others: BlockSpan[] = [];
    current.forEach((block, index) => {
      if (index === from) return;
      const span = spanOf(rowsOf(block));
      if (span) others.push(span);
    });
    return { container, from, ids: current[from]!, rows: rowsOf(current[from]!), others };
  }, []);

  const teardown = useCallback((session: Session) => {
    session.removeListeners();
    if (session.frame != null) window.cancelAnimationFrame(session.frame);
    session.frame = null;
    for (const row of session.rows) row.style.transform = '';
    try {
      session.handle.releasePointerCapture?.(session.pointerId);
    } catch {
      // The capture is already gone (the pointer was released or cancelled).
    }
    sessionRef.current = null;
  }, []);

  // Moves the block under the pointer and works out where it would land.
  // Returns the drop index, null when a drop here changes nothing (or its
  // line could not be seen), or 'stale' when the list changed under the drag.
  const update = useCallback(
    (session: Session): number | null | 'stale' => {
      const measured = measure(session);
      if (!measured) return 'stale';
      const { container, from, ids, rows, others } = measured;
      const containerTop = container.getBoundingClientRect().top;
      // The pointer's travel plus how far the list scrolled under it.
      const offset = clampOffset(
        session.lastY - session.startY + (session.listTopAtStart - containerTop),
        session.bounds,
      );
      session.rows = rows;
      for (const row of rows) row.style.transform = `translate3d(0, ${offset}px, 0)`;

      // A pointer over the header, or outside the window, points at the
      // nearest place that can be seen.
      const view = visibleArea();
      const pointerY = Math.min(Math.max(session.lastY, view.top), view.bottom);
      const dropIndex = dropIndexForPointer(others, pointerY);
      let target: number | null = null;
      let indicatorTop: number | null = null;
      if (dropIndex !== from) {
        const list = container.querySelector('ul');
        const gap =
          (list ? parseFloat(window.getComputedStyle(list).rowGap) : NaN) || DEFAULT_ROW_GAP_PX;
        const y = dropIndicatorY(others, dropIndex, gap);
        if (y != null && isDropLineVisible(y, view)) {
          target = dropIndex;
          indicatorTop = y - containerTop;
        }
      }
      setDrag((previous) =>
        previous &&
        previous.indicatorTop === indicatorTop &&
        previous.ids.length === ids.length &&
        previous.ids.every((id, index) => id === ids[index])
          ? previous
          : { ids, indicatorTop },
      );
      return target;
    },
    [measure],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const session = sessionRef.current;
      if (!session) return;
      const target = commit ? update(session) : null;
      teardown(session);
      setDrag(null);
      if (typeof target === 'number' && !latestRef.current.disabled) {
        latestRef.current.onDrop(session.id, target);
      }
    },
    [teardown, update],
  );

  // Before paint, so a listener never reads the props of an older render.
  // The geometry of a drag belongs to the list it started on: when the rows
  // are reordered, added, removed, paired or unpaired under it (another move
  // was saved, a refresh brought another tab's change), the drag is aborted
  // rather than continued on rows that are not where it measured them.
  useLayoutEffect(() => {
    latestRef.current = { blocks, disabled, onDrop };
    const session = sessionRef.current;
    if (session && blocksSignature(blocks) !== session.signature) finish(false);
  });

  const startDrag = useCallback(
    (id: string, event: ReactPointerEvent<HTMLElement>) => {
      if (sessionRef.current || latestRef.current.disabled) return;
      // The main button only: the left mouse button, a finger or a pen tip in
      // contact (all report 0). A right click, a middle click or a pen barrel
      // button does not drag.
      if (event.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;

      const handle = event.currentTarget;
      const session: Session = {
        id,
        pointerId: event.pointerId,
        handle,
        signature: blocksSignature(latestRef.current.blocks),
        startY: event.clientY,
        lastY: event.clientY,
        listTopAtStart: container.getBoundingClientRect().top,
        bounds: { min: 0, max: 0 },
        rows: [],
        moved: false,
        frame: null,
        lastFrameAt: null,
        scrollCarry: 0,
        removeListeners: () => {},
      };
      const measured = measure(session);
      const blockSpan = measured ? spanOf(measured.rows) : null;
      // A single block has nowhere to go.
      if (!measured || !blockSpan || measured.others.length === 0) return;
      const containerRect = container.getBoundingClientRect();
      session.bounds = dragOffsetBounds(blockSpan, {
        top: containerRect.top,
        bottom: containerRect.bottom,
      });

      // Keeps a mouse press from starting a text selection or a native drag.
      event.preventDefault();
      try {
        // Keeps the events coming when a mouse leaves the window.
        handle.setPointerCapture?.(event.pointerId);
      } catch {
        // Not capturable (already released): the window listeners still work.
      }

      const refresh = () => {
        if (update(session) === 'stale') finish(false);
      };
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== session.pointerId) return;
        // The button was released where no pointerup could be delivered
        // (outside the window without capture, over a native dialog): the
        // mouse comes back with nothing held. That is not a drop.
        if (ev.pointerType === 'mouse' && ev.buttons === 0) {
          finish(false);
          return;
        }
        session.lastY = ev.clientY;
        if (Math.abs(session.lastY - session.startY) >= AUTO_SCROLL_AFTER_PX) session.moved = true;
        refresh();
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== session.pointerId) return;
        session.lastY = ev.clientY;
        finish(true);
      };
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== session.pointerId) return;
        finish(false);
      };
      // The capture ends after pointerup in a normal drop, when this listener
      // is already gone. Reaching it means the pointer was taken away.
      const onLostCapture = (ev: PointerEvent) => {
        if (ev.pointerId !== session.pointerId) return;
        finish(false);
      };
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
        // The Escape belongs to the drag, not to a dialog or menu behind it.
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      };
      const onBlur = () => finish(false);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('blur', onBlur);
      window.addEventListener('scroll', refresh, true);
      handle.addEventListener('lostpointercapture', onLostCapture);
      session.removeListeners = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('scroll', refresh, true);
        handle.removeEventListener('lostpointercapture', onLostCapture);
      };

      // Autoscroll: one check per frame, since a pointer resting in the edge
      // zone sends no events.
      const tick = (now: number) => {
        session.frame = window.requestAnimationFrame(tick);
        const elapsed = session.lastFrameAt == null ? 0 : now - session.lastFrameAt;
        session.lastFrameAt = now;
        if (!session.moved) return;
        const list = containerRef.current?.getBoundingClientRect();
        if (!list) return;
        // The edge zones start at the edges of what can be seen, so the top
        // one is below the sticky header, not under it.
        const view = visibleArea();
        const listSpan = { top: list.top, bottom: list.bottom };
        const speed = autoScrollSpeed(session.lastY - view.top, view.bottom - view.top);
        // Nothing left to reveal at that end of the list: the page stays.
        if (limitAutoScroll(speed, listSpan, view) === 0) {
          session.scrollCarry = 0;
          return;
        }
        // Whole pixels only: some browsers drop a fractional scroll, which
        // at 120 Hz would stall the slowest speeds. The remainder is carried
        // to the next frame (rounded, so 0.5 + 0.5 is 1 and not 0.999).
        const exact = Math.round((speed * frameScale(elapsed) + session.scrollCarry) * 1000) / 1000;
        const whole = exact < 0 ? Math.ceil(exact) : Math.floor(exact);
        session.scrollCarry = exact - whole;
        // Cut after scaling, so a long frame cannot overshoot the end either.
        const step = limitAutoScroll(whole, listSpan, view);
        if (step === 0) return;
        window.scrollBy(0, step);
        refresh();
      };
      session.frame = window.requestAnimationFrame(tick);

      sessionRef.current = session;
      update(session);
    },
    [finish, measure, update],
  );

  // A drag does not survive its list.
  useEffect(
    () => () => {
      if (sessionRef.current) teardown(sessionRef.current);
    },
    [teardown],
  );

  return { containerRef, drag, startDrag };
}
