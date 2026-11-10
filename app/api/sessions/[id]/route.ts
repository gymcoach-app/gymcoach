import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessionDeleteQuerySchema, sessionUpdateSchema } from '@/lib/schemas/session';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';

interface Params {
  params: Promise<{ id: string }>;
}

// Ownership is enforced by scoping every query with userId (issue #317):
// the read that serves the response is itself the check, and the writes
// carry userId in their where, so a stranger's id yields 404 (null read or
// Prisma P2025 via handleApiError).

export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const session = await db.session.findFirst({
      where: { id: params.id, userId },
      include: {
        workout: {
          include: {
            exercises: {
              orderBy: { order: 'asc' },
              include: { exercise: true },
            },
          },
        },
        program: true,
        // The list of a freestyle session (issue #388); empty otherwise.
        exercises: { orderBy: { order: 'asc' }, include: { exercise: true } },
        sets: { orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }] },
      },
    });
    if (!session) throw new ApiError(404, 'Session not found.');
    return NextResponse.json(session);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const session = await db.session.findFirst({ where: { id: params.id, userId } });
    if (!session) throw new ApiError(404, 'Session not found.');
    const data = await parseJsonBody(req, sessionUpdateSchema);

    const updated = await db.session.update({
      where: { id: params.id, userId },
      data: {
        notes: data.notes ?? session.notes,
        finishedAt: data.finish ? new Date() : session.finishedAt,
      },
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE /api/sessions/[id]: deletes the session with its sets (the history
// "delete this session" action). With `?discardEmpty=1` it is the runner's
// "discard this empty session" instead (issue #388): only a session without
// any set is deleted, in one statement, so a set logged in between (another
// tab, the offline queue) is never lost to a stale screen.
export async function DELETE(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const query = sessionDeleteQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!query.success) throw new ApiError(400, 'Invalid query.');

    if (query.data.discardEmpty) {
      const removed = await db.session.deleteMany({
        where: { id: params.id, userId, sets: { none: {} } },
      });
      if (removed.count === 0) {
        const exists = await db.session.findFirst({
          where: { id: params.id, userId },
          select: { id: true },
        });
        if (!exists) throw new ApiError(404, 'Session not found.');
        throw new ApiError(409, 'This session has logged sets. Finish it or delete it from the history.');
      }
      return NextResponse.json({ ok: true });
    }

    await db.session.delete({ where: { id: params.id, userId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
