// Effort scale presentation (issue #390). Effort is always stored as RIR
// (reps in reserve) on the set; RPE (rate of perceived exertion) is a display
// and input form of the same number: RPE = 10 - RIR. Nothing here changes what
// is stored, sent to the coach or exposed over MCP.

import type { EffortScale } from '@/lib/prisma-client';
import { rpeToRir } from '@/lib/set-shorthand';

export const EFFORT_SCALES = ['RIR', 'RPE'] as const satisfies readonly EffortScale[];

export function rirToRpe(rir: number): number {
  return 10 - rir;
}

// RPE to the stored RIR, rounded to the nearest integer and clamped to the
// accepted range. One implementation, shared with the shorthand parser.
export { rpeToRir };

// The number shown for a stored RIR on the given scale.
export function effortValue(scale: EffortScale, rir: number): number {
  return scale === 'RPE' ? rirToRpe(rir) : rir;
}

// The stored RIR for a number entered on the given scale.
export function effortToRir(scale: EffortScale, value: number): number {
  return scale === 'RPE' ? rpeToRir(value) : value;
}

// A bare cell value: the number on the user's scale, or a dash when the set
// has no effort recorded.
export function formatEffortValue(scale: EffortScale, rir: number | null | undefined): string {
  return rir == null ? '-' : String(effortValue(scale, rir));
}

// "RIR 2" or "RPE 8". The acronyms are not translated in any catalog.
export function formatEffort(scale: EffortScale, rir: number): string {
  return `${scale} ${effortValue(scale, rir)}`;
}

// The selectable RIR values in the order they read on the scale. Both scales
// count upwards on screen, so the RPE options run from the easiest stored RIR
// down to 0 (RPE 10).
export function effortOptions(scale: EffortScale, rirOptions: readonly number[]): number[] {
  const ascending = [...rirOptions].sort((a, b) => a - b);
  return scale === 'RPE' ? ascending.reverse() : ascending;
}

export type EffortTone = 'max' | 'hard' | 'moderate' | 'easy';

// Colour band of an effort level, the same on both scales because it is keyed
// on the stored RIR: 0 is an all-out set, 3 or more leaves plenty in the tank.
export function effortTone(rir: number): EffortTone {
  if (rir <= 0) return 'max';
  if (rir === 1) return 'hard';
  if (rir === 2) return 'moderate';
  return 'easy';
}
