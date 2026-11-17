import { db } from '@/lib/db';
import { getLlmProvider, LlmError } from '@/lib/llm';
import { PROGRAM_GEN_SYSTEM_PROMPT } from '@/lib/prompts/program-system-prompt';
import {
  parseGeneratedProgram,
  type GeneratedProgram,
  type GeneratedWorkout,
} from '@/lib/schemas/program-generation';
import { defaultIntraSetConfig } from '@/lib/intra-set-autoregulation';
import type { Prisma } from '@/lib/prisma-client';

// Generates a structured program draft from a natural-language goal. Does not
// persist anything: the result is previewed (and edited) before saving.
export async function generateProgram(userId: string, goal: string): Promise<GeneratedProgram> {
  const provider = getLlmProvider();

  const [user, exercises] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        sex: true,
        heightCm: true,
        bodyweight: true,
        goal: true,
        weeklyFrequency: true,
      },
    }),
    db.exercise.findMany({
      where: { userId },
      select: { name: true, muscleGroup: true, category: true, equipmentType: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const context = {
    profile: {
      sex: user?.sex ?? null,
      heightCm: user?.heightCm ?? null,
      bodyweight: user?.bodyweight ?? null,
      goal: user?.goal ?? null,
      weeklyFrequency: user?.weeklyFrequency ?? null,
    },
    availableExercises: exercises,
  };

  const userMessage = `User goal:\n${goal}\n\nContext (JSON):\n${JSON.stringify(context, null, 2)}`;

  const { text } = await provider.complete({
    system: PROGRAM_GEN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 8000,
  });

  const parsed = parseGeneratedProgram(text);
  if (!parsed.ok) {
    throw new LlmError(
      502,
      `The generated program could not be parsed: ${parsed.error}`,
      'model',
    );
  }
  return parsed.program;
}

// Persists a (possibly user-edited) generated program in a single transaction.
// New exercises are created on the fly; existing ones are reused by name.
// Returns the new program id. The program is created inactive.
export async function buildProgramFromGenerated(
  userId: string,
  program: GeneratedProgram,
): Promise<string> {
  return db.$transaction(async (tx) => {
    const created = await tx.program.create({
      data: {
        userId,
        name: program.name,
        description: program.description ?? null,
        phase: program.phase,
        isActive: false,
      },
    });

    let workoutOrder = 1;
    for (const w of program.workouts) {
      await createGeneratedWorkout(tx, userId, created.id, w, workoutOrder++);
    }

    return created.id;
  });
}

// Appends one generated workout to an EXISTING program the user owns, after
// its current last workout. Same exercise reuse and cardio rules as a full
// build. Returns the new workout id. Throws when the program is not the
// user's (or does not exist) so a caller cannot write into someone else's
// program by guessing an id.
export async function addWorkoutToProgram(
  userId: string,
  programId: string,
  workout: GeneratedWorkout,
): Promise<string> {
  return db.$transaction(async (tx) => {
    const program = await tx.program.findFirst({
      where: { id: programId, userId },
      select: { id: true },
    });
    if (!program) throw new Error('Program not found.');

    const last = await tx.workout.findFirst({
      where: { programId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    return createGeneratedWorkout(tx, userId, programId, workout, (last?.order ?? 0) + 1);
  });
}

// Persists one workout and its exercises inside an open transaction. New
// exercises are created on the fly; existing ones are reused by name.
async function createGeneratedWorkout(
  tx: Prisma.TransactionClient,
  userId: string,
  programId: string,
  w: GeneratedWorkout,
  order: number,
): Promise<string> {
  const workout = await tx.workout.create({
    data: {
      programId,
      name: w.name,
      dayOfWeek: w.dayOfWeek ?? null,
      order,
    },
  });

  let exerciseOrder = 1;
  for (const ex of w.exercises) {
    const exercise = await tx.exercise.upsert({
      where: { userId_name: { userId, name: ex.name } },
      update: {},
      create: {
        userId,
        name: ex.name,
        muscleGroup: ex.muscleGroup,
        // A CARDIO machine is always logged as cardio (duration/distance),
        // whatever category the model picked.
        category: ex.equipmentType === 'CARDIO' ? 'CARDIO' : ex.category,
        equipmentType: ex.equipmentType ?? 'OTHER',
        defaultRestSec: ex.restSec,
      },
    });

    const autoregDefaults = defaultIntraSetConfig(exercise);
    await tx.programExercise.create({
      data: {
        workoutId: workout.id,
        exerciseId: exercise.id,
        order: exerciseOrder++,
        targetSets: ex.targetSets,
        targetRepsMin: ex.targetRepsMin,
        targetRepsMax: Math.max(ex.targetRepsMax, ex.targetRepsMin),
        targetRIR: ex.targetRIR,
        restSec: ex.restSec,
        autoregulationMode: ex.autoregulationMode ?? 'PRESERVE_RIR',
        fatigueRate: ex.fatigueRate ?? autoregDefaults.fatigueRate,
        loadAdjustmentPct: ex.loadAdjustmentPct ?? autoregDefaults.loadAdjustmentPct,
        tempo: ex.tempo ?? null,
        notes: ex.notes ?? null,
        supersetGroup: ex.supersetGroup ?? null,
      },
    });
  }

  return workout.id;
}
