// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MuscleMapCard } from './muscle-map-card';
import { buildMuscleMap } from '@/lib/muscle-map';

const WEEK = 'W33 2026';

describe('MuscleMapCard', () => {
  it('renders both views with a region per silhouette area', () => {
    render(<MuscleMapCard regions={buildMuscleMap({})} weekLabel={WEEK} />);

    expect(screen.getByRole('group', { name: 'Front' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Back' })).toBeInTheDocument();
    // Each region is its own img so screen readers reach the per-region labels.
    expect(screen.getAllByRole('img').length).toBe(27);
    // 13 front + 14 back paintable regions.
    expect(document.querySelectorAll('svg path[aria-label]')).toHaveLength(27);
  });

  it('applies the level fill and the accessible label with the set count', () => {
    // 14 sets sit inside the default 10-20 band; 25 sits above it.
    render(
      <MuscleMapCard regions={buildMuscleMap({ CHEST: 14, QUADS: 25 })} weekLabel={WEEK} />,
    );

    const chest = screen.getAllByLabelText('Chest: 14 sets this week, within range');
    expect(chest).toHaveLength(2);
    expect(chest[0]).toHaveClass('fill-orange-500');

    const quads = screen.getAllByLabelText('Quads: 25 sets this week, above MRV');
    expect(quads[0]).toHaveClass('fill-red-700');

    const untouched = screen.getAllByLabelText('Abs: 0 sets this week, untrained');
    expect(untouched[0]).toHaveClass('fill-muted');
  });

  it('shows the tapped region detail below the figures', async () => {
    const user = userEvent.setup();
    render(<MuscleMapCard regions={buildMuscleMap({ CHEST: 14 })} weekLabel={WEEK} />);

    await user.click(screen.getAllByLabelText('Chest: 14 sets this week, within range')[0]!);
    expect(screen.getByTestId('muscle-map-detail')).toHaveTextContent(
      'Chest: 14 sets this week, within range',
    );
  });

  it('renders an empty state when no muscle was trained that week', () => {
    render(<MuscleMapCard regions={buildMuscleMap({})} weekLabel={WEEK} />);
    expect(screen.getByTestId('muscle-map-detail')).toHaveTextContent(
      /no working sets that week/i,
    );
  });
});
