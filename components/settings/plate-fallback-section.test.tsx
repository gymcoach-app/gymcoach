import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as nextIntl from 'next-intl';
import { PlateFallbackSection } from './plate-fallback-section';
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from '@/lib/preferences';

describe('PlateFallbackSection', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders a kg and an lb editor with the stored values', async () => {
    savePreferences({ ...DEFAULT_PREFERENCES, barWeightLb: 33, platesLb: [45, 25] });
    render(<PlateFallbackSection />);

    expect(await screen.findByLabelText('Bar weight (kg)')).toHaveValue(20);
    expect(screen.getByLabelText('Bar weight (lb)')).toHaveValue(33);
    expect(screen.getByLabelText('Plates per side (lb)')).toHaveValue('45, 25');
  });

  it('commits a cleaned, descending lb plate list on blur', async () => {
    const user = userEvent.setup();
    render(<PlateFallbackSection />);

    const plates = await screen.findByLabelText('Plates per side (lb)');
    await user.clear(plates);
    await user.type(plates, '2.5, 45, junk, 25,');
    await user.tab();

    expect(loadPreferences().platesLb).toEqual([45, 25, 2.5]);
    // The kg inventory is untouched.
    expect(loadPreferences().platesKg).toEqual(DEFAULT_PREFERENCES.platesKg);
  });

  it('saves an edited bar weight', async () => {
    const user = userEvent.setup();
    render(<PlateFallbackSection />);

    const bar = await screen.findByLabelText('Bar weight (kg)');
    await user.clear(bar);
    await user.type(bar, '15');

    expect(loadPreferences().barWeightKg).toBe(15);
  });

  it('does not clobber preferences other cards changed after mount', async () => {
    const user = userEvent.setup();
    render(<PlateFallbackSection />);
    await screen.findByLabelText('Bar weight (kg)');

    // Another settings card writes a different preference after this one
    // mounted (each card keeps its own copy of the prefs).
    savePreferences({ ...loadPreferences(), vibration: false });

    const plates = screen.getByLabelText('Plates per side (kg)');
    await user.clear(plates);
    await user.type(plates, '25, 20');
    await user.tab();

    const stored = loadPreferences();
    expect(stored.platesKg).toEqual([25, 20]);
    expect(stored.vibration).toBe(false);
  });

  it('describes each plates field with the separator hint', async () => {
    render(<PlateFallbackSection />);

    expect(await screen.findByLabelText('Plates per side (kg)')).toHaveAccessibleDescription(
      'Separate plates with a comma and a space.',
    );
    expect(screen.getByLabelText('Plates per side (lb)')).toHaveAccessibleDescription(
      'Separate plates with a comma and a space.',
    );
  });

  describe('in a comma-decimal locale (issue #514)', () => {
    beforeEach(() => {
      vi.spyOn(nextIntl, 'useLocale').mockReturnValue('fr');
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('stores "2,5" as one 2.5 plate, never 2 and 5', async () => {
      const user = userEvent.setup();
      render(<PlateFallbackSection />);

      const plates = await screen.findByLabelText('Plates per side (kg)');
      await user.clear(plates);
      await user.type(plates, '25, 20, 2,5, 1,25');
      await user.tab();

      expect(loadPreferences().platesKg).toEqual([25, 20, 2.5, 1.25]);
      // The list is shown back with the locale's decimal mark.
      expect(plates).toHaveValue('25, 20, 2,5, 1,25');
    });

    it('still reads an unspaced list as separate plates', async () => {
      const user = userEvent.setup();
      render(<PlateFallbackSection />);

      const plates = await screen.findByLabelText('Plates per side (kg)');
      await user.clear(plates);
      await user.type(plates, '25,20,15');
      await user.tab();

      expect(loadPreferences().platesKg).toEqual([25, 20, 15]);
    });
  });
});
