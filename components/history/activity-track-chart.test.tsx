// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityTrackChart } from './activity-track-chart';

// The chart renders inside Recharts' ResponsiveContainer (zero-sized in jsdom),
// so these tests assert the show/hide decision - the part that matters: the
// chart appears only when the track carries at least two heart-rate samples,
// and renders nothing otherwise so a track without HR shows no empty chart.

describe('ActivityTrackChart', () => {
  it('renders the heart-rate chart when there are at least two HR samples', () => {
    render(
      <ActivityTrackChart
        track={[
          { t: 0, d: 0, hr: 140 },
          { t: 60, d: 200, hr: 150 },
          { t: 120, d: 400, hr: 160 },
        ]}
      />,
    );
    expect(screen.getByTestId('activity-track-chart')).toBeInTheDocument();
    expect(screen.getByText('Heart rate over time')).toBeInTheDocument();
  });

  it('renders nothing with only one HR sample', () => {
    const { container } = render(<ActivityTrackChart track={[{ t: 0, d: 0, hr: 140 }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the track has distance but no heart rate', () => {
    const { container } = render(
      <ActivityTrackChart
        track={[
          { t: 0, d: 0 },
          { t: 60, d: 200 },
        ]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an empty track', () => {
    const { container } = render(<ActivityTrackChart track={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ignores points missing HR when counting samples', () => {
    // Only one of the three points has a heart rate -> below the 2-sample
    // threshold, so nothing renders.
    const { container } = render(
      <ActivityTrackChart
        track={[
          { t: 0, d: 0 },
          { t: 60, d: 200, hr: 150 },
          { t: 120, d: 400 },
        ]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
