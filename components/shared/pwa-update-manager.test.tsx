// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PwaUpdateManager,
  RELOAD_GUARD_STORAGE_KEY,
  RELOAD_GUARD_WINDOW_MS,
  isLiveSessionRoute,
  reloadedRecently,
} from './pwa-update-manager';

let currentPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');

beforeEach(() => {
  currentPathname = '/';
  window.sessionStorage.removeItem(RELOAD_GUARD_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  if (originalServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  } else {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  }
  if (originalVisibilityState) {
    Object.defineProperty(document, 'visibilityState', originalVisibilityState);
  }
  vi.restoreAllMocks();
});

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
}

function installServiceWorkerMock(controller: ServiceWorker | null = {} as ServiceWorker) {
  const update = vi.fn().mockResolvedValue(undefined);
  const registration = { update } as unknown as ServiceWorkerRegistration;
  const listeners = new Map<string, EventListener>();
  const removed = new Map<string, EventListener>();
  const serviceWorker = {
    controller,
    ready: Promise.resolve(registration),
    getRegistration: vi.fn().mockResolvedValue(registration),
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') listeners.set(type, listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') removed.set(type, listener);
    }),
  } as unknown as ServiceWorkerContainer;

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: serviceWorker,
  });

  return { serviceWorker, update, listeners, removed };
}

function fireControllerChange(listeners: Map<string, EventListener>) {
  act(() => listeners.get('controllerchange')?.(new Event('controllerchange')));
}

describe('PwaUpdateManager', () => {
  it('checks for updates and removes the very listeners it added on unmount', async () => {
    const { serviceWorker, update, listeners, removed } = installServiceWorkerMock();
    const addedOnDocument = new Map<string, EventListenerOrEventListenerObject>();
    const addedOnWindow = new Map<string, EventListenerOrEventListenerObject>();
    const removedFromDocument = new Map<string, EventListenerOrEventListenerObject>();
    const removedFromWindow = new Map<string, EventListenerOrEventListenerObject>();
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener) => {
      if (listener) addedOnDocument.set(type, listener);
    });
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      if (listener) addedOnWindow.set(type, listener);
    });
    vi.spyOn(document, 'removeEventListener').mockImplementation((type, listener) => {
      if (listener) removedFromDocument.set(type, listener);
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener) => {
      if (listener) removedFromWindow.set(type, listener);
    });
    const view = render(<PwaUpdateManager reloadPage={vi.fn()} />);

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(serviceWorker.addEventListener).toHaveBeenCalledWith(
      'controllerchange',
      expect.any(Function),
    );

    view.unmount();

    // The same function references, not merely the same event names.
    expect(removed.get('controllerchange')).toBe(listeners.get('controllerchange'));
    expect(removedFromDocument.get('visibilitychange')).toBe(
      addedOnDocument.get('visibilitychange'),
    );
    expect(removedFromWindow.get('online')).toBe(addedOnWindow.get('online'));
  });

  it('ignores the initial controller install but reloads for a replacement controller', () => {
    const initial = installServiceWorkerMock(null);
    const reloadInitial = vi.fn();
    const firstView = render(<PwaUpdateManager reloadPage={reloadInitial} />);

    (initial.serviceWorker as { controller: ServiceWorker | null }).controller =
      {} as ServiceWorker;
    fireControllerChange(initial.listeners);
    expect(reloadInitial).not.toHaveBeenCalled();
    firstView.unmount();

    const replacement = installServiceWorkerMock({} as ServiceWorker);
    const reloadReplacement = vi.fn();
    render(<PwaUpdateManager reloadPage={reloadReplacement} />);

    fireControllerChange(replacement.listeners);
    expect(reloadReplacement).toHaveBeenCalledTimes(1);
  });

  it('defers a replacement reload while hidden and reloads when visibility returns', () => {
    setVisibilityState('hidden');
    const { listeners } = installServiceWorkerMock({} as ServiceWorker);
    const reload = vi.fn();
    render(<PwaUpdateManager reloadPage={reload} />);

    fireControllerChange(listeners);
    expect(reload).not.toHaveBeenCalled();

    setVisibilityState('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads a visible live session; the reload fires on the next navigation away', () => {
    currentPathname = '/session/abc123';
    const { listeners } = installServiceWorkerMock({} as ServiceWorker);
    const reload = vi.fn();
    const view = render(<PwaUpdateManager reloadPage={reload} />);

    fireControllerChange(listeners);
    expect(reload).not.toHaveBeenCalled();

    // Moving between sessions keeps the deferral.
    currentPathname = '/session/new';
    view.rerender(<PwaUpdateManager reloadPage={reload} />);
    expect(reload).not.toHaveBeenCalled();

    currentPathname = '/history';
    view.rerender(<PwaUpdateManager reloadPage={reload} />);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps a live session on screen when the tab returns, and reloads once it is left', () => {
    currentPathname = '/session/abc123';
    setVisibilityState('hidden');
    const { listeners } = installServiceWorkerMock({} as ServiceWorker);
    const reload = vi.fn();
    const view = render(<PwaUpdateManager reloadPage={reload} />);

    fireControllerChange(listeners);
    setVisibilityState('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(reload).not.toHaveBeenCalled();

    currentPathname = '/';
    view.rerender(<PwaUpdateManager reloadPage={reload} />);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload again inside the guard window after a previous update reload', () => {
    const { listeners } = installServiceWorkerMock({} as ServiceWorker);
    const reload = vi.fn();
    render(<PwaUpdateManager reloadPage={reload} />);

    fireControllerChange(listeners);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(RELOAD_GUARD_STORAGE_KEY)).not.toBeNull();

    // A fresh page load (new component instance) after that reload sees the marker.
    cleanup();
    const second = installServiceWorkerMock({} as ServiceWorker);
    const reloadAgain = vi.fn();
    render(<PwaUpdateManager reloadPage={reloadAgain} />);
    fireControllerChange(second.listeners);
    expect(reloadAgain).not.toHaveBeenCalled();

    // Once the window has passed, the next update reloads normally.
    window.sessionStorage.setItem(
      RELOAD_GUARD_STORAGE_KEY,
      String(Date.now() - RELOAD_GUARD_WINDOW_MS - 1),
    );
    cleanup();
    const third = installServiceWorkerMock({} as ServiceWorker);
    const reloadLater = vi.fn();
    render(<PwaUpdateManager reloadPage={reloadLater} />);
    fireControllerChange(third.listeners);
    expect(reloadLater).toHaveBeenCalledTimes(1);
  });

  it('checks for updates again when the page becomes visible or comes online', async () => {
    setVisibilityState('hidden');
    const { serviceWorker, update } = installServiceWorkerMock({} as ServiceWorker);
    render(<PwaUpdateManager reloadPage={vi.fn()} />);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    update.mockClear();

    setVisibilityState('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(serviceWorker.getRegistration).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    (serviceWorker.getRegistration as ReturnType<typeof vi.fn>).mockClear();
    update.mockClear();
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(serviceWorker.getRegistration).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });
});

describe('isLiveSessionRoute', () => {
  it('matches only the live session routes', () => {
    expect(isLiveSessionRoute('/session/abc')).toBe(true);
    expect(isLiveSessionRoute('/session/new')).toBe(true);
    expect(isLiveSessionRoute('/sessions')).toBe(false);
    expect(isLiveSessionRoute('/history')).toBe(false);
    expect(isLiveSessionRoute(null)).toBe(false);
  });
});

describe('reloadedRecently', () => {
  it('reads the marker defensively', () => {
    expect(reloadedRecently()).toBe(false);
    window.sessionStorage.setItem(RELOAD_GUARD_STORAGE_KEY, 'not-a-number');
    expect(reloadedRecently()).toBe(false);
    const now = Date.now();
    window.sessionStorage.setItem(RELOAD_GUARD_STORAGE_KEY, String(now - 1000));
    expect(reloadedRecently(now)).toBe(true);
    expect(reloadedRecently(now + RELOAD_GUARD_WINDOW_MS)).toBe(false);
  });
});
