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

  it('stores nothing for the "1" typed on the way to RPE 10', () => {
    const onStore = vi.fn();
    render(<Harness scale="RPE" initial={2} onStore={onStore} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: '1' } });
    // Below the scale: not clamped to a RIR, not stored, shown as invalid.
    expect(onStore).not.toHaveBeenCalled();
    expect(field().value).toBe('1');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(field(), { target: { value: '10' } });
    expect(onStore).toHaveBeenLastCalledWith(0);
    expect(field().value).toBe('10');
    expect(field()).not.toHaveAttribute('aria-invalid');
  });

  it.each([
    ['RPE', '4'],
    ['RPE', '11'],
    ['RPE', '8.5'],
    ['RIR', '6'],
    ['RIR', '-1'],
    ['RIR', '2.5'],
  ] as const)('treats %s %s as invalid instead of clamping or rounding it', (scale, typed) => {
    const onStore = vi.fn();
    const onInvalid = vi.fn();
    render(
      <EffortScaleProvider scale={scale}>
        <EffortInput aria-label="effort" rir={2} onRirChange={onStore} onInvalidEntry={onInvalid} />
      </EffortScaleProvider>,
    );
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: typed } });
    expect(onStore).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(field().value).toBe(typed);
    expect(field()).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the stored value again when an invalid entry loses the focus', () => {
    const onStore = vi.fn();
    render(<Harness scale="RPE" initial={2} onStore={onStore} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: '4' } });
    fireEvent.blur(field());
    expect(field().value).toBe('8');
    expect(field()).not.toHaveAttribute('aria-invalid');
    expect(onStore).not.toHaveBeenCalled();
  });

  it('is not rewritten by the parent while it has the focus', () => {
    // A parent that answers an emptied field with a value of its own (the
    // regression behind "108"): the text stays what the user typed.
    function Stubborn({ onStore }: { onStore: (rir: number) => void }) {
      const [rir, setRir] = useState(2);
      return (
        <EffortScaleProvider scale="RPE">
          <EffortInput
            aria-label="effort"
            rir={rir}
            onRirChange={(next) => {
              const stored = next ?? 0;
              onStore(stored);
              setRir(stored);
            }}
          />
        </EffortScaleProvider>
      );
    }
    const onStore = vi.fn();
    render(<Stubborn onStore={onStore} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: '' } });
    expect(field().value).toBe('');
    fireEvent.change(field(), { target: { value: '8' } });
    expect(field().value).toBe('8');
    expect(onStore).toHaveBeenLastCalledWith(2);
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

  it('keeps an invalid entry visible on blur when there is no stored value', () => {
    render(<Harness scale="RIR" initial={null} onStore={vi.fn()} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: '9' } });
    fireEvent.blur(field());
    expect(field().value).toBe('9');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
  });
});
