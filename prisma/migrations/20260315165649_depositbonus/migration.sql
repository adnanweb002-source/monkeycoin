-- AlterEnum
ALTER TYPE "public"."TransactionType" ADD VALUE 'ADMIN_BONUS';

-- DropIndex
DROP INDEX "public"."TargetAssignment_userId_idx";

-- CreateTable
CREATE TABLE "public"."DepositBonus" (
    "id" SERIAL NOT NULL,
    "bonusPercentage" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositBonus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetAssignment_userId_completed_salesType_idx" ON "public"."TargetAssignment"("userId", "completed", "salesType");

-- CreateIndex
CREATE INDEX "package_purchases_isTarget_idx" ON "public"."package_purchases"("isTarget");

-- CreateIndex
CREATE INDEX "users_member_id_lockWithdrawalsTillTarget_idx" ON "public"."users"("member_id", "lockWithdrawalsTillTarget");
