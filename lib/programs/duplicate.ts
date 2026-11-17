import { db } from '@/lib/db';
import { ApiError } from '@/lib/api';
import { programExerciseCopyData, workoutRowsFromSession } from '@/lib/programs/copy';

// Program, workout and session copies (issue #394). Each runs in one
// transaction and every read is scoped to the owner, so a stranger's id is a
// 404 and nothing is half-written. The copies write their rows directly, not
// through the hand-edit routes: a workout that repeats an exercise on purpose
// (5/3/1 Boring But Big, issue #429) is copied as it is, never refused or
// deduplicated by the duplicate-exercise checks of #425 and #427.

export async function duplicateProgram(userId: string, programId: string, name: string) {
  return db.$transaction(async (tx) => {
    const source = await tx.program.findFirst({
      where: { id: programId, userId },
      include: {
        workouts: {
          orderBy: { order: 'asc' },
          include: { exercises: { orderBy: { order: 'asc' } } },
        },
      },
    });
    if (!source) throw new ApiError(404, 'Program not found.');

    // A copy starts inactive: activating it stays a deliberate choice.
    const program = await tx.program.create({
      data: {
        userId,
        name,
        phase: source.phase,
        description: source.description,
        // The copy starts now, so the source's end date would no longer fit.
        endDate: null,
        isActive: false,
      },
    });
    for (const workout of source.workouts) {
      const copy = await tx.workout.create({
        data: {
          programId: program.id,
          name: workout.name,
          dayOfWeek: workout.dayOfWeek,
          order: workout.order,
        },
      });
      if (workout.exercises.length > 0) {
        await tx.programExercise.createMany({
          data: workout.exercises.map((pe) => ({
            ...programExerciseCopyData(pe),
            workoutId: copy.id,
          })),
        });
      }
    }
    return program;
  });
}

export async function duplicateWorkout(userId: string, workoutId: string, name: string) {
  return db.$transaction(async (tx) => {
    const source = await tx.workout.findFirst({
      where: { id: workoutId, program: { userId } },
      include: { exercises: { orderBy: { order: 'asc' } } },
    });
    if (!source) throw new ApiError(404, 'Session not found.');

    const last = await tx.workout.findFirst({
      where: { programId: source.programId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const workout = await tx.workout.create({
      data: {
        programId: source.programId,
        name,
        dayOfWeek: source.dayOfWeek,
        order: (last?.order ?? 0) + 1,
      },
    });
    if (source.exercises.length > 0) {
      await tx.programExercise.createMany({
        data: source.exercises.map((pe) => ({
          ...programExerciseCopyData(pe),
          workoutId: workout.id,
        })),
      });
    }
    return workout;
  });
}

export async function saveSessionAsWorkout(
  userId: string,
  sessionId: string,
  input: { programId: string; name: string; dayOfWeek: number | null },
) {
  return db.$transaction(async (tx) => {
    const session = await tx.session.findFirst({
      where: { id: sessionId, userId },
      include: {
        sets: {
          select: {
            exerciseId: true,
            reps: true,
            rir: true,
            isWarmup: true,
            isDropSet: true,
            completedAt: true,
            setNumber: true,
            exercise: { select: { defaultRestSec: true } },
          },
        },
        workout: {
          select: {
            exercises: {
              orderBy: { order: 'asc' },
              select: {
                exerciseId: true,
                restSec: true,
                tempo: true,
                notes: true,
                autoregulationMode: true,
                fatigueRate: true,
                loadAdjustmentPct: true,
                targetDurationSec: true,
                targetDistanceM: true,
              },
            },
          },
        },
      },
    });
    if (!session) throw new ApiError(404, 'Session not found.');
    if (session.finishedAt == null) {
      throw new ApiError(400, 'Only a finished session can be saved as a workout.');
    }

    const program = await tx.program.findFirst({
      where: { id: input.programId, userId },
      select: { id: true },
    });
    if (!program) throw new ApiError(404, 'Program not found.');

    const defaultRest = new Map(session.sets.map((s) => [s.exerciseId, s.exercise.defaultRestSec]));
    const rows = workoutRowsFromSession(
      session.sets,
      defaultRest,
      session.workout?.exercises ?? [],
    );
    if (rows.length === 0) {
      throw new ApiError(400, 'This session has no working sets to save.');
    }

    const last = await tx.workout.findFirst({
      where: { programId: program.id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const workout = await tx.workout.create({
      data: {
        programId: program.id,
        name: input.name,
        dayOfWeek: input.dayOfWeek,
        order: (last?.order ?? 0) + 1,
      },
    });
    await tx.programExercise.createMany({
      data: rows.map((row) => ({ ...row, workoutId: workout.id })),
    });
    return workout;
  });
}
