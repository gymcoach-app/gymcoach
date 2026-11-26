-- Cardio intensity target of a programmed exercise (issue #558, slice 2):
-- additive only. Nullable columns without a default are a metadata-only
-- change, so existing rows read NULL (no intensity target) and no reader of
-- the other columns changes.
-- Rollback: ALTER TABLE "ProgramExercise" DROP COLUMN "targetRpe", DROP COLUMN "targetHrMin", DROP COLUMN "targetHrMax";

-- AlterTable
ALTER TABLE "ProgramExercise" ADD COLUMN "targetRpe" INTEGER;
ALTER TABLE "ProgramExercise" ADD COLUMN "targetHrMin" INTEGER;
ALTER TABLE "ProgramExercise" ADD COLUMN "targetHrMax" INTEGER;
