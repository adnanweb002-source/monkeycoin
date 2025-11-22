/*
  Warnings:

  - Added the required column `g2faSecret` to the `users` table without a default value. This is not possible if the table is not empty.
  - Added the required column `isG2faEnabled` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."WalletType" AS ENUM ('F_WALLET', 'I_WALLET', 'M_WALLET', 'BONUS_WALLET');

-- CreateEnum
CREATE TYPE "public"."TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAW', 'TRANSFER_IN', 'TRANSFER_OUT', 'PACKAGE_PURCHASE', 'BINARY_INCOME', 'DIRECT_INCOME', 'ROI_CREDIT', 'RANK_REWARD', 'ADJUSTMENT');

-- AlterEnum
ALTER TYPE "public"."Status" ADD VALUE 'SUSPENDED';

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "g2faSecret" TEXT NOT NULL,
ADD COLUMN     "isG2faEnabled" BOOLEAN NOT NULL;

-- CreateTable
CREATE TABLE "public"."wallets" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "public"."WalletType" NOT NULL,
    "balance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."wallet_transactions" (
    "id" SERIAL NOT NULL,
    "walletId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "public"."TransactionType" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "direction" TEXT NOT NULL,
    "purpose" TEXT,
    "balance_after" DECIMAL(65,30) NOT NULL,
    "tx_no" TEXT NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_type_key" ON "public"."wallets"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_tx_no_key" ON "public"."wallet_transactions"("tx_no");

-- CreateIndex
CREATE INDEX "wallet_transactions_userId_idx" ON "public"."wallet_transactions"("userId");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_idx" ON "public"."wallet_transactions"("walletId");

-- AddForeignKey
ALTER TABLE "public"."wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wallet_transactions" ADD CONSTRAINT "wallet_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
