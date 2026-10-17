import { Buffer } from 'node:buffer';
import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { getExerciseMedia } from '@/lib/exercise-media';
import { itemStackAppliesToExercise, itemStackStopsApplying } from '@/lib/gym-loads';
import type { EquipmentType } from '@/lib/prisma-client';

export const GYM_EQUIPMENT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type GymEquipmentImageMimeType = (typeof GYM_EQUIPMENT_IMAGE_MIME_TYPES)[number];
export const MAX_GYM_EQUIPMENT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_GYM_EQUIPMENT_PER_GYM = 1000;

export interface UpsertGymEquipmentInput {
  equipmentId?: string;
  name: string;
  equipmentType: EquipmentType;
  description?: string | null;
  manufacturer?: string | null;
  modelName?: string | null;
  quantity?: number;
  weightOptions?: number[];
  exerciseIds?: string[];
  markExercisesAvailable?: boolean;
}

export interface SetGymEquipmentImageInput {
  clear?: boolean;
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: GymEquipmentImageMimeType;
}

const equipmentSelection = {
  id: true,
  gymId: true,
  name: true,
  equipmentType: true,
  description: true,
  manufacturer: true,
  modelName: true,
  quantity: true,
  weightOptions: true,
  imageUrl: true,
  imageMimeType: true,
  createdAt: true,
  updatedAt: true,
  exerciseLinks: {
    orderBy: { exercise: { name: 'asc' as const } },
    include: {
      exercise: {
        select: {
          id: true,
          name: true,
          muscleGroup: true,
          category: true,
          equipmentType: true,
        },
      },
    },
  },
} as const;

export async function listOwnedGyms(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { activeGymId: true },
  });
  const gyms = await db.gym.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      _count: { select: { equipment: true, exerciseConfigs: true, sessions: true } },
    },
  });
  return {
    activeGymId: user?.activeGymId ?? null,
    gyms: gyms.map((gym) => ({ ...gym, isActive: gym.id === user?.activeGymId })),
  };
}

export async function getOwnedGymInventory(
  userId: string,
  baseUrl: string,
  gymId?: string,
  options: { includeExerciseCoverage?: boolean } = {},
) {
  const gym = await resolveOwnedGym(userId, gymId);
  const details = await db.gym.findUnique({
    where: { id: gym.id },
    include: { equipment: { orderBy: { name: 'asc' }, select: equipmentSelection } },
  });
  if (!details) throw new ApiError(404, 'Gym not found.');

  // Per-exercise coverage lists every exercise of the trainee with media URLs,
  // an unbounded payload, so it is computed only when the caller asks for it.
  const exerciseCoverage = options.includeExerciseCoverage
    ? await buildGymExerciseCoverage(userId, baseUrl, details)
    : undefined;

  return {
    gym: {
      id: details.id,
      name: details.name,
      sharedFreeWeights: {
        dumbbellWeightsKg: details.dumbbellWeights,
        plateWeightsKg: details.plateWeights,
        barWeightsKg: details.barWeights,
      },
      equipment: details.equipment.map((item) => ({
        ...item,
        image: gymEquipmentImageRef(item),
        exerciseLinks: item.exerciseLinks.map((link) => link.exercise),
      })),
      ...(exerciseCoverage ? { exerciseCoverage } : {}),
      updatedAt: details.updatedAt,
    },
    workflow: {
      comparePhotosAndNarrationAgainst: ['gym.equipment', 'gym.sharedFreeWeights'],
      addPhysicalItemWith: 'upsert_gym_equipment',
      updateSharedWeightsWith: 'update_gym_free_weights',
      attachImageWith: 'set_gym_equipment_image',
      readEquipmentImageWith: 'get_gym_equipment_image',
      note: 'Physical equipment and exercises are separate records; link equipment to exercise IDs so machine/cable load options constrain program design. Uploaded equipment images carry no URL: read them with get_gym_equipment_image.',
    },
  };
}

async function buildGymExerciseCoverage(
  userId: string,
  baseUrl: string,
  gym: {
    id: string;
    equipment: Array<{ id: string; exerciseLinks: Array<{ exerciseId: string }> }>;
  },
) {
  const [configs, exercises] = await Promise.all([
    db.gymExerciseConfig.findMany({
      where: { gymId: gym.id },
      select: { exerciseId: true, isAvailable: true, weightOptions: true },
    }),
    db.exercise.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        muscleGroup: true,
        category: true,
        equipmentType: true,
        usesBodyweight: true,
        notes: true,
      },
    }),
  ]);

  const configByExercise = new Map(configs.map((config) => [config.exerciseId, config]));
  const equipmentIdsByExercise = new Map<string, string[]>();
  for (const item of gym.equipment) {
    for (const link of item.exerciseLinks) {
      const ids = equipmentIdsByExercise.get(link.exerciseId) ?? [];
      ids.push(item.id);
      equipmentIdsByExercise.set(link.exerciseId, ids);
    }
  }

  return exercises.map((exercise) => {
    const config = configByExercise.get(exercise.id);
    const media = getExerciseMedia(exercise.name);
    return {
      ...exercise,
      configured: config != null,
      isAvailable: config?.isAvailable ?? true,
      weightOptionsKg: config?.weightOptions ?? [],
      equipmentIds: equipmentIdsByExercise.get(exercise.id) ?? [],
      builtInMedia: media
        ? {
            frames: media.frames.map((frame) => new URL(frame, baseUrl).toString()),
            approximate: media.approximate,
            source: media.source,
          }
        : null,
    };
  });
}

export async function updateOwnedGymFreeWeights(
  userId: string,
  gymId: string | undefined,
  patch: {
    dumbbellWeights?: number[];
    plateWeights?: number[];
    barWeights?: number[];
  },
) {
  const gym = await resolveOwnedGym(userId, gymId);
  if (
    patch.dumbbellWeights === undefined &&
    patch.plateWeights === undefined &&
    patch.barWeights === undefined
  ) {
    throw new ApiError(400, 'Provide at least one free-weight inventory list.');
  }
  // The update replaces whole lists, so hand back what was there before: the
  // caller can show the change or restore it.
  const previous = await db.gym.findUniqueOrThrow({
    where: { id: gym.id },
    select: { dumbbellWeights: true, plateWeights: true, barWeights: true },
  });
  const updated = await db.gym.update({
    where: { id: gym.id },
    data: patch,
    select: {
      id: true,
      name: true,
      dumbbellWeights: true,
      plateWeights: true,
      barWeights: true,
      updatedAt: true,
    },
  });
  return { gym: updated, previous };
}

// The item an upsert with this input would overwrite, or null when it would
// create one. Mirrors the target resolution of upsertOwnedGymEquipment (by id
// inside the gym, else by case-insensitive name) so an agent-driven overwrite
// can report the values it replaced.
export async function findOwnedGymEquipmentUpsertTarget(
  userId: string,
  gymId: string,
  input: Pick<UpsertGymEquipmentInput, 'equipmentId' | 'name'>,
) {
  await requireOwnedGym(userId, gymId);
  const target = await db.gymEquipment.findFirst({
    where: input.equipmentId
      ? { id: input.equipmentId, gymId }
      : { gymId, name: { equals: input.name, mode: 'insensitive' } },
    select: {
      id: true,
      name: true,
      equipmentType: true,
      description: true,
      manufacturer: true,
      modelName: true,
      quantity: true,
      weightOptions: true,
      exerciseLinks: { select: { exerciseId: true } },
    },
  });
  if (!target) return null;
  const { exerciseLinks, ...fields } = target;
  return { ...fields, exerciseIds: exerciseLinks.map((link) => link.exerciseId) };
}

export async function listOwnedGymEquipment(userId: string, gymId: string) {
  await requireOwnedGym(userId, gymId);
  const equipment = await db.gymEquipment.findMany({
    where: { gymId },
    orderBy: { name: 'asc' },
    select: equipmentSelection,
  });
  return equipment.map((item) => ({
    ...item,
    image: item.imageMimeType
      ? {
          kind: 'uploaded' as const,
          url: `/api/gym-equipment/${item.id}/image?v=${item.updatedAt.getTime()}`,
          mimeType: item.imageMimeType,
        }
      : item.imageUrl
        ? { kind: 'external' as const, url: item.imageUrl, mimeType: null }
        : null,
    exerciseLinks: item.exerciseLinks.map((link) => link.exercise),
  }));
}

export async function upsertOwnedGymEquipment(
  userId: string,
  gymId: string,
  input: UpsertGymEquipmentInput,
) {
  await requireOwnedGym(userId, gymId);
  const requestedExerciseIds = input.exerciseIds ? [...new Set(input.exerciseIds)] : undefined;
  const current = input.equipmentId
    ? await db.gymEquipment.findFirst({
        where: { id: input.equipmentId, gymId },
        select: {
          id: true,
          equipmentType: true,
          weightOptions: true,
          exerciseLinks: { select: { exerciseId: true } },
        },
      })
    : await db.gymEquipment.findFirst({
        where: { gymId, name: { equals: input.name, mode: 'insensitive' } },
        select: {
          id: true,
          equipmentType: true,
          weightOptions: true,
          exerciseLinks: { select: { exerciseId: true } },
        },
      });
  if (input.equipmentId && !current) throw new ApiError(404, 'Gym equipment not found.');
  const created = current == null;

  const exerciseIds =
    requestedExerciseIds ?? current?.exerciseLinks.map((link) => link.exerciseId) ?? [];
  const exercises = exerciseIds.length
    ? await db.exercise.findMany({
        where: { userId, id: { in: exerciseIds } },
        select: { id: true, name: true, equipmentType: true },
      })
    : [];
  if (exercises.length !== exerciseIds.length) {
    throw new ApiError(400, 'One or more exercise IDs do not belong to the trainee.');
  }

  const equipmentTypeChanged = current != null && current.equipmentType !== input.equipmentType;
  const shouldSyncExerciseConfigs =
    requestedExerciseIds !== undefined || input.weightOptions !== undefined || equipmentTypeChanged;
  const effectiveWeightOptions = input.weightOptions ?? current?.weightOptions ?? [];

  const item = await db.$transaction(async (tx) => {
    if (created) {
      // Serialize creations per gym so concurrent requests cannot both observe
      // the same pre-limit count and exceed MAX_GYM_EQUIPMENT_PER_GYM.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${gymId}))`;
      const equipmentCount = await tx.gymEquipment.count({ where: { gymId } });
      if (equipmentCount >= MAX_GYM_EQUIPMENT_PER_GYM) {
        throw new ApiError(
          400,
          'A gym can contain at most ' + MAX_GYM_EQUIPMENT_PER_GYM + ' physical equipment items.',
        );
      }
    }

    const saved = current
      ? await tx.gymEquipment.update({
          where: { id: current.id },
          data: {
            name: input.name,
            equipmentType: input.equipmentType,
            description: input.description,
            manufacturer: input.manufacturer,
            modelName: input.modelName,
            quantity: input.quantity,
            weightOptions: input.weightOptions,
          },
        })
      : await tx.gymEquipment.create({
          data: {
            gymId,
            name: input.name,
            equipmentType: input.equipmentType,
            description: input.description,
            manufacturer: input.manufacturer,
            modelName: input.modelName,
            quantity: input.quantity ?? 1,
            weightOptions: input.weightOptions ?? [],
          },
        });

    if (requestedExerciseIds !== undefined) {
      await tx.gymEquipmentExercise.deleteMany({ where: { equipmentId: saved.id } });
      if (requestedExerciseIds.length > 0) {
        await tx.gymEquipmentExercise.createMany({
          data: requestedExerciseIds.map((exerciseId) => ({ equipmentId: saved.id, exerciseId })),
        });
      }
    }

    // Keep the already-accepted GymExerciseConfig model in sync as a compatibility
    // projection. Later equipment-first workout code can use the physical item
    // directly, while current upstream screens immediately see linked exercises
    // as available and retain their machine/cable load options.
    if (input.markExercisesAvailable !== false && shouldSyncExerciseConfigs) {
      for (const exercise of exercises) {
        // The item's stack is copied onto the exercise only when the two are
        // compatible, and it is cleared only when a stack that applied under
        // the item's previous type stops applying. An OTHER exercise linked to
        // a machine or cable item therefore keeps its own load options, even
        // across an item type change that never applied to it (#386).
        const useItemWeights = itemStackAppliesToExercise(
          exercise.equipmentType,
          input.equipmentType,
        );
        const clearInheritedWeights = itemStackStopsApplying(
          exercise.equipmentType,
          current?.equipmentType,
          input.equipmentType,
        );
        await tx.gymExerciseConfig.upsert({
          where: { gymId_exerciseId: { gymId, exerciseId: exercise.id } },
          update: {
            isAvailable: true,
            ...(useItemWeights
              ? { weightOptions: effectiveWeightOptions }
              : clearInheritedWeights
                ? { weightOptions: [] }
                : {}),
          },
          create: {
            gymId,
            exerciseId: exercise.id,
            isAvailable: true,
            weightOptions: useItemWeights ? effectiveWeightOptions : [],
          },
        });
      }
    }
    return saved;
  });

  const saved = await db.gymEquipment.findUnique({
    where: { id: item.id },
    select: equipmentSelection,
  });
  if (!saved) throw new ApiError(500, 'Gym equipment could not be read after saving.');

  const mismatchedExercises = exercises
    .filter(
      (exercise) =>
        exercise.equipmentType !== 'OTHER' &&
        input.equipmentType !== 'OTHER' &&
        exercise.equipmentType !== input.equipmentType,
    )
    .map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      exerciseEquipmentType: exercise.equipmentType,
    }));

  return { equipment: saved, mismatchedExercises, created };
}

// Weights-only update for one owned item (#380). The in-session editor knows
// the weights the lifter typed but not the item's current name or type, and it
// must not touch availability: saving a weight list should not re-enable
// exercises the lifter had marked unavailable, nor overwrite a rename or a
// type change made since the page loaded. This path therefore writes
// `weightOptions` and nothing else, and it follows the item's stack onto the
// linked exercise configs only where the stack already applies to them.
//
// The ownership check, the item's type and its links are read inside the same
// transaction as the writes, so a concurrent type change cannot be paired with
// a stale read. The result names the exercises whose configs were updated, so
// a caller can show exactly what a reload would show (#471).
export async function updateOwnedGymEquipmentWeights(
  userId: string,
  equipmentId: string,
  weightOptions: number[],
) {
  return db.$transaction(async (tx) => {
    const equipment = await tx.gymEquipment.findFirst({
      where: { id: equipmentId, gym: { userId } },
      select: {
        id: true,
        gymId: true,
        equipmentType: true,
        exerciseLinks: { select: { exercise: { select: { id: true, equipmentType: true } } } },
      },
    });
    if (!equipment) throw new ApiError(404, 'Gym equipment not found.');

    const saved = await tx.gymEquipment.update({
      where: { id: equipment.id },
      data: { weightOptions },
      select: equipmentSelection,
    });

    const updatedExerciseIds: string[] = [];
    for (const link of equipment.exerciseLinks) {
      // A config the lifter never had is not created here: creating one would
      // set isAvailable, which is exactly the surprise #380 is about.
      if (!itemStackAppliesToExercise(link.exercise.equipmentType, equipment.equipmentType)) {
        continue;
      }
      const { count } = await tx.gymExerciseConfig.updateMany({
        where: { gymId: equipment.gymId, exerciseId: link.exercise.id },
        data: { weightOptions },
      });
      if (count > 0) updatedExerciseIds.push(link.exercise.id);
    }
    return { equipment: saved, updatedExerciseIds };
  });
}

export async function deleteOwnedGymEquipment(userId: string, equipmentId: string) {
  const equipment = await requireOwnedEquipment(userId, equipmentId);
  await db.gymEquipment.delete({ where: { id: equipment.id } });
}

export async function getOwnedGymEquipmentImage(userId: string, equipmentId: string) {
  const equipment = await db.gymEquipment.findFirst({
    where: { id: equipmentId, gym: { userId } },
    select: {
      id: true,
      imageUrl: true,
      imageData: true,
      imageMimeType: true,
      updatedAt: true,
    },
  });
  if (!equipment) throw new ApiError(404, 'Gym equipment not found.');

  if (equipment.imageData && equipment.imageMimeType) {
    if (
      !GYM_EQUIPMENT_IMAGE_MIME_TYPES.includes(equipment.imageMimeType as GymEquipmentImageMimeType)
    ) {
      throw new ApiError(500, 'Gym equipment image has an unsupported MIME type.');
    }
    return {
      kind: 'uploaded' as const,
      bytes: Buffer.from(equipment.imageData),
      mimeType: equipment.imageMimeType as GymEquipmentImageMimeType,
      updatedAt: equipment.updatedAt,
    };
  }
  if (equipment.imageUrl) {
    return { kind: 'external' as const, url: equipment.imageUrl, updatedAt: equipment.updatedAt };
  }
  throw new ApiError(404, 'Gym equipment image not found.');
}

export async function setOwnedGymEquipmentImage(
  userId: string,
  equipmentId: string,
  input: SetGymEquipmentImageInput,
) {
  const equipment = await requireOwnedEquipment(userId, equipmentId);
  const modes = [input.clear === true, input.imageUrl != null, input.imageBase64 != null].filter(
    Boolean,
  ).length;
  if (modes !== 1) {
    throw new ApiError(400, 'Choose exactly one image action: clear, imageUrl, or imageBase64.');
  }

  // `!= null`, like the mode count above: an empty string is a (bad) upload, and
  // decodeGymEquipmentImage rejects it with a 400 instead of leaving `decoded`
  // null for the branch below.
  const decoded =
    input.imageBase64 != null ? decodeGymEquipmentImage(input.imageBase64, input.mimeType) : null;

  const data = input.clear
    ? { imageUrl: null, imageData: null, imageMimeType: null }
    : decoded
      ? { imageUrl: null, imageData: decoded.bytes, imageMimeType: decoded.mimeType }
      : { imageUrl: input.imageUrl, imageData: null, imageMimeType: null };

  return db.gymEquipment.update({
    where: { id: equipment.id },
    data,
    select: {
      id: true,
      gymId: true,
      name: true,
      imageUrl: true,
      imageMimeType: true,
      updatedAt: true,
    },
  });
}

export function decodeGymEquipmentImage(
  raw: string,
  declaredMimeType?: GymEquipmentImageMimeType,
): { bytes: Uint8Array<ArrayBuffer>; mimeType: GymEquipmentImageMimeType } {
  const dataUrl = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(raw.trim());
  const mimeType = (dataUrl?.[1] ?? declaredMimeType) as GymEquipmentImageMimeType | undefined;
  if (!mimeType || !GYM_EQUIPMENT_IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new ApiError(400, 'Uploaded equipment image must be JPEG, PNG, or WebP.');
  }
  if (dataUrl && declaredMimeType && dataUrl[1] !== declaredMimeType) {
    throw new ApiError(400, 'The declared image MIME type does not match the data URL.');
  }

  const base64 = (dataUrl?.[2] ?? raw).replace(/\s/g, '');
  if (base64.length > Math.ceil((MAX_GYM_EQUIPMENT_IMAGE_BYTES * 4) / 3) + 16) {
    throw new ApiError(400, 'Uploaded equipment image is larger than 5 MB.');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new ApiError(400, 'Invalid base64 image data.');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw new ApiError(400, 'Uploaded equipment image is empty.');
  if (buffer.length > MAX_GYM_EQUIPMENT_IMAGE_BYTES) {
    throw new ApiError(400, 'Uploaded equipment image is larger than 5 MB.');
  }
  if (!matchesImageSignature(buffer, mimeType)) {
    throw new ApiError(400, 'Uploaded bytes do not match the declared image type.');
  }
  const bytes = new Uint8Array(new ArrayBuffer(buffer.length));
  bytes.set(buffer);
  return { bytes, mimeType };
}

async function resolveOwnedGym(userId: string, gymId?: string) {
  const resolvedId =
    gymId ??
    (
      await db.user.findUnique({
        where: { id: userId },
        select: { activeGymId: true },
      })
    )?.activeGymId;
  if (!resolvedId) {
    throw new ApiError(400, 'No active gym. Provide gymId or activate a gym first.');
  }
  const gym = await db.gym.findFirst({
    where: { id: resolvedId, userId },
    select: { id: true, name: true },
  });
  if (!gym) throw new ApiError(404, 'Gym not found.');
  return gym;
}

// How MCP results describe an item's image. Uploaded bytes are served to the web
// app by a cookie-authenticated route an MCP client cannot fetch, so no URL is
// advertised for them: the client reads them with get_gym_equipment_image.
export function gymEquipmentImageRef(item: {
  imageUrl: string | null;
  imageMimeType: string | null;
  updatedAt: Date;
}) {
  if (item.imageMimeType) {
    return {
      kind: 'uploaded' as const,
      mimeType: item.imageMimeType,
      updatedAt: item.updatedAt,
      readWith: 'get_gym_equipment_image' as const,
    };
  }
  return item.imageUrl ? { kind: 'external' as const, url: item.imageUrl, mimeType: null } : null;
}

async function requireOwnedGym(userId: string, gymId: string) {
  const gym = await db.gym.findFirst({ where: { id: gymId, userId }, select: { id: true } });
  if (!gym) throw new ApiError(404, 'Gym not found.');
  return gym;
}

async function requireOwnedEquipment(userId: string, equipmentId: string) {
  const equipment = await db.gymEquipment.findFirst({
    where: { id: equipmentId, gym: { userId } },
    select: { id: true, gymId: true },
  });
  if (!equipment) throw new ApiError(404, 'Gym equipment not found.');
  return equipment;
}

function matchesImageSignature(buffer: Buffer, mimeType: GymEquipmentImageMimeType): boolean {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}
