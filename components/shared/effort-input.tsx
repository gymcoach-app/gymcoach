'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useEffortScale } from '@/components/shared/effort-scale-provider';
import { effortToRir, effortValue } from '@/lib/effort';

type InputProps = Omit<
  React.ComponentProps<typeof Input>,
  'value' | 'onChange' | 'type' | 'min' | 'max'
>;

interface Props extends InputProps {
  // The stored effort target, always a RIR; null when the field is empty.
  rir: number | null;
  // Called with the RIR to store for what was typed, or null for an empty or
  // unreadable field.
  onRirChange: (rir: number | null) => void;
}

// A number field for an effort target (issue #390). The user reads and types
// on their own scale (RIR or RPE); the parent only ever sees the stored RIR,
// so an RPE can never be saved as if it were a RIR. The typed text is kept
// locally because the conversion clamps: on the way to "10" an RPE user types
// "1", which already maps to a RIR, and the field must not jump under them.
export function EffortInput({ rir, onRirChange, onBlur, ...inputProps }: Props) {
  const scale = useEffortScale();
  const shown = rir == null ? '' : String(effortValue(scale, rir));
  const [text, setText] = useState(shown);
  const [syncedRir, setSyncedRir] = useState(rir);

  const parse = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const entered = Number(raw);
    return Number.isFinite(entered) ? effortToRir(scale, entered) : null;
  };

  // The parent changed the value (a reset, another row's data): show it,
  // unless it is simply the RIR of what is being typed.
  if (rir !== syncedRir) {
    setSyncedRir(rir);
    if (parse(text) !== rir) setText(shown);
  }

  return (
    <Input
      {...inputProps}
      type="number"
      inputMode="numeric"
      min={scale === 'RPE' ? 5 : 0}
      max={scale === 'RPE' ? 10 : 5}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onRirChange(parse(e.target.value));
      }}
      onBlur={(e) => {
        setText(shown);
        onBlur?.(e);
      }}
    />
  );
}
