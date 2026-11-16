-- Cardio target of a programmed exercise (issue #558, slice 1): additive only.
-- Nullable columns without a default are a metadata-only change, so existing
-- rows read NULL (no cardio target) and no reader of the strength columns
-- changes.
-- Rollback: ALTER TABLE "ProgramExercise" DROP COLUMN "targetDurationSec", DROP COLUMN "targetDistanceM";

-- AlterTable
ALTER TABLE "ProgramExercise" ADD COLUMN "targetDurationSec" INTEGER;
ALTER TABLE "ProgramExercise" ADD COLUMN "targetDistanceM" DOUBLE PRECISION;
