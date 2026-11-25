// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Issue #593: a test that timed out kept typing into the next test's form.
// vitest.setup.ts binds every user-event instance to the test that created it.
// The first test of the pair below leaves an action unfinished on purpose, as
// a timed-out test does; the second one must not see any of it.

const TEST_OVER = /the test that created this instance is over/;

let abandoned: {
  user: ReturnType<typeof userEvent.setup>;
  typing: Promise<void>;
} | null = null;

const shared = userEvent.setup();

describe('a user-event instance left running by a finished test', () => {
  it('(first half) starts typing and returns without waiting for it', () => {
    render(<input aria-label="first" />);
    const user = userEvent.setup();
    const typing = user.type(screen.getByLabelText('first'), 'abcdefghijklmnopqrst');
    // Reported in the next test; without this the rejection would be unhandled.
    typing.catch(() => {});
    abandoned = { user, typing };
  });

  it('stops before its next keystroke and never reaches the next test', async () => {
    render(<input aria-label="second" />);
    const second = screen.getByLabelText('second');
    // Where the abandoned keystrokes would go: the focused field.
    second.focus();

    await expect(abandoned!.typing).rejects.toThrow(TEST_OVER);
    expect(second).toHaveValue('');

    // Whatever it tries next is refused before anything is dispatched.
    await expect(abandoned!.user.type(second, 'zzz')).rejects.toThrow(TEST_OVER);
    await expect(abandoned!.user.keyboard('zzz')).rejects.toThrow(TEST_OVER);
    await expect(abandoned!.user.click(second)).rejects.toThrow(TEST_OVER);
    await expect(abandoned!.user.setup({ delay: null }).keyboard('zzz')).rejects.toThrow(TEST_OVER);
    expect(second).toHaveValue('');

    // This test's own instance works as usual.
    const user = userEvent.setup();
    await user.type(second, 'mine');
    expect(second).toHaveValue('mine');
  });
});

let abandonedDirect: { typing: Promise<unknown>; keys: Promise<unknown> } | null = null;

describe('a direct userEvent call left running by a finished test', () => {
  it('(first half) starts userEvent.type and userEvent.keyboard and returns', () => {
    render(<input aria-label="first" />);
    const first = screen.getByLabelText('first');
    const typing = userEvent.type(first, 'abcdefghijklmnopqrst');
    const keys = userEvent.keyboard('uvwxyzuvwxyzuvwxyz');
    typing.catch(() => {});
    keys.catch(() => {});
    abandonedDirect = { typing, keys };
  });

  it('stops at its next pause and never reaches the next test', async () => {
    render(<input aria-label="second" />);
    const second = screen.getByLabelText('second');
    second.focus();

    await expect(abandonedDirect!.typing).rejects.toThrow(TEST_OVER);
    await expect(abandonedDirect!.keys).rejects.toThrow(TEST_OVER);
    expect(second).toHaveValue('');
  });
});

describe('what the binding leaves alone', () => {
  it('an instance created outside a test keeps working in every test (1)', async () => {
    render(<input aria-label="field" />);
    await shared.type(screen.getByLabelText('field'), 'one');
    expect(screen.getByLabelText('field')).toHaveValue('one');
  });

  it('an instance created outside a test keeps working in every test (2)', async () => {
    render(<input aria-label="field" />);
    await shared.type(screen.getByLabelText('field'), 'two');
    expect(screen.getByLabelText('field')).toHaveValue('two');
  });

  it("still calls the test's own advanceTimers on every pause", async () => {
    const advance = vi.fn();
    render(<input aria-label="field" />);
    const user = userEvent.setup({ delay: 5, advanceTimers: advance });
    await user.type(screen.getByLabelText('field'), 'abc');
    expect(screen.getByLabelText('field')).toHaveValue('abc');
    expect(advance).toHaveBeenCalledWith(5);
    expect(advance.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('types without a pause when the delay is null', async () => {
    render(<input aria-label="field" />);
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText('field'), 'no pause');
    expect(screen.getByLabelText('field')).toHaveValue('no pause');
  });

  it('the direct userEvent.type, keyboard and click still work', async () => {
    const onClick = vi.fn();
    render(
      <>
        <input aria-label="field" />
        <button onClick={onClick}>Go</button>
      </>,
    );
    await userEvent.type(screen.getByLabelText('field'), 'direct');
    await userEvent.keyboard(' keys');
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByLabelText('field')).toHaveValue('direct keys');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
