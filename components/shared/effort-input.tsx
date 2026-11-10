'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useEffortScale } from '@/components/shared/effort-scale-provider';
import { effortRange, effortToRir, effortValue } from '@/lib/effort';
import { cn } from '@/lib/utils';

type InputProps = Omit<
  React.ComponentProps<typeof Input>,
  'value' | 'onChange' | 'type' | 'min' | 'max'
>;

interface Props extends InputProps {
  // The stored effort target, always a RIR; null when there is none.
  rir: number | null;
  // Called with the RIR to store for a valid entry, or null when the field was
  // emptied. Never called for an entry that is not a whole number on the scale.
  onRirChange: (rir: number | null) => void;
  // Called when the entry is not empty and not a whole number on the scale
  // (RPE 4, RIR 7, 2.5, or the "1" typed on the way to "10"). Nothing is
  // emitted for it, so a parent that does not listen keeps its last value.
  onInvalidEntry?: () => void;
}

// A number field for an effort target (issue #390). The user reads and types
// on their own scale (RIR or RPE); the parent only ever sees the stored RIR,
// so an RPE can never be saved as if it were a RIR. The typed text is local
// state and is never rewritten while the field has the focus: the parent's
// value comes back on blur, or when it changes while the field is idle.
export function EffortInput({
  rir,
  onRirChange,
  onInvalidEntry,
  onFocus,
  onBlur,
  className,
  ...inputProps
}: Props) {
  const scale = useEffortScale();
  const { min, max } = effortRange(scale);
  const shown = rir == null ? '' : String(effortValue(scale, rir));
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  const [syncedRir, setSyncedRir] = useState(rir);

  // A whole number on the scale gives its RIR; anything else is invalid. No
  // clamping and no rounding: the field never stores a number it does not show.
  const parse = (raw: string): number | 'empty' | 'invalid' => {
    if (raw.trim() === '') return 'empty';
    const entered = Number(raw);
    if (!Number.isInteger(entered) || entered < min || entered > max) return 'invalid';
    return effortToRir(scale, entered);
  };

  // The parent changed the value (a reset, another row's data) while the field
  // was idle: show it. While focused the text belongs to the user.
  if (rir !== syncedRir) {
    setSyncedRir(rir);
    if (!focused) setText(shown);
  }

  const invalid = parse(text) === 'invalid';

  return (
    <Input
      {...inputProps}
      aria-invalid={invalid || inputProps['aria-invalid'] || undefined}
      className={cn(invalid && 'border-destructive', className)}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const parsed = parse(raw);
        if (parsed === 'invalid') onInvalidEntry?.();
        else onRirChange(parsed === 'empty' ? null : parsed);
      }}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        // Settle on the stored value when there is one; with none, what was
        // typed stays so an invalid entry remains visible.
        if (rir != null) setText(shown);
        onBlur?.(e);
      }}
    />
  );
}
