'use client';

import { createContext, useContext } from 'react';
import type { DistanceUnit } from '@/lib/cardio';

// The unit the user reads and types cardio distance in (issue #582), provided
// by the server page that resolved it from the profile with
// cardioDistanceUnit (lib/cardio). Without a provider a component shows
// kilometers, the unit every account used before the preference existed.
const DistanceUnitContext = createContext<DistanceUnit>('km');

export function DistanceUnitProvider({
  unit,
  children,
}: {
  unit: DistanceUnit;
  children: React.ReactNode;
}) {
  return <DistanceUnitContext.Provider value={unit}>{children}</DistanceUnitContext.Provider>;
}

export function useDistanceUnit(): DistanceUnit {
  return useContext(DistanceUnitContext);
}
