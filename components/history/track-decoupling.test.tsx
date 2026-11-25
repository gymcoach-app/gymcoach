// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrackDecoupling } from './track-decoupling';

// The show/hide decision and the wording are the parts that matter: the
// readout appears only when the track carries both cumulative distance and
// heart rate (trackDecoupling returns a number), and the explainer says
// "held steady" under the ~5% threshold and "faded" above it.

describe('TrackDecoupling', () => {
  const steady = [0, 100, 200, 300, 400].map((t) => ({ t, d: t * 3, hr: 150 }));

  it('shows the percentage and the held-steady explainer for a steady track', () => {
    render(<TrackDecoupling track={steady} />);
    expect(screen.getByTestId('track-decoupling')).toBeInTheDocument();
    expect(screen.getByText('Aerobic decoupling')).toBeInTheDocument();
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(screen.getByText(/held steady/)).toBeInTheDocument();
  });

  it('says the pace per heartbeat faded when decoupling exceeds the threshold', () => {
    // Constant speed, HR jumping 140 -> 165 in the second half (~10%).
    const hrs = [140, 140, 140, 165, 165];
    const track = steady.map((p, i) => ({ ...p, hr: hrs[i]! }));
    render(<TrackDecoupling track={track} />);
    expect(screen.getByText(/faded/)).toBeInTheDocument();
    expect(screen.queryByText(/held steady/)).not.toBeInTheDocument();
  });

  it('renders nothing when the track has no heart rate', () => {
    const { container } = render(
      <TrackDecoupling track={[0, 100, 200, 300].map((t) => ({ t, d: t * 3 }))} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the track has no distance', () => {
    const { container } = render(
      <TrackDecoupling track={[0, 100, 200, 300].map((t) => ({ t, hr: 150 }))} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an empty track', () => {
    const { container } = render(<TrackDecoupling track={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
