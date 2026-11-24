import { NextResponse } from 'next/server';
import { Prisma } from '@/prisma/generated/client';
import { db } from '@/lib/db';
import {
  sessionDeleteQuerySchema,
  sessionTimingSchema,
  sessionUpdateSchema,
} from '@/lib/schemas/session';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { resolveFinishedAt } from '@/lib/session-finish';
import { rateLimit } from '@/lib/rate-limit';
import { endsInFuture, resolveEditedWindow, retimeSets } from '@/lib/session-edit';
import {
  lockExerciseGoal,
  lockOwnedSession,
  runSerializableSetTransaction,
  shiftGoalAchievementForMove,
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
    // #571, lib/session-finish.ts).
    //
    // Only an UNFINISHED session is finished (issue #389). `finish: true` on
    // a session that already is one succeeds and changes nothing, so a stale
    // tab cannot overwrite a duration corrected in the history editor; and a
    // notes-only body never writes finishedAt at all, so it cannot undo a
    // move that ran in between. The `finishedAt: null` in the where makes the
    // first of two concurrent finishes the one that counts.
    if (data.finish && !session.finishedAt) {
      const lastSet = await db.set.findFirst({
        where: { sessionId: session.id, session: { userId } },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
      });
      await db.session.updateMany({
        where: { id: params.id, userId, finishedAt: null },
        data: {
          finishedAt: resolveFinishedAt({
            now: new Date(),
            startedAt: session.startedAt,
            lastSetAt: lastSet?.completedAt ?? null,
          }),
        },
      });
    }

    const updated = await db.session.update({
      where: { id: params.id, userId },
      data: { notes: data.notes ?? session.notes },
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

// A session moves all its sets in one statement. Past this many the request
// is refused: no session logged or imported by the app comes close.
const MAX_RETIMED_SETS = 2000;

// A move rewrites every set of the session, so it gets its own budget: far
// above what a person correcting dates needs.
const TIMING_EDITS_PER_MINUTE = 60;

// PATCH /api/sessions/[id]: corrects when a FINISHED session took place (issue
// #389): its start (date and time) and/or its duration; the body carries only
// what changed. A session in progress is refused, its clock is the live
// runner's.
//
// The sets move with the session (lib/session-edit.ts), because everything
// derived reads their timestamps: a session moved to last month must leave
// this week's charts and stop being the "last performance" of its exercises.
// The one stored record, the date a goal was achieved, follows the sets
// (shiftGoalAchievementForMove).
//
// Locks, in the order every amend write uses: the session row, its sets, the
// goals of its exercises.
export async function PATCH(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const rl = rateLimit(`session-timing:${userId}`, TIMING_EDITS_PER_MINUTE, 60_000);
    if (!rl.ok) {
      throw new ApiError(429, `Too many date changes. Retry in ${rl.retryAfterSec}s.`);
    }
    const data = await parseJsonBody(req, sessionTimingSchema);

    const updated = await runSerializableSetTransaction(
      async (tx) => {
        const session = await lockOwnedSession(tx, userId, params.id);
        if (!session) throw new ApiError(404, 'Session not found.');
        if (!session.finishedAt) {
          throw new ApiError(409, 'This session is still in progress.');
        }

        const window = resolveEditedWindow({
          startedAt: session.startedAt,
          finishedAt: session.finishedAt,
          newStartedAt: data.startedAt,
          newDurationMin: data.durationMin,
        });
        if (endsInFuture(window.finishedAt, new Date())) {
          throw new ApiError(400, 'A session cannot be in the future.');
        }

        await tx.$queryRaw`SELECT "Set".id FROM "Set" JOIN "Session" ON "Session".id = "Set"."sessionId" WHERE "Set"."sessionId" = ${session.id} AND "Session"."userId" = ${userId} FOR UPDATE OF "Set"`;
        // Every set query below carries the session's userId as well.
        const ownSets = { sessionId: session.id, session: { userId } };
        const sets = await tx.set.findMany({
          where: ownSets,
          take: MAX_RETIMED_SETS + 1,
          select: {
            id: true,
            exerciseId: true,
            weight: true,
            reps: true,
            isWarmup: true,
            completedAt: true,
          },
        });
        if (sets.length > MAX_RETIMED_SETS) {
          throw new ApiError(400, 'This session has too many sets to be moved.');
        }
        const { changes, rescaled } = retimeSets({
          oldStartedAt: session.startedAt,
          newStartedAt: window.startedAt,
          newFinishedAt: window.finishedAt,
          sets,
        });

        const exerciseIds = [...new Set(sets.map((set) => set.exerciseId))].sort();
        for (const exerciseId of exerciseIds) {
          await lockExerciseGoal(tx, userId, exerciseId);
        }
        const row = await tx.session.update({
          where: { id: session.id, userId },
          data: window,
        });
        if (changes.length > 0) {
          // One statement for every set. The instants travel as epoch
          // milliseconds, so no driver or session time zone can shift them.
          // Scoped by the owner in the statement itself (issue #317), not
          // only by the reads above.
          const rows = changes.map(
            (change) =>
              Prisma.sql`(${change.id}::text, ${change.completedAt.getTime()}::double precision)`,
          );
          await tx.$executeRaw(
            Prisma.sql`UPDATE "Set" AS s SET "completedAt" = to_timestamp(v.ms / 1000.0) AT TIME ZONE 'UTC' FROM (VALUES ${Prisma.join(rows)}) AS v(id, ms) WHERE s.id = v.id AND s."sessionId" = ${session.id} AND EXISTS (SELECT 1 FROM "Session" x WHERE x.id = s."sessionId" AND x."userId" = ${userId})`,
          );
        }
        if (rescaled) {
          // The per-set heart rate of an attached watch file was cut between
          // the old set timestamps (issue #576). The recording's start is not
          // stored, so it cannot be cut again: drop it rather than show numbers
          // that no longer match the sets. The session curve and its average
          // and peak do not depend on the sets and stay.
          await tx.set.updateMany({
            where: {
              ...ownSets,
              OR: [{ watchAvgHr: { not: null } }, { watchMaxHr: { not: null } }],
            },
            data: { watchAvgHr: null, watchMaxHr: null },
          });
        }
        if (changes.length > 0) {
          const movedTo = new Map(changes.map((change) => [change.id, change.completedAt]));
          for (const exerciseId of exerciseIds) {
            const moved = sets.flatMap((set) => {
              const to = movedTo.get(set.id);
              return set.exerciseId === exerciseId && to
                ? [
                    {
                      weight: set.weight,
                      reps: set.reps,
                      isWarmup: set.isWarmup,
                      from: set.completedAt,
                      to,
                    },
                  ]
                : [];
            });
            await shiftGoalAchievementForMove(tx, userId, exerciseId, moved);
          }
        }
        return row;
      },
      { timeoutMs: 15_000 },
    );

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
      // Under the session's row lock (issue #389): a set being added at this
      // very moment either committed before the lock was granted, and is
      // counted here, or comes after, and finds no session. Without the lock
      // the delete could cascade a set away between its check and its end.
      // Read committed on purpose, so the count sees what was committed
      // while this transaction waited for the lock.
      await db.$transaction(async (tx) => {
        const session = await lockOwnedSession(tx, userId, params.id);
        if (!session) throw new ApiError(404, 'Session not found.');
        const sets = await tx.set.count({ where: { sessionId: session.id, session: { userId } } });
        if (sets > 0) {
          throw new ApiError(
            409,
            'This session has logged sets. Finish it or delete it from the history.',
          );
        }
        await tx.session.delete({ where: { id: session.id, userId } });
      });
      return NextResponse.json({ ok: true });
    }

    await db.session.delete({ where: { id: params.id, userId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
