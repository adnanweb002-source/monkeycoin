-- CreateTable
CREATE TABLE "public"."package_income_logs" (
    "id" SERIAL NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "creditDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "package_income_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "package_income_logs_purchaseId_creditDate_key" ON "public"."package_income_logs"("purchaseId", "creditDate");

-- AddForeignKey
ALTER TABLE "public"."package_income_logs" ADD CONSTRAINT "package_income_logs_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "public"."package_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
