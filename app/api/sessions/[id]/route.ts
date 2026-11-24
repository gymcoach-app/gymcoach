import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  sessionDeleteQuerySchema,
  sessionTimingSchema,
  sessionUpdateSchema,
} from '@/lib/schemas/session';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { resolveFinishedAt } from '@/lib/session-finish';
import { endsInFuture, resolveEditedFinish, retimeSets } from '@/lib/session-edit';
import {
  lockExerciseGoal,
  rederiveGoalAchievement,
  runSerializableSetTransaction,
} from '@/lib/goal-achievement';

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

    // A late Finish ends the session at its last set, not at the tap (issue
    // #571, lib/session-finish.ts). As before, every `finish: true` stamps the
    // session again, including one sent for an already finished session.
    let finishedAt = session.finishedAt;
    if (data.finish) {
      const lastSet = await db.set.findFirst({
        where: { sessionId: session.id, session: { userId } },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });
      finishedAt = resolveFinishedAt({
        now: new Date(),
        startedAt: session.startedAt,
        lastSetAt: lastSet?.completedAt ?? null,
      });
    }

    const updated = await db.session.update({
      where: { id: params.id, userId },
      data: {
        notes: data.notes ?? session.notes,
        finishedAt,
      },
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

// PATCH /api/sessions/[id]: corrects when a FINISHED session took place (issue
// #389): its start (date and time) and its duration. A session in progress is
// refused, its clock is the live runner's.
//
// The sets move with the session (lib/session-edit.ts), because everything
// derived reads their timestamps: a session moved to last month must leave
// this week's charts and stop being the "last performance" of its exercises.
// The one stored record, a goal's achievedAt, is re-derived in the same
// transaction.
export async function PATCH(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const data = await parseJsonBody(req, sessionTimingSchema);

    const updated = await runSerializableSetTransaction(async (tx) => {
      const session = await tx.session.findFirst({
        where: { id: params.id, userId },
        select: { id: true, startedAt: true, finishedAt: true },
      });
      if (!session) throw new ApiError(404, 'Session not found.');
      if (!session.finishedAt) {
        throw new ApiError(409, 'This session is still in progress.');
      }

      const finishedAt = resolveEditedFinish({
        oldStartedAt: session.startedAt,
        oldFinishedAt: session.finishedAt,
        newStartedAt: data.startedAt,
        durationMin: data.durationMin,
      });
      if (endsInFuture(finishedAt, new Date())) {
        throw new ApiError(400, 'A session cannot be in the future.');
      }

      // Every set query below carries the session's userId as well.
      const ownSets = { sessionId: session.id, session: { userId } };
      const sets = await tx.set.findMany({
        where: ownSets,
        select: { id: true, exerciseId: true, completedAt: true },
      });
      const { changes, rescaled } = retimeSets({
        oldStartedAt: session.startedAt,
        newStartedAt: data.startedAt,
        newFinishedAt: finishedAt,
        sets,
      });

      const exerciseIds = [...new Set(sets.map((set) => set.exerciseId))].sort();
      for (const exerciseId of exerciseIds) {
        await lockExerciseGoal(tx, userId, exerciseId);
      }
      const row = await tx.session.update({
        where: { id: session.id, userId },
        data: { startedAt: data.startedAt, finishedAt },
      });
      for (const change of changes) {
        await tx.set.updateMany({
          where: { ...ownSets, id: change.id },
          data: { completedAt: change.completedAt },
        });
      }
      if (rescaled) {
        // The per-set heart rate of an attached watch file was cut between
        // the old set timestamps (issue #576). The recording's start is not
        // stored, so it cannot be cut again: drop it rather than show numbers
        // that no longer match the sets. The session curve and its average
        // and peak do not depend on the sets and stay.
        await tx.set.updateMany({
          where: { ...ownSets, OR: [{ watchAvgHr: { not: null } }, { watchMaxHr: { not: null } }] },
          data: { watchAvgHr: null, watchMaxHr: null },
        });
      }
      if (changes.length > 0) {
        for (const exerciseId of exerciseIds) {
          await rederiveGoalAchievement(tx, userId, exerciseId, true);
        }
      }
      return row;
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
