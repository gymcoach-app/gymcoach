import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { programExerciseInputSchema } from '@/lib/schemas/program-exercise';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { defaultIntraSetConfig } from '@/lib/intra-set-autoregulation';
import { isCardioExercise } from '@/lib/cardio-target';

interface Params {
  params: Promise<{ id: string }>;
}

// POST /api/workouts/[id]/program-exercises: adds an exercise (with its targets)
// to a workout. The order is computed automatically.
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    // Scoped reads (issue #317): ownership is part of each query, not a
    // separate comparison that a later edit could drop.
    const workout = await db.workout.findFirst({
      where: { id: params.id, program: { userId } },
    });
    if (!workout) {
      throw new ApiError(404, 'Session not found.');
    }

    const data = await parseJsonBody(req, programExerciseInputSchema);

    // The exercise must belong to the user too.
    const exercise = await db.exercise.findFirst({
      where: { id: data.exerciseId, userId },
    });
    if (!exercise) {
      throw new ApiError(400, 'Invalid exercise.');
    }

    // Cardio target (issue #558): only a CARDIO exercise is prescribed by
    // duration and distance, and a distance needs a duration next to it.
    const hasTargetInput = data.targetDurationSec != null || data.targetDistanceM != null;
    if (hasTargetInput && !isCardioExercise(exercise)) {
      throw new ApiError(400, 'Only a cardio exercise takes a duration or distance target.');
    }
    if (data.targetDistanceM != null && data.targetDurationSec == null) {
      throw new ApiError(400, 'A distance target needs a duration target.');
    }
    // Intensity (slice 2): a target RPE and a heart rate range, same rules.
    // The schema guarantees the two heart rate bounds come together, in order.
    const hasIntensityInput =
      data.targetRpe != null || data.targetHrMin != null || data.targetHrMax != null;
    if (hasIntensityInput && !isCardioExercise(exercise)) {
      throw new ApiError(400, 'Only a cardio exercise takes an RPE or heart rate target.');
    }
    if (hasIntensityInput && data.targetDurationSec == null) {
      throw new ApiError(400, 'An RPE or heart rate target needs a duration target.');
    }

    // Refuse an exercise the workout already contains (issue #379). The
    // in-session menu and the program editor hide exercises already in the
    // workout (#426), but that is a client-side guard only, so a double submit
    // or a direct API call used to add a second row for the same exercise. A
    // Set carries only an exerciseId (no ProgramExercise reference), so the
    // live runner shares one set pool between the two rows and each reads the
    // other's sets. Enforced here so the API matches what the UI prevents.
    const duplicate = await db.programExercise.findFirst({
      where: { workoutId: params.id, exerciseId: data.exerciseId },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError(409, 'That exercise is already in this workout.');
    }

    const last = await db.programExercise.findFirst({
      where: { workoutId: params.id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = (last?.order ?? 0) + 1;
    const autoregulationDefaults = defaultIntraSetConfig(exercise);

    const created = await db.programExercise.create({
      data: {
        workoutId: params.id,
        exerciseId: data.exerciseId,
        order: nextOrder,
        targetSets: data.targetSets,
        targetRepsMin: data.targetRepsMin,
        targetRepsMax: data.targetRepsMax,
        targetRIR: data.targetRIR,
        restSec: data.restSec,
        autoregulationMode: data.autoregulationMode ?? 'PRESERVE_RIR',
        fatigueRate: data.fatigueRate ?? autoregulationDefaults.fatigueRate,
        loadAdjustmentPct: data.loadAdjustmentPct ?? autoregulationDefaults.loadAdjustmentPct,
        tempo: data.tempo ?? null,
        notes: data.notes ?? null,
        // Superset pairing (issue #146): optional at creation, null = standalone.
        supersetGroup: data.supersetGroup ?? null,
        targetDurationSec: data.targetDurationSec ?? null,
        targetDistanceM: data.targetDistanceM ?? null,
        targetRpe: data.targetRpe ?? null,
        targetHrMin: data.targetHrMin ?? null,
        targetHrMax: data.targetHrMax ?? null,
      },
      include: { exercise: true },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
