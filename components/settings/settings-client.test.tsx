// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsClient } from './settings-client';
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from '@/lib/preferences';

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

describe('SettingsClient', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('does not clobber preferences other cards changed after mount', async () => {
    const user = userEvent.setup();
    render(<SettingsClient />);
    const vibration = await screen.findByRole('switch', { name: /vibration/i });

    // The plate-fallback card (its own component with its own prefs copy)
    // commits a plate edit after this component mounted.
    savePreferences({ ...loadPreferences(), platesLb: [45, 25] });

    await user.click(vibration);

    const stored = loadPreferences();
    expect(stored.vibration).toBe(!DEFAULT_PREFERENCES.vibration);
    expect(stored.platesLb).toEqual([45, 25]);
  });

  it('persists the end-of-rest flash setting (issue #393)', async () => {
    const user = userEvent.setup();
    render(<SettingsClient />);
    const flash = await screen.findByRole('switch', { name: /flash the screen/i });
    expect(flash).toHaveAttribute('aria-checked', 'false');

    await user.click(flash);

    expect(loadPreferences().restEndFlash).toBe(true);
  });
});
