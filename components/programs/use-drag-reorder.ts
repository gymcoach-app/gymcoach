'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  autoScrollSpeed,
  clampOffset,
  dragOffsetBounds,
  dropIndexForPointer,
  dropIndicatorY,
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
//   blocks, so a superset cannot be split or dropped into.
// - pointerup drops; Escape, pointercancel and a window blur abort and leave
//   the order untouched. Near the top or bottom of the viewport the page
//   scrolls by itself.
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
  // null while the block is over its own place.
  indicatorTop: number | null;
}

interface Session {
  id: string;
  pointerId: number;
  handle: HTMLElement;
  startY: number;
  lastY: number;
  listTopAtStart: number;
  bounds: { min: number; max: number };
  rows: HTMLElement[];
  moved: boolean;
  frame: number | null;
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
  useEffect(() => {
    latestRef.current = { blocks, disabled, onDrop };
  });

  // Rows of every block as they are on screen now, plus the dragged block's
  // index. Null when the grabbed row is gone (removed by a refresh).
  const measure = useCallback((session: Session) => {
    const container = containerRef.current;
    if (!container) return null;
    const rowById = new Map<string, HTMLElement>();
    container.querySelectorAll<HTMLElement>(`[${REORDER_ROW_ATTRIBUTE}]`).forEach((row) => {
      const id = row.getAttribute(REORDER_ROW_ATTRIBUTE);
      if (id) rowById.set(id, row);
    });
    const rowsOf = (block: string[]) =>
      block.map((id) => rowById.get(id)).filter((row): row is HTMLElement => row != null);
    const current = latestRef.current.blocks;
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
    for (const row of session.rows) row.style.transform = '';
    try {
      session.handle.releasePointerCapture?.(session.pointerId);
    } catch {
      // The capture is already gone (the pointer was released or cancelled).
    }
    sessionRef.current = null;
  }, []);

  // Moves the block under the pointer and works out where it would land.
  // Returns the drop index, null when a drop here changes nothing, or
  // 'gone' when the grabbed row no longer exists.
  const update = useCallback(
    (session: Session): number | null | 'gone' => {
      const measured = measure(session);
      if (!measured) return 'gone';
      const { container, from, ids, rows, others } = measured;
      const containerTop = container.getBoundingClientRect().top;
      // The pointer's travel plus how far the list scrolled under it.
      const offset = clampOffset(
        session.lastY - session.startY + (session.listTopAtStart - containerTop),
        session.bounds,
      );
      for (const row of session.rows) {
        if (rows.indexOf(row) === -1) row.style.transform = '';
      }
      session.rows = rows;
      for (const row of rows) row.style.transform = `translate3d(0, ${offset}px, 0)`;

      const dropIndex = dropIndexForPointer(others, session.lastY);
      const changes = dropIndex !== from;
      let indicatorTop: number | null = null;
      if (changes) {
        const list = container.querySelector('ul');
        const gap =
          (list ? parseFloat(window.getComputedStyle(list).rowGap) : NaN) || DEFAULT_ROW_GAP_PX;
        const y = dropIndicatorY(others, dropIndex, gap);
        indicatorTop = y == null ? null : y - containerTop;
      }
      setDrag((previous) =>
        previous &&
        previous.indicatorTop === indicatorTop &&
        previous.ids.length === ids.length &&
        previous.ids.every((id, index) => id === ids[index])
          ? previous
          : { ids, indicatorTop },
      );
      return changes ? dropIndex : null;
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

  const startDrag = useCallback(
    (id: string, event: ReactPointerEvent<HTMLElement>) => {
      if (sessionRef.current || latestRef.current.disabled) return;
      // Main mouse button only; touch and pen report button 0 on contact.
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;

      const handle = event.currentTarget;
      const session: Session = {
        id,
        pointerId: event.pointerId,
        handle,
        startY: event.clientY,
        lastY: event.clientY,
        listTopAtStart: container.getBoundingClientRect().top,
        bounds: { min: 0, max: 0 },
        rows: [],
        moved: false,
        frame: null,
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

      // No text selection and no focus change while dragging with a mouse.
      event.preventDefault();
      try {
        // Keeps the events coming when a mouse leaves the window.
        handle.setPointerCapture?.(event.pointerId);
      } catch {
        // Not capturable (already released): the window listeners still work.
      }

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== session.pointerId) return;
        session.lastY = ev.clientY;
        if (Math.abs(session.lastY - session.startY) >= AUTO_SCROLL_AFTER_PX) session.moved = true;
        if (update(session) === 'gone') finish(false);
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
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
        // The Escape belongs to the drag, not to a dialog or menu behind it.
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      };
      const onBlur = () => finish(false);
      const onScroll = () => {
        if (update(session) === 'gone') finish(false);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('blur', onBlur);
      window.addEventListener('scroll', onScroll, true);
      session.removeListeners = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('scroll', onScroll, true);
      };

      // Autoscroll: one check per frame, since a pointer resting in the edge
      // zone sends no events.
      const tick = () => {
        session.frame = window.requestAnimationFrame(tick);
        if (!session.moved) return;
        const speed = autoScrollSpeed(session.lastY, window.innerHeight);
        if (speed === 0) return;
        window.scrollBy(0, speed);
        if (update(session) === 'gone') finish(false);
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
