import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EffortInput } from './effort-input';
import { EffortScaleProvider } from './effort-scale-provider';

function Harness({
  scale,
  initial,
  onStore,
}: {
  scale: 'RIR' | 'RPE';
  initial: number | null;
  onStore: (rir: number | null) => void;
}) {
  const [rir, setRir] = useState<number | null>(initial);
  return (
    <EffortScaleProvider scale={scale}>
      <EffortInput
        aria-label="effort"
        rir={rir}
        onRirChange={(next) => {
          onStore(next);
          setRir(next);
        }}
      />
      <button type="button" onClick={() => setRir(1)}>
        reset
      </button>
    </EffortScaleProvider>
  );
}

const field = () => screen.getByLabelText('effort') as HTMLInputElement;

describe('EffortInput', () => {
  it('shows and stores the RIR untouched on the RIR scale', () => {
    const onStore = vi.fn();
    render(<Harness scale="RIR" initial={2} onStore={onStore} />);
    expect(field().value).toBe('2');
    expect(field().min).toBe('0');
    expect(field().max).toBe('5');
    fireEvent.change(field(), { target: { value: '3' } });
    expect(onStore).toHaveBeenLastCalledWith(3);
    expect(field().value).toBe('3');
  });

  it('shows the RPE of the stored RIR and stores the RIR of the typed RPE', () => {
    const onStore = vi.fn();
    render(<Harness scale="RPE" initial={3} onStore={onStore} />);
    expect(field().value).toBe('7');
    expect(field().min).toBe('5');
    expect(field().max).toBe('10');
    fireEvent.change(field(), { target: { value: '8' } });
    expect(onStore).toHaveBeenLastCalledWith(2);
    expect(field().value).toBe('8');
  });

  it('does not rewrite the text while an RPE of 10 is being typed', () => {
    const onStore = vi.fn();
    render(<Harness scale="RPE" initial={2} onStore={onStore} />);
    // "1" is below the scale and clamps to the easiest RIR; the field must
    // keep showing what was typed so the following "0" lands on "10".
    fireEvent.change(field(), { target: { value: '1' } });
    expect(onStore).toHaveBeenLastCalledWith(5);
    expect(field().value).toBe('1');
    fireEvent.change(field(), { target: { value: '10' } });
    expect(onStore).toHaveBeenLastCalledWith(0);
    expect(field().value).toBe('10');
  });

  it('settles on the stored value when the field loses focus', () => {
    render(<Harness scale="RPE" initial={2} onStore={vi.fn()} />);
    fireEvent.change(field(), { target: { value: '1' } });
    fireEvent.blur(field());
    expect(field().value).toBe('5');
  });

  it('reports an empty field as no value', () => {
    const onStore = vi.fn();
    render(<Harness scale="RPE" initial={2} onStore={onStore} />);
    fireEvent.change(field(), { target: { value: '' } });
    expect(onStore).toHaveBeenLastCalledWith(null);
    expect(field().value).toBe('');
  });

  it('follows a value changed by the parent', () => {
    render(<Harness scale="RPE" initial={3} onStore={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(field().value).toBe('9');
  });
});
