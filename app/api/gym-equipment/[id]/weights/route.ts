import { NextResponse } from 'next/server';
import { handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { updateOwnedGymEquipmentWeights } from '@/lib/gym-equipment';
import { gymEquipmentWeightsSchema } from '@/lib/schemas/gym-equipment';

interface Params {
  params: Promise<{ id: string }>;
}

// Weights-only sub-resource of one owned item (#380). The in-session editor
// saves through this instead of the general upsert, so a save made from a
// page-load snapshot cannot revert a rename, a type change or an exercise the
// lifter had marked unavailable.
export async function PUT(req: Request, props: Params) {
  try {
    const userId = await requireApiUserId();
    const { id } = await props.params;
    const input = await parseJsonBody(req, gymEquipmentWeightsSchema);
    const equipment = await updateOwnedGymEquipmentWeights(userId, id, input.weightOptions);
    return NextResponse.json({ equipment });
  } catch (err) {
    return handleApiError(err);
  }
}
