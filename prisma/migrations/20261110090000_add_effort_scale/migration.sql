-- Effort scale preference (issue #390). Additive: existing users keep RIR.
-- CreateEnum
CREATE TYPE "EffortScale" AS ENUM ('RIR', 'RPE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "effortScale" "EffortScale" NOT NULL DEFAULT 'RIR';
