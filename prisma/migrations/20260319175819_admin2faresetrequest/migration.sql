-- CreateTable
CREATE TABLE "public"."TwoFactorResetManualRequest" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,

    CONSTRAINT "TwoFactorResetManualRequest_pkey" PRIMARY KEY ("id")
);
