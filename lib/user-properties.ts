import { recordBodyweightEntry } from '@/lib/bodyweight-record';

// User-specific profile properties writable by external agents. Only the
// current bodyweight is supported today. Keeping the dispatch in one place
// means the MCP tool path does not need to change when another property is
// added; advertise a property to the LLM only once it is supported here.
export interface UserPropertiesUpdate {
  currentWeightKg?: number;
}

export interface UpdatedUserProperty {
  currentWeightKg: number;
  // User.bodyweight before this update (null when it was never set), so the
  // agent can report the change, like update_gym_free_weights does.
  previousWeightKg: number | null;
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
    const { entry, previousBodyweightKg } = await recordBodyweightEntry(userId, {
      weightKg: update.currentWeightKg,
    });
    return {
      currentWeightKg: entry.weightKg,
      previousWeightKg: previousBodyweightKg,
      entry: {
        id: entry.id,
        weightKg: entry.weightKg,
        measuredAt: entry.measuredAt,
      },
    };
  }

  throw new Error('Provide at least one property to update: currentWeightKg.');
}
