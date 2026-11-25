// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WarmupCalculator } from './warmup-calculator';

describe('WarmupCalculator', () => {
  it('shows the ramp for the working weight when opened (kg)', async () => {
    const user = userEvent.setup();
    // 100 kg working weight, default 20 kg bar -> empty bar + 40/60/80 kg.
    render(<WarmupCalculator weightKg={100} unit="KG" />);

    await user.click(screen.getByRole('button', { name: /warm-up calculator/i }));

    const list = await screen.findByRole('list', { name: /warm-up sets/i });
    expect(list).toBeInTheDocument();
    expect(screen.getByText(/40 kg/)).toBeInTheDocument();
    expect(screen.getByText(/60 kg/)).toBeInTheDocument();
    expect(screen.getByText(/80 kg/)).toBeInTheDocument();
    expect(screen.getByText(/working weight of 100 kg/i)).toBeInTheDocument();
  });

  it('shows the at-or-below-the-bar message for a sub-bar weight', async () => {
    const user = userEvent.setup();
    // 15 kg is below the default 20 kg bar -> no ramp.
    render(<WarmupCalculator weightKg={15} unit="KG" />);

    await user.click(screen.getByRole('button', { name: /warm-up calculator/i }));

    expect(
      await screen.findByText(/at or below the bar/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /warm-up sets/i })).toBeNull();
  });
});
