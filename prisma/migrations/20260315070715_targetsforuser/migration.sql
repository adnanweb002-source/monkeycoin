-- CreateEnum
CREATE TYPE "public"."TargetMultiplier" AS ENUM ('X1', 'X2', 'X3', 'X4', 'X5', 'X7', 'X10');

-- CreateEnum
CREATE TYPE "public"."TargetSalesType" AS ENUM ('DIRECT', 'INDIRECT');

-- AlterTable
ALTER TABLE "public"."package_purchases" ADD COLUMN     "isTarget" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "lockWithdrawalsTillTarget" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "public"."TargetAssignment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "packageAmount" DECIMAL(18,2) NOT NULL,
    "multiplier" "public"."TargetMultiplier" NOT NULL,
    "salesType" "public"."TargetSalesType" NOT NULL,
    "targetAmount" DECIMAL(18,2) NOT NULL,
    "achieved" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetAssignment_userId_idx" ON "public"."TargetAssignment"("userId");

-- AddForeignKey
ALTER TABLE "public"."TargetAssignment" ADD CONSTRAINT "TargetAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TargetAssignment" ADD CONSTRAINT "TargetAssignment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "public"."package_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
