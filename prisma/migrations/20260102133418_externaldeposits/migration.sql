-- CreateTable
CREATE TABLE "public"."ExternalDeposit" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fiatAmount" DECIMAL(65,30) NOT NULL,
    "crypto" TEXT NOT NULL,
    "payAmount" DECIMAL(65,30),
    "paidAmount" DECIMAL(65,30),
    "address" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentGatewayLog" (
    "id" SERIAL NOT NULL,
    "paymentId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentGatewayLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalDeposit_paymentId_key" ON "public"."ExternalDeposit"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentGatewayLog_paymentId_idx" ON "public"."PaymentGatewayLog"("paymentId");

-- AddForeignKey
ALTER TABLE "public"."ExternalDeposit" ADD CONSTRAINT "ExternalDeposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
