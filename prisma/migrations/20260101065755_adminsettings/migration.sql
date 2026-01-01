/*
  Warnings:

  - Changed the type of `key` on the `admin_settings` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "public"."SETTING_TYPE" AS ENUM ('TRANSFER_TYPE', 'BACK_OFFICE_CLOSING_TIME', 'BACK_OFFICE_OPENING_TIME', 'BINARY_INCOME_RATE', 'REFERRAL_INCOME_RATE');

-- AlterTable
ALTER TABLE "public"."admin_settings" DROP COLUMN "key",
ADD COLUMN     "key" "public"."SETTING_TYPE" NOT NULL;

-- CreateTable
CREATE TABLE "public"."BinaryPayoutLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "volumePaid" DECIMAL(65,30) NOT NULL,
    "payoutAmt" DECIMAL(65,30) NOT NULL,
    "leftBefore" DECIMAL(65,30) NOT NULL,
    "rightBefore" DECIMAL(65,30) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BinaryPayoutLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BinaryPayoutLog_userId_date_key" ON "public"."BinaryPayoutLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "admin_settings_key_key" ON "public"."admin_settings"("key");

-- AddForeignKey
ALTER TABLE "public"."BinaryPayoutLog" ADD CONSTRAINT "BinaryPayoutLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
