import { z } from 'zod';
import { EquipmentType } from '@/lib/prisma-client';
import { GYM_EQUIPMENT_IMAGE_MIME_TYPES } from '@/lib/gym-equipment';
import { gymWeightListSchema } from '@/lib/schemas/gym';

export const databaseIdSchema = z.string().trim().min(1).max(191);

export const gymEquipmentUpsertSchema = z.object({
  equipmentId: databaseIdSchema.optional(),
  name: z.string().trim().min(1).max(120),
  equipmentType: z.nativeEnum(EquipmentType),
  description: z.string().trim().max(4000).nullable().optional(),
  manufacturer: z.string().trim().max(120).nullable().optional(),
  modelName: z.string().trim().max(120).nullable().optional(),
  quantity: z.number().int().min(1).max(100).optional(),
  weightOptions: gymWeightListSchema.optional(),
  exerciseIds: z.array(databaseIdSchema).max(100).optional(),
  markExercisesAvailable: z.boolean().optional(),
});

const maximumBase64Length = 7_100_000;
// Weights-only update (#380): the narrow body the in-session editor sends, so a
// save cannot carry a stale name or type and cannot flip availability.
export const gymEquipmentWeightsSchema = z.object({
  weightOptions: gymWeightListSchema,
});

export const gymEquipmentImageSchema = z
  .object({
    imageUrl: z.string().trim().url().max(2048).startsWith('https://').optional(),
    imageBase64: z.string().max(maximumBase64Length).optional(),
    mimeType: z.enum(GYM_EQUIPMENT_IMAGE_MIME_TYPES).optional(),
  })
  .refine((value) => Number(value.imageUrl != null) + Number(value.imageBase64 != null) === 1, {
    message: 'Choose exactly one image source.',
  })
  .refine((value) => value.imageBase64 == null || value.mimeType != null, {
    message: 'Uploaded images require a MIME type.',
  });

export type GymEquipmentUpsertInput = z.infer<typeof gymEquipmentUpsertSchema>;
export type GymEquipmentImageInput = z.infer<typeof gymEquipmentImageSchema>;
