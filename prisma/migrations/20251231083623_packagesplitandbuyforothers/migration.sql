/*
  Warnings:

  - Added the required column `buyerId` to the `package_purchases` table without a default value. This is not possible if the table is not empty.
  - Added the required column `splitConfig` to the `package_purchases` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."package_purchases" ADD COLUMN     "buyerId" INTEGER NOT NULL,
ADD COLUMN     "splitConfig" JSONB NOT NULL;

-- CreateTable
CREATE TABLE "public"."PackageWalletConfig" (
    "id" SERIAL NOT NULL,
    "wallet" "public"."WalletType" NOT NULL,
    "minPct" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageWalletConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PackageWalletConfig_wallet_key" ON "public"."PackageWalletConfig"("wallet");

-- AddForeignKey
ALTER TABLE "public"."package_purchases" ADD CONSTRAINT "package_purchases_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
