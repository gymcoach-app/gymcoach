import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  ApiError,
  handleApiError,
  readJsonWithCap,
  requireApiUserId,
  SMALL_JSON_BODY_MAX_BYTES,
} from '@/lib/api';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/programs/[id]/activate
// Activates this program and deactivates all the others for this user.
// Optional body: { active: boolean } (default true). If active=false,
// we simply deactivate this program (no auto-activation of another one).
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    // Ownership lives in the query scope itself (issue #317): the read and
    // both writes carry userId, so none survives the removal of the others.
    const program = await db.program.findFirst({ where: { id: params.id, userId } });
    if (!program) {
      throw new ApiError(404, 'Program not found.');
    }

    // A missing or invalid body means the default; an oversized one is a 413.
    const body = (await readJsonWithCap(req, SMALL_JSON_BODY_MAX_BYTES).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 413) throw err;
      return {};
    })) as { active?: boolean } | null;
    const active = body?.active !== false;

    if (active) {
      await db.$transaction([
        db.program.updateMany({
          where: { userId, isActive: true, id: { not: params.id } },
          data: { isActive: false },
        }),
        db.program.update({ where: { id: params.id, userId }, data: { isActive: true } }),
      ]);
    } else {
      await db.program.update({ where: { id: params.id, userId }, data: { isActive: false } });
    }

    const updated = await db.program.findFirst({ where: { id: params.id, userId } });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
