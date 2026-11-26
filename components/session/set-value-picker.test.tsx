// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetValuePicker } from './set-value-picker';

const weightOptions = [{ value: 50 }, { value: 60 }, { value: 70 }];

// Places the three weight rows so that `centered` sits under the fixed pointer.
function centerOption(centered: 50 | 60 | 70) {
  const list = screen.getByTestId('set-value-options');
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 });
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 300 } as DOMRect);
  const offset = { 50: 0, 60: 1, 70: 2 }[centered];
  [50, 60, 70].forEach((weight, index) => {
    vi.spyOn(
      screen.getByRole('button', { name: `${weight} kg` }),
      'getBoundingClientRect',
    ).mockReturnValue({ top: 118 + (index - offset) * 84, height: 64 } as DOMRect);
  });
  return list;
}

// Same idea for an arbitrary kg list: `centered` is the row under the pointer.
function placeRows(weights: number[], centered: number) {
  const list = screen.getByTestId('set-value-options');
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 });
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 300 } as DOMRect);
  const offset = weights.indexOf(centered);
  weights.forEach((weight, index) => {
    vi.spyOn(
      screen.getByRole('button', { name: `${weight} kg` }),
      'getBoundingClientRect',
    ).mockReturnValue({ top: 118 + (index - offset) * 84, height: 64 } as DOMRect);
  });
  return list;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('SetValuePicker', () => {
  it('keeps a tapped gym weight pending until Apply confirms it', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={[{ value: 50 }, { value: 60 }, { value: 70 }]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    const option = screen.getByRole('button', { name: '70 kg' });
    fireEvent.click(option);

    expect(onChoose).not.toHaveBeenCalled();
    expect(option).toHaveAttribute('data-picker-selected', 'true');
    expect(screen.getByRole('spinbutton')).toHaveValue(70);

    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledOnce();
    expect(onChoose).toHaveBeenCalledWith(70);
  });

  it('tracks the option under the fixed pointer while scrolling without auto-confirming', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={[{ value: 50 }, { value: 60 }, { value: 70 }]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    const list = screen.getByTestId('set-value-options');
    const fifty = screen.getByRole('button', { name: '50 kg' });
    const sixty = screen.getByRole('button', { name: '60 kg' });
    const seventy = screen.getByRole('button', { name: '70 kg' });

    expect(screen.getByTestId('weight-picker-pointer')).toBeInTheDocument();
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 });
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 300 } as DOMRect);
    vi.spyOn(fifty, 'getBoundingClientRect').mockReturnValue({ top: -48, height: 64 } as DOMRect);
    vi.spyOn(sixty, 'getBoundingClientRect').mockReturnValue({ top: 34, height: 64 } as DOMRect);
    vi.spyOn(seventy, 'getBoundingClientRect').mockReturnValue({ top: 118, height: 64 } as DOMRect);

    fireEvent.pointerDown(list);
    fireEvent.scroll(list);

    expect(onChoose).not.toHaveBeenCalled();
    expect(seventy).toHaveAttribute('data-picker-selected', 'true');
    expect(screen.getByRole('spinbutton')).toHaveValue(70);

    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(70);
  });

  it('updates the barbell loading preview while a gym weight is still pending', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={[{ value: 60 }, { value: 70 }]}
        unit="KG"
        loadConstraints={{
          equipmentType: 'BARBELL',
          barWeights: [20],
          plateWeights: [20, 10, 5, 2.5],
          weightOptions: [60, 70],
        }}
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    const preview = screen.getByTestId('barbell-side-diagram');
    expect(preview).toHaveAttribute('data-target-weight', '60');

    fireEvent.click(screen.getByRole('button', { name: '70 kg' }));

    expect(onChoose).not.toHaveBeenCalled();
    expect(preview).toHaveAttribute('data-target-weight', '70');
  });

  it('prefers the closest bar when the target is below every available bar', () => {
    render(
      <SetValuePicker
        open
        kind="weight"
        value={10}
        options={[{ value: 10 }]}
        unit="KG"
        loadConstraints={{
          equipmentType: 'BARBELL',
          barWeights: [20, 30],
          plateWeights: [5],
          weightOptions: [10],
        }}
        onClose={vi.fn()}
        onChoose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('barbell-side-diagram')).toHaveTextContent('20 kg');
    expect(screen.getByTestId('barbell-side-diagram')).not.toHaveTextContent('30 kg');
  });

  it('previews the load with the shared bar selection, ignoring unusable gym bars', () => {
    render(
      <SetValuePicker
        open
        kind="weight"
        value={62.5}
        options={[{ value: 62.5 }]}
        unit="KG"
        loadConstraints={{
          equipmentType: 'BARBELL',
          barWeights: [0, 20],
          plateWeights: [20, 1.25],
          weightOptions: [62.5],
        }}
        onClose={vi.fn()}
        onChoose={vi.fn()}
      />,
    );

    // A zero-weight "bar" would load 62.5 exactly with plates alone; the shared
    // computeBestPlateLoad drops it and loads the real 20 kg bar instead.
    const preview = screen.getByTestId('barbell-side-diagram');
    expect(preview).toHaveTextContent('Loads to 62.5 kg (bar 20 kg).');
    expect(screen.getAllByTestId('barbell-plate').map((plate) => plate.textContent)).toEqual([
      '20',
      '1.25',
    ]);
  });

  it('retains manual decimal entry as a weight fallback', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={[{ value: 50 }, { value: 60 }, { value: 70 }]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    const list = centerOption(50);
    fireEvent.pointerDown(list);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '72.5' } });
    fireEvent.scroll(list);
    expect(screen.getByRole('spinbutton')).toHaveValue(72.5);
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));

    expect(onChoose).toHaveBeenCalledWith(72.5);
  });

  it('keeps repetition choices pending until Apply too', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="reps"
        value={10}
        options={[{ value: 8 }, { value: 10 }, { value: 12 }]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '12 reps' }));
    expect(onChoose).not.toHaveBeenCalled();
    expect(screen.getByRole('spinbutton')).toHaveValue(12);

    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(12);
  });

  it('keeps a tapped value when the parent re-renders with a new options array', () => {
    const onChoose = vi.fn();
    const props = {
      open: true,
      kind: 'weight' as const,
      value: 60,
      unit: 'KG' as const,
      onClose: vi.fn(),
      onChoose,
    };
    const view = render(<SetValuePicker {...props} options={[...weightOptions]} />);

    fireEvent.click(screen.getByRole('button', { name: '70 kg' }));
    // The session runner rebuilds the option list on every render.
    view.rerender(<SetValuePicker {...props} options={[...weightOptions]} />);

    expect(screen.getByRole('button', { name: '70 kg' })).toHaveAttribute(
      'data-picker-selected',
      'true',
    );
    expect(screen.getByRole('spinbutton')).toHaveValue(70);
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(70);
  });

  it('keeps a typed value when the parent re-renders with a new options array', () => {
    const onChoose = vi.fn();
    const props = {
      open: true,
      kind: 'weight' as const,
      value: 60,
      unit: 'KG' as const,
      onClose: vi.fn(),
      onChoose,
    };
    const view = render(<SetValuePicker {...props} options={[...weightOptions]} />);

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '72.5' } });
    view.rerender(<SetValuePicker {...props} options={[...weightOptions]} />);

    expect(screen.getByRole('spinbutton')).toHaveValue(72.5);
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(72.5);
  });

  it('seeds again when the picker is closed and reopened on another value', () => {
    const props = {
      kind: 'weight' as const,
      options: weightOptions,
      unit: 'KG' as const,
      onClose: vi.fn(),
      onChoose: vi.fn(),
    };
    const view = render(<SetValuePicker {...props} open value={60} />);
    fireEvent.click(screen.getByRole('button', { name: '70 kg' }));

    view.rerender(<SetValuePicker {...props} open={false} value={60} />);
    view.rerender(<SetValuePicker {...props} open value={50} />);

    expect(screen.getByRole('spinbutton')).toHaveValue(50);
    expect(screen.getByRole('button', { name: '50 kg' })).toHaveAttribute(
      'data-picker-selected',
      'true',
    );
  });

  it('opens on the exact weight above the option range and applies it unchanged', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={220}
        canonicalValue={220}
        options={[{ value: 180 }, { value: 190 }, { value: 200 }]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    expect(screen.getByRole('spinbutton')).toHaveValue(220);
    // The nearest option is only shown, never adopted.
    expect(screen.getByRole('button', { name: '200 kg' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledOnce();
    expect(onChoose).toHaveBeenCalledWith(220, 220);
  });

  it('opens on an off-grid weight without snapping it to the nearest option', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={73}
        options={[{ value: 70 }, { value: 72.5 }, { value: 75 }]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    expect(screen.getByRole('spinbutton')).toHaveValue(73);
    for (const name of ['70 kg', '72.5 kg', '75 kg']) {
      expect(screen.getByRole('button', { name })).not.toHaveAttribute('data-picker-selected');
    }

    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(73);
  });

  it('keeps an off-grid weight when the wheel settles back on the row it opened on', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={73}
        canonicalValue={73}
        options={[{ value: 70 }, { value: 72.5 }, { value: 75 }]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    // 73 opens with its nearest row, 72.5, under the pointer. A nudge that snaps
    // back to that row is not a move to another row.
    const list = placeRows([70, 72.5, 75], 72.5);
    fireEvent.pointerDown(list);
    fireEvent.scroll(list);

    expect(screen.getByRole('spinbutton')).toHaveValue(73);
    expect(screen.getByRole('button', { name: '72.5 kg' })).not.toHaveAttribute(
      'data-picker-selected',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledOnce();
    expect(onChoose).toHaveBeenCalledWith(73, 73);
  });

  it('adopts a row once the wheel moves off the one an off-grid weight opened on', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={73}
        canonicalValue={73}
        options={[{ value: 70 }, { value: 72.5 }, { value: 75 }]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    const list = placeRows([70, 72.5, 75], 75);
    fireEvent.pointerDown(list);
    fireEvent.scroll(list);
    expect(screen.getByRole('spinbutton')).toHaveValue(75);

    // Coming back to 72.5 is now a real move too: the wheel left that row.
    placeRows([70, 72.5, 75], 72.5);
    fireEvent.scroll(list);
    expect(screen.getByRole('spinbutton')).toHaveValue(72.5);
    expect(screen.getByRole('button', { name: '72.5 kg' })).toHaveAttribute(
      'data-picker-selected',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(72.5);
  });

  it('keeps a typed value on an off-grid seed when the wheel stays on its row', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={73}
        options={[{ value: 70 }, { value: 72.5 }, { value: 75 }]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '80' } });
    const list = placeRows([70, 72.5, 75], 72.5);
    fireEvent.pointerDown(list);
    fireEvent.scroll(list);

    expect(screen.getByRole('spinbutton')).toHaveValue(80);
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(80);
  });

  it('hands back the stored kg weight when a rounded lb value is applied unchanged', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={160.9}
        canonicalValue={73}
        options={[
          { value: 159.84, canonicalValue: 72.5, label: '159.84' },
          { value: 165.35, canonicalValue: 75, label: '165.35' },
        ]}
        unit="LB"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    expect(screen.getByRole('spinbutton')).toHaveValue(160.9);
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(160.9, 73);
  });

  it('submits the canonical kg weight of a tapped lb option', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={220.5}
        canonicalValue={100}
        options={[
          { value: 220.46, canonicalValue: 100, label: '220.46' },
          { value: 225.97, canonicalValue: 102.5, label: '225.97' },
        ]}
        unit="LB"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    // The stored 100 kg is on the list, so its own option is the selected one.
    expect(screen.getByRole('button', { name: '220.46 lb' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '225.97 lb' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(225.97, 102.5);
  });

  it('commits the tapped option even when Apply lands during the recentering scroll', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={weightOptions}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    // Mid-animation another row is still under the pointer.
    const list = centerOption(50);
    const seventy = screen.getByRole('button', { name: '70 kg' });
    fireEvent.pointerDown(seventy);
    fireEvent.click(seventy);
    fireEvent.scroll(list);

    expect(seventy).toHaveAttribute('data-picker-selected', 'true');
    expect(screen.getByRole('spinbutton')).toHaveValue(70);
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(70);
  });

  it('does not move the pending value on focus or keyboard scrolling', () => {
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={weightOptions}
        unit="KG"
        onClose={vi.fn()}
        onChoose={vi.fn()}
      />,
    );

    const list = centerOption(70);
    const sixty = screen.getByRole('button', { name: '60 kg' });

    // A scroll nobody gestured for (the opening scroll, scroll snapping).
    fireEvent.scroll(list);
    expect(sixty).toHaveAttribute('aria-pressed', 'true');

    // Tabbing onto a row scrolls it into view.
    fireEvent.pointerDown(list);
    fireEvent.focus(screen.getByRole('button', { name: '70 kg' }));
    fireEvent.scroll(list);
    expect(sixty).toHaveAttribute('aria-pressed', 'true');

    // Arrow keys scroll the list.
    fireEvent.pointerDown(list);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.scroll(list);
    expect(sixty).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('spinbutton')).toHaveValue(60);
  });

  it('exposes the pending option as pressed', () => {
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={weightOptions}
        unit="KG"
        onClose={vi.fn()}
        onChoose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '60 kg' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '70 kg' }));
    expect(screen.getByRole('button', { name: '60 kg' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '70 kg' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('highlights the row a typed value would commit, and none when it matches no row', () => {
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={weightOptions}
        unit="KG"
        onClose={vi.fn()}
        onChoose={vi.fn()}
      />,
    );

    const input = screen.getByRole('spinbutton');
    const sixty = screen.getByRole('button', { name: '60 kg' });
    const seventy = screen.getByRole('button', { name: '70 kg' });

    fireEvent.change(input, { target: { value: '70' } });
    expect(seventy).toHaveAttribute('aria-pressed', 'true');
    expect(seventy).toHaveAttribute('data-picker-selected', 'true');
    expect(sixty).toHaveAttribute('aria-pressed', 'false');
    expect(sixty).not.toHaveAttribute('data-picker-selected');

    // Off the list, or not applicable at all: no row claims to be the choice.
    for (const value of ['65', '']) {
      fireEvent.change(input, { target: { value } });
      expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
    }
  });

  it('keeps the highlight and the plate preview on a typed value when the wheel is only touched', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={[{ value: 60 }, { value: 70 }]}
        unit="KG"
        loadConstraints={{
          equipmentType: 'BARBELL',
          barWeights: [20],
          plateWeights: [20, 10, 5, 2.5],
          weightOptions: [60, 70],
        }}
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    const preview = screen.getByTestId('barbell-side-diagram');
    const seventy = screen.getByRole('button', { name: '70 kg' });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '70' } });
    expect(preview).toHaveAttribute('data-target-weight', '70');

    // A touch that does not move the wheel leaves the typed value in charge.
    fireEvent.pointerDown(screen.getByTestId('set-value-options'));
    expect(screen.getByRole('spinbutton')).toHaveValue(70);
    expect(preview).toHaveAttribute('data-target-weight', '70');
    expect(seventy).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(70);
  });

  it('lets a real wheel move replace a typed value everywhere at once', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={weightOptions}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '72.5' } });
    const list = centerOption(50);
    fireEvent.pointerDown(list);
    fireEvent.scroll(list);

    expect(screen.getByRole('spinbutton')).toHaveValue(50);
    expect(screen.getByRole('button', { name: '50 kg' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(50);
  });

  it('highlights the repetition count Apply will commit for a typed value', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="reps"
        value={10}
        options={[{ value: 8 }, { value: 10 }, { value: 12 }]}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '11.6' } });
    expect(screen.getByRole('button', { name: '12 reps' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '10 reps' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply value' }));
    expect(onChoose).toHaveBeenCalledWith(12);
  });

  it('disables Apply for an empty, negative or non-numeric manual entry', () => {
    const onChoose = vi.fn();
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={weightOptions}
        unit="KG"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );

    const input = screen.getByRole('spinbutton');
    const apply = screen.getByRole('button', { name: 'Apply value' });
    expect(apply).toBeEnabled();

    for (const value of ['-5', '']) {
      fireEvent.change(input, { target: { value } });
      expect(apply).toBeDisabled();
      fireEvent.click(apply);
    }
    expect(onChoose).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '62.5' } });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(onChoose).toHaveBeenCalledWith(62.5);
  });

  it('recenters smoothly only when reduced motion is not requested', () => {
    render(
      <SetValuePicker
        open
        kind="weight"
        value={60}
        options={weightOptions}
        unit="KG"
        onClose={vi.fn()}
        onChoose={vi.fn()}
      />,
    );

    const list = screen.getByTestId('set-value-options');
    const scrollTo = vi.fn();
    Object.defineProperty(list, 'scrollTo', { configurable: true, value: scrollTo });
    expect(list).toHaveClass('motion-safe:scroll-smooth');
    expect(list).not.toHaveClass('scroll-smooth');

    fireEvent.click(screen.getByRole('button', { name: '70 kg' }));
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'smooth' }));

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }),
    });
    fireEvent.click(screen.getByRole('button', { name: '50 kg' }));
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });
});
