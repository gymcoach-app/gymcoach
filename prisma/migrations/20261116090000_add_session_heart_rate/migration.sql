-- Heart rate of an attached watch recording on a session (issue #562).
-- Additive: three nullable columns, no existing row is rewritten.
-- AlterTable
ALTER TABLE "Session" ADD COLUMN "avgHr" INTEGER;
ALTER TABLE "Session" ADD COLUMN "maxHr" INTEGER;
ALTER TABLE "Session" ADD COLUMN "hrTrack" JSONB;
