import { recordBodyweightEntry } from '@/lib/bodyweight-record';

// User-specific profile properties writable by external agents. Only the
// current bodyweight is supported today; goal weight and the body-measurement
// sites are intended additions. Keeping the dispatch in one place means the
// MCP tool path does not need to change when another property is added.
export interface UserPropertiesUpdate {
  currentWeightKg?: number;
}

export interface UpdatedUserProperty {
  currentWeightKg: number;
  entry: {
    id: string;
    weightKg: number;
    measuredAt: Date;
  };
}

export async function updateUserProperties(
  userId: string,
  update: UserPropertiesUpdate,
): Promise<UpdatedUserProperty> {
  if (update.currentWeightKg !== undefined) {
    const entry = await recordBodyweightEntry(userId, { weightKg: update.currentWeightKg });
    return {
      currentWeightKg: entry.weightKg,
      entry: {
        id: entry.id,
        weightKg: entry.weightKg,
        measuredAt: entry.measuredAt,
      },
    };
  }

  throw new Error('Provide at least one property to update: currentWeightKg.');
}
