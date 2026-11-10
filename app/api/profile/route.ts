import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { profileUpdateSchema } from '@/lib/schemas/profile';

const PROFILE_SELECT = {
  email: true,
  displayName: true,
  bodyweight: true,
  bodyweightGoalKg: true,
  sex: true,
  heightCm: true,
  goal: true,
  weeklyFrequency: true,
  coachNote: true,
  unit: true,
  effortScale: true,
} as const;

export async function GET() {
  try {
    const userId = await requireApiUserId();
    const user = await db.user.findUnique({
      where: { id: userId },
      select: PROFILE_SELECT,
    });
    return NextResponse.json(user);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await requireApiUserId();
    const data = await parseJsonBody(req, profileUpdateSchema);
    const updated = await db.user.update({
      where: { id: userId },
      data: {
        ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
        ...(data.bodyweight !== undefined ? { bodyweight: data.bodyweight } : {}),
        ...(data.bodyweightGoalKg !== undefined
          ? { bodyweightGoalKg: data.bodyweightGoalKg }
          : {}),
        ...(data.sex !== undefined ? { sex: data.sex } : {}),
        ...(data.heightCm !== undefined ? { heightCm: data.heightCm } : {}),
        ...(data.goal !== undefined ? { goal: data.goal } : {}),
        ...(data.weeklyFrequency !== undefined
          ? { weeklyFrequency: data.weeklyFrequency }
          : {}),
        // Empty after trim -> store null (a clear), not an empty-string note.
        ...(data.coachNote !== undefined
          ? { coachNote: data.coachNote ? data.coachNote : null }
          : {}),
        ...(data.unit !== undefined ? { unit: data.unit } : {}),
        ...(data.effortScale !== undefined ? { effortScale: data.effortScale } : {}),
      },
      select: PROFILE_SELECT,
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
