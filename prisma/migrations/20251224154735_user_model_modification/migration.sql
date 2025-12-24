/*
  Warnings:

  - You are about to drop the column `username` on the `users` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."users_username_key";

-- AlterTable
ALTER TABLE "public"."users" DROP COLUMN "username",
ADD COLUMN     "country" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "first_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "last_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "phone_number" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "public"."packages" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "investment_min" DECIMAL(65,30) NOT NULL,
    "investment_max" DECIMAL(65,30) NOT NULL,
    "daily_return_pct" DECIMAL(65,30) NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "capital_return" DECIMAL(65,30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."package_purchases" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "packageId" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "lastCreditedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_purchases_userId_idx" ON "public"."package_purchases"("userId");

-- AddForeignKey
ALTER TABLE "public"."package_purchases" ADD CONSTRAINT "package_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."package_purchases" ADD CONSTRAINT "package_purchases_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "public"."packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
