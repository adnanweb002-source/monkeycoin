-- CreateTable
CREATE TABLE "public"."deposit_requests" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "walletId" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "deposit_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deposit_requests_userId_idx" ON "public"."deposit_requests"("userId");

-- AddForeignKey
ALTER TABLE "public"."deposit_requests" ADD CONSTRAINT "deposit_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deposit_requests" ADD CONSTRAINT "deposit_requests_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
