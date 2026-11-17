-- Heart rate of a set, read from the watch file attached to its session
-- (issue #576, part 1): additive only. Nullable columns without a default are
-- a metadata-only change, so existing rows read NULL (no watch heart rate) and
-- no reader of "avgHr" / "maxHr" (the heart rate logged on a cardio set)
-- changes.
-- Rollback: ALTER TABLE "Set" DROP COLUMN "watchAvgHr", DROP COLUMN "watchMaxHr";

-- AlterTable
ALTER TABLE "Set" ADD COLUMN "watchAvgHr" INTEGER;
ALTER TABLE "Set" ADD COLUMN "watchMaxHr" INTEGER;
