import { z } from 'zod';

// Bounds of a bodyweight value in kg. They match the profile route's
// bodyweight field (20-300 kg): an entry syncs into User.bodyweight, so it
// must never accept a value the profile would reject (issue #107). Shared by
// the REST entry schema and the MCP user-properties tool (issue #478).
export const BODYWEIGHT_MIN_KG = 20;
export const BODYWEIGHT_MAX_KG = 300;

export const bodyweightKgSchema = z
  .number()
  .min(BODYWEIGHT_MIN_KG, 'Too low')
  .max(BODYWEIGHT_MAX_KG, 'Too high');

// Bodyweight entry input (issue #99). The weight arrives in kg (the client
// converts from the display unit before posting, like the set form).
export const bodyweightEntryInputSchema = z.object({
  weightKg: z.coerce.number().min(BODYWEIGHT_MIN_KG).max(BODYWEIGHT_MAX_KG),
  note: z.string().max(500).optional(),
});

export type BodyweightEntryInput = z.infer<typeof bodyweightEntryInputSchema>;
