// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BarbellSideDiagram } from './barbell-side-diagram';
import { PlateCalculator } from './plate-calculator';

const load = {
  barWeight: 20,
  perSide: [
    { plate: 20, count: 2 },
    { plate: 2.5, count: 1 },
  ],
  achievedWeight: 105,
  remainder: 0,
  exact: true,
};

describe('BarbellSideDiagram', () => {
  it('draws one plate per loaded plate, heaviest first, with its caption', () => {
    render(
      <BarbellSideDiagram load={load} unitLabel="kg" platesLabel="Plates per side">
        <p>caption</p>
      </BarbellSideDiagram>,
    );

    const diagram = screen.getByTestId('barbell-side-diagram');
    expect(diagram).not.toHaveAttribute('data-target-weight');
    expect(diagram).toHaveTextContent('caption');
    const plates = screen.getAllByTestId('barbell-plate');
    expect(plates.map((plate) => plate.textContent)).toEqual(['20', '20', '2.5']);
    expect(plates[0]).toHaveAttribute('title', '20 kg');
    // Plate height scales with the denomination.
    expect(plates[0]).toHaveStyle({ height: '52px' });
    expect(plates[2]).toHaveStyle({ height: '29px' });
  });

  it('exposes the previewed weight and uses the tighter sizing when compact', () => {
    render(
      <BarbellSideDiagram
        load={load}
        unitLabel="kg"
        platesLabel="Plates per side"
        targetWeight={105}
        compact
      />,
    );

    expect(screen.getByTestId('barbell-side-diagram')).toHaveAttribute('data-target-weight', '105');
    expect(screen.getAllByTestId('barbell-plate')[0]).toHaveStyle({ height: '46px' });
  });

  it('is the diagram the plate calculator renders, with the per-side summary', () => {
    render(
      <PlateCalculator weightKg={105} unit="KG" barWeightsKg={[20]} plateWeightsKg={[20, 2.5]} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open the plate calculator' }));

    const diagram = screen.getByTestId('barbell-side-diagram');
    expect(screen.getAllByTestId('barbell-side-diagram')).toHaveLength(1);
    expect(diagram).toHaveTextContent('2 x 20 kg + 1 x 2.5 kg');
    expect(screen.getAllByTestId('barbell-plate')).toHaveLength(3);
    expect(screen.getByText('Loads to 105 kg (bar 20 kg).')).toBeInTheDocument();
  });
});
