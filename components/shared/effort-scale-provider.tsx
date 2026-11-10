'use client';

import { createContext, useContext } from 'react';
import type { EffortScale } from '@/lib/prisma-client';

// The user's effort scale (issue #390), provided by the server page that read
// it from the profile. Without a provider a component shows RIR, the stored
// form and the default for every account.
const EffortScaleContext = createContext<EffortScale>('RIR');

export function EffortScaleProvider({
  scale,
  children,
}: {
  scale: EffortScale;
  children: React.ReactNode;
}) {
  return <EffortScaleContext.Provider value={scale}>{children}</EffortScaleContext.Provider>;
}

export function useEffortScale(): EffortScale {
  return useContext(EffortScaleContext);
}
