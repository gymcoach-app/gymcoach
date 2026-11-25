// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyWorkoutButton } from './copy-workout-button';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
  else Reflect.deleteProperty(document, 'execCommand');
  vi.clearAllMocks();
});

describe('CopyWorkoutButton (issue #405)', () => {
  it('copies the recap through the Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<CopyWorkoutButton text="Push day - today" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Workout copied.'));
    expect(writeText).toHaveBeenCalledWith('Push day - today');
  });

  it('falls back to the legacy copy when the Clipboard API refuses', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('insecure context')) });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    render(<CopyWorkoutButton text="Push day - today" />);
    const button = screen.getByRole('button', { name: 'Copy as text' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(execCommand).toHaveBeenCalledWith('copy');
    // The hidden textarea is gone and focus is back on the button.
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('reports a failure when no copy path works', async () => {
    setClipboard(undefined);
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });
    render(<CopyWorkoutButton text="Push day - today" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
