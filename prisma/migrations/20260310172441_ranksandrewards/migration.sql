-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "currentRank" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rankLeftVolume" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "rankRightVolume" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "public"."Rank" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "requiredLeft" DECIMAL(18,2) NOT NULL,
    "requiredRight" DECIMAL(18,2) NOT NULL,
    "rewardAmount" DECIMAL(18,2),
    "rewardTitle" TEXT,
    "rewardWallet" "public"."WalletType",
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RankRewardLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "rankId" INTEGER NOT NULL,
    "reward" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankRewardLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rank_order_key" ON "public"."Rank"("order");

-- CreateIndex
CREATE UNIQUE INDEX "RankRewardLog_userId_rankId_key" ON "public"."RankRewardLog"("userId", "rankId");

-- AddForeignKey
ALTER TABLE "public"."RankRewardLog" ADD CONSTRAINT "RankRewardLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RankRewardLog" ADD CONSTRAINT "RankRewardLog_rankId_fkey" FOREIGN KEY ("rankId") REFERENCES "public"."Rank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
