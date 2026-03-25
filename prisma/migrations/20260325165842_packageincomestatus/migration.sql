-- CreateEnum
CREATE TYPE "public"."PackageIncomeStatus" AS ENUM ('PENDING', 'CREDITED');

-- AlterTable
ALTER TABLE "public"."package_income_logs" ADD COLUMN     "status" "public"."PackageIncomeStatus" NOT NULL DEFAULT 'CREDITED';
