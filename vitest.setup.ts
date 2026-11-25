// Extends Vitest's `expect` with @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveTextContent, ...) for component tests.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import englishMessages from './messages/en';

// Component tests render isolated client components without app/layout.tsx.
// Provide the same English translator/formatter that the root provider would
// expose so existing assertions remain focused on component behaviour.
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const translator = actual.createTranslator({ locale: 'en', messages: englishMessages });
  const translate = translator as unknown as {
    (key: string, values?: Record<string, unknown>): string;
    rich: (key: string, values?: Record<string, unknown>) => React.ReactNode;
    raw: (key: string) => unknown;
    has: (key: string) => boolean;
  };
  const formatter = actual.createFormatter({ locale: 'en', timeZone: 'UTC' });

  return {
    ...actual,
    useLocale: () => 'en',
    useFormatter: () => formatter,
    useTranslations: (namespace?: string) => {
      const keyFor = (key: string) => (namespace ? `${namespace}.${key}` : key);
      const scoped = (key: string, values?: Record<string, unknown>) =>
        translate(keyFor(key), values);
      scoped.rich = (key: string, values?: Record<string, unknown>) =>
        translate.rich(keyFor(key), values);
      scoped.raw = (key: string) => translate.raw(keyFor(key));
      scoped.has = (key: string) => translate.has(keyFor(key));
      return scoped;
    },
  };
});

// A test that times out is abandoned by Vitest, but its async body keeps
// running. A user-event instance it created then goes on typing, and since a
// keystroke goes to whatever element has the focus, the rest of its text lands
// in the form the next test just rendered: one timeout under load became two
// or three failures (issue #593, live-equipment-weight-editor). So an instance
// made by userEvent.setup() inside a test belongs to that test: once the test
// is over, each of its methods rejects before dispatching anything, and an
// action already in progress stops at its next pause between two steps.
//
// What this does not cover:
// - The direct calls (userEvent.type(...), userEvent.keyboard(...)) are bound
//   only while they run: started inside a test, they stop at the next pause
//   after it ends. The other direct calls (click, clear, ...) are short and
//   are not bound.
// - A call made late, after the test ended: a direct call, or a new
//   userEvent.setup(), issued by an abandoned test while the next test runs
//   cannot be told from that test's own and is treated as its own.
// - `delay: null` has no pause, so an action in progress runs to its end; it
//   cannot outlive its test by more than the microtasks it has left.
// - An instance created outside a test (shared by a whole file) is left alone.
// - it.concurrent: the binding assumes the tests of a file run one after the
//   other. With overlapping tests, the first to finish would end the
//   instances of the others, which then fail on the message below. No test
//   here is concurrent; one that is must share an instance created outside.
const USER_EVENT_TEST_OVER =
  'user-event: the test that created this instance is over (it timed out or returned ' +
  'without awaiting an action). The action was dropped so it cannot reach the next test.';
let finishedTests = 0;
let insideTest = false;
beforeEach(() => {
  insideTest = true;
});
afterEach(() => {
  finishedTests += 1;
  insideTest = false;
});
// Captured before any test installs fake timers.
const realSetTimeout = globalThis.setTimeout;

vi.mock('@testing-library/user-event', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@testing-library/user-event')>();
  const real = actual.default;
  type Options = NonNullable<Parameters<typeof real.setup>[0]>;
  type Instance = ReturnType<typeof real.setup>;

  // Options whose pause between two actions ends in an error once the test is
  // over. The check runs after the pause, right before the next keystroke.
  const bound = (options: Options | undefined, over: () => boolean): Options => ({
    ...options,
    advanceTimers: async (ms: number) => {
      await options?.advanceTimers?.(ms);
      await new Promise<void>((resolve, reject) => {
        realSetTimeout(() => (over() ? reject(new Error(USER_EVENT_TEST_OVER)) : resolve()), 0);
      });
    },
  });

  // The instance, with every action refused once the test is over.
  const guard = (instance: Instance, over: () => boolean): Instance =>
    new Proxy(instance, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        if (prop === 'setup') {
          return (...args: unknown[]) => guard(value.apply(target, args) as Instance, over);
        }
        return (...args: unknown[]) =>
          over() ? Promise.reject(new Error(USER_EVENT_TEST_OVER)) : value.apply(target, args);
      },
    });

  const ownerCheck = (): (() => boolean) | null => {
    if (!insideTest) return null;
    const born = finishedTests;
    return () => finishedTests !== born;
  };

  const userEvent = {
    ...real,
    setup: (options?: Options) => {
      const over = ownerCheck();
      return over ? guard(real.setup(bound(options, over)), over) : real.setup(options);
    },
    // The two direct calls that loop over several keystrokes.
    type: (...[element, text, options]: Parameters<typeof real.type>) => {
      const over = ownerCheck();
      return real.type(element, text, over ? bound(options, over) : options);
    },
    keyboard: (...[text, options]: Parameters<typeof real.keyboard>) => {
      const over = ownerCheck();
      return real.keyboard(text, over ? bound(options, over) : options);
    },
  };
  return { ...actual, default: userEvent, userEvent };
});
