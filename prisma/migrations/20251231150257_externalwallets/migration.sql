-- CreateTable
CREATE TABLE "public"."SupportedWallet" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "allowedChangeCount" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportedWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserWallet" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "supportedWalletId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "changeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportedWallet_name_currency_key" ON "public"."SupportedWallet"("name", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "UserWallet_userId_supportedWalletId_key" ON "public"."UserWallet"("userId", "supportedWalletId");

-- AddForeignKey
ALTER TABLE "public"."UserWallet" ADD CONSTRAINT "UserWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserWallet" ADD CONSTRAINT "UserWallet_supportedWalletId_fkey" FOREIGN KEY ("supportedWalletId") REFERENCES "public"."SupportedWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
