-- CreateTable
CREATE TABLE "public"."wallet_limits" (
    "id" SERIAL NOT NULL,
    "walletType" "public"."WalletType" NOT NULL,
    "minWithdrawal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "maxPerTx" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "maxTxCount24h" INTEGER NOT NULL DEFAULT 0,
    "maxAmount24h" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_limits_walletType_key" ON "public"."wallet_limits"("walletType");
