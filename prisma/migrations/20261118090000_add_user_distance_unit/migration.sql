-- Distance unit preference of a user (issue #582, part 3): additive only. A
-- nullable column without a default is a metadata-only change, so existing
-- rows read NULL, which means "automatic": the distance unit follows the
-- weight unit (LB reads miles, KG kilometers). Cardio distance stays stored in
-- meters; nothing is converted.
-- Rollback: ALTER TABLE "User" DROP COLUMN "distanceUnit"; DROP TYPE "DistanceUnitPreference";

-- CreateEnum
CREATE TYPE "DistanceUnitPreference" AS ENUM ('KM', 'MI');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "distanceUnit" "DistanceUnitPreference";
