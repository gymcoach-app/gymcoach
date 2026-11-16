import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { programExerciseInputSchema } from '@/lib/schemas/program-exercise';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { isCardioExercise } from '@/lib/cardio-target';

interface Params {
  params: Promise<{ id: string }>;
}

// Ownership is enforced by scoping the writes themselves through the owning
// program (issue #317): a stranger's id makes Prisma throw P2025, which
// handleApiError maps to 404. No separate check to delete.

export async function PUT(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    // Scoped existence probe so a stranger gets 404 before any 400 about the
    // body; the update below carries the same scope, so this probe is about
    // the status code, not the security boundary.
    const owned = await db.programExercise.findFirst({
      where: { id: params.id, workout: { program: { userId } } },
      select: { id: true, workoutId: true, exerciseId: true, targetDurationSec: true },
    });
    if (!owned) throw new ApiError(404, 'Program exercise not found.');

    const data = await parseJsonBody(req, programExerciseInputSchema);

    const exercise = await db.exercise.findFirst({
      where: { id: data.exerciseId, userId },
    });
    if (!exercise) {
      throw new ApiError(400, 'Invalid exercise.');
    }

    // Cardio target (issue #558): only a CARDIO exercise is prescribed by
    // duration and distance. On any other exercise a target in the body is
    // refused, and a target the row carried is cleared (the row's exercise
    // was replaced by a strength one). On a cardio exercise an absent field
    // is left unchanged, null clears it, and a distance needs a duration:
    // the one sent, or the one already stored.
    const cardio = isCardioExercise(exercise);
    if (!cardio && (data.targetDurationSec != null || data.targetDistanceM != null)) {
      throw new ApiError(400, 'Only a cardio exercise takes a duration or distance target.');
    }
    const nextDurationSec =
      data.targetDurationSec !== undefined ? data.targetDurationSec : owned.targetDurationSec;
    if (cardio && data.targetDistanceM != null && nextDurationSec == null) {
      throw new ApiError(400, 'A distance target needs a duration target.');
    }
    // Clearing the duration clears the distance with it, so a stored row
    // never holds a distance without a duration.
    const clearDistance = cardio && data.targetDurationSec === null;

    // Replacing a row's exercise with one the workout already holds would
    // create the same duplicate POST refuses (issues #379, #426): the live
    // runner shares one set pool per exercise. Only a change of exercise is
    // checked, so a targets-only edit still saves, including on a row whose
    // workout already holds a duplicate from before this check.
    const duplicate =
      data.exerciseId !== owned.exerciseId &&
      (await db.programExercise.findFirst({
        where: { workoutId: owned.workoutId, exerciseId: data.exerciseId, id: { not: params.id } },
        select: { id: true },
      }));
    if (duplicate) {
      throw new ApiError(409, 'That exercise is already in this workout.');
    }

    const updated = await db.programExercise.update({
      where: { id: params.id, workout: { program: { userId } } },
      data: {
        exerciseId: data.exerciseId,
        targetSets: data.targetSets,
        targetRepsMin: data.targetRepsMin,
        targetRepsMax: data.targetRepsMax,
        targetRIR: data.targetRIR,
        restSec: data.restSec,
        autoregulationMode: data.autoregulationMode ?? undefined,
        fatigueRate: data.fatigueRate,
        loadAdjustmentPct: data.loadAdjustmentPct,
        tempo: data.tempo ?? null,
        notes: data.notes ?? null,
        // Superset pairing (issue #146): absent = leave unchanged (Prisma
        // skips undefined), null = unpair, number = (re)pair.
        supersetGroup: data.supersetGroup,
        targetDurationSec: cardio ? data.targetDurationSec : null,
        targetDistanceM: cardio ? (clearDistance ? null : data.targetDistanceM) : null,
      },
      include: { exercise: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    await db.programExercise.delete({
      where: { id: params.id, workout: { program: { userId } } },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
