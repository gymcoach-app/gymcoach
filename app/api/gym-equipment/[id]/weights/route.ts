import { NextResponse } from 'next/server';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { updateOwnedGymEquipmentWeights } from '@/lib/gym-equipment';
import { databaseIdSchema, gymEquipmentWeightsSchema } from '@/lib/schemas/gym-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

// Weights-only sub-resource of one owned item (#380). The in-session editor
// saves through this instead of the general upsert, so a save made from a
// page-load snapshot cannot revert a rename, a type change or an exercise the
// lifter had marked unavailable. The response carries the saved item and the
// exercises whose configs followed it (#471).
export async function PUT(req: Request, props: Params) {
  try {
    const userId = await requireApiUserId();
    const { id } = await props.params;
    const parsedId = databaseIdSchema.safeParse(id);
    if (!parsedId.success) throw new ApiError(400, 'Invalid equipment id.');
    const input = await parseJsonBody(req, gymEquipmentWeightsSchema);
    const result = await updateOwnedGymEquipmentWeights(userId, parsedId.data, input.weightOptions);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
