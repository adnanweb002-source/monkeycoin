import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { WalletService } from 'src/wallets/wallet.service';
import { WalletType, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';

@Injectable()
export class RankService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
  ) {}

  /**
   * Return all ranks with claim status for user
   */
  async getUserRanks(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        currentRank: true,
        rankLeftVolume: true,
        rankRightVolume: true,
      },
    });

    const claims = await this.prisma.rankRewardLog.findMany({
      where: {
        userId: userId,
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const ranks = await this.prisma.rank.findMany({
      orderBy: { order: 'asc' },
    });

    const left = new Decimal(user.rankLeftVolume.toString());
    const right = new Decimal(user.rankRightVolume.toString());

    return ranks.map((rank) => {
      const claimed =
        claims?.some((claimedRank) => claimedRank.rankId === rank.id) ?? false;

      const unlocked =
        left.greaterThanOrEqualTo(rank.requiredLeft) &&
        right.greaterThanOrEqualTo(rank.requiredRight);

      const claimable = unlocked && !claimed && rank.order == user.currentRank + 1

      return {
        id: rank.id,
        name: rank.name,
        reward: rank.rewardAmount,
        rewardTitle: rank.rewardTitle,
        requiredLeft: rank.requiredLeft,
        requiredRight: rank.requiredRight,
        order: rank.order,
        claimed: claimed,
        claimable,
        unlocked,
      };
    });
  }

  /**
   * Claim rank reward
   */
  async claimRank(userId: number, rankId: number) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      const rank = await tx.rank.findUnique({
        where: { id: rankId },
      });

      if (!rank) {
        throw new BadRequestException('Rank not found');
      }

      if(rank.order !== user.currentRank + 1){
          throw new BadRequestException("You have to claim the previous rank(s) in order to claim this rank")
      }

      const left = new Decimal(user.rankLeftVolume.toString());
      const right = new Decimal(user.rankRightVolume.toString());

      if (
        left.lessThan(rank.requiredLeft) ||
        right.lessThan(rank.requiredRight)
      ) {
        throw new BadRequestException('Rank conditions not met');
      }

      /**
       * Prevent duplicate claim
       */
      const exists = await tx.rankRewardLog.findUnique({
        where: {
          userId_rankId: {
            userId,
            rankId,
          },
        },
      });

      if (exists) {
        throw new BadRequestException('Rank already claimed');
      }

      /**
       * Credit reward
       */
      if (rank.rewardAmount) {
        await this.walletService.creditWalletTransaction(tx, {
          userId,
          walletType: WalletType.A_WALLET,
          amount: rank.rewardAmount.toString(),
          txType: TransactionType.RANK_REWARD,
          purpose: `Rank Reward: ${rank.name}`,
          meta: { rankName: rank.name },
        });
      }

      /**
       * Reset rank volumes
       */
      await tx.user.update({
        
        where: { id: userId },
        data: {
          rankLeftVolume: left.minus(rank.requiredLeft),
          rankRightVolume: right.minus(rank.requiredRight),
          currentRank: rank.order,
        },
      });

      /**
       * Log claim
       */
      await tx.rankRewardLog.create({
        data: {
          userId,
          rankId,
          reward: rank.rewardAmount ?? 0,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorType: 'user',
          action: 'RANK_REWARD_CLAIMED',
          entity: 'RankRewardLog',
          before: {
            rankLeftVolume: left.toString(),
            rankRightVolume: right.toString(),
            currentRank: user.currentRank,
          },
          after: {
            rankId: rank.id,
            rankName: rank.name,
            rewardAmount: rank.rewardAmount?.toString() ?? '0',
            currentRank: rank.order,
            rankLeftVolume: left.minus(rank.requiredLeft).toString(),
            rankRightVolume: right.minus(rank.requiredRight).toString(),
          },
        },
      });

      return {
        message: `${rank.name} reward claimed`,
      };
    });
  }

  /**
   * Get rank progress for dashboard
   */
  async getRankProgress(userId: number) {
    const ranks = await this.prisma.rank.findMany({});

    if (!ranks || ranks.length == 0) {
      return {
        completed: false,
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        currentRank: true,
        rankLeftVolume: true,
        rankRightVolume: true,
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const nextRank = await this.prisma.rank.findFirst({
      where: {
        order: user.currentRank + 1,
      },
    });

    if (!nextRank) {
      return {
        completed: true,
      };
    }

    return {
      rank: nextRank.name,
      leftProgress: user.rankLeftVolume,
      rightProgress: user.rankRightVolume,
      requiredLeft: nextRank.requiredLeft,
      requiredRight: nextRank.requiredRight,
    };
  }

  async getAllRanks() {
    return this.prisma.rank.findMany({
      orderBy: { order: 'asc' },
    });
  }
}
