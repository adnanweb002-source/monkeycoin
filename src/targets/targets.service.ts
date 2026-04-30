import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PackagesService } from 'src/packages/packages.service';
import { UpdateTargetDto } from './dto/update-target.dto';
import { TargetsQueryDto } from './dto/targets-query.dto';
import { PurchasePackageDto } from 'src/packages/dto/purchase-package.dto';
import { AssignTargetDto } from './dto/assign-target.dto';
import { Role } from 'src/auth/enums/role.enum';
import Decimal from 'decimal.js';
import {
  parseQueryDateEnd,
  parseQueryDateStart,
} from '../common/toronto-time';
import { TargetMultiplier, TransactionType, WalletType } from '@prisma/client';
import { generateTxNumber } from 'src/wallets/utils';

@Injectable()
export class TargetsService {
  constructor(
    private prisma: PrismaService,
    private packageService: PackagesService,
  ) {}

  private multiplierValue(multiplier: TargetMultiplier): Decimal {
    const map: Record<TargetMultiplier, number> = {
      X1: 1,
      X2: 2,
      X3: 3,
      X4: 4,
      X5: 5,
      X7: 7,
      X10: 10,
    };
    return new Decimal(map[multiplier]);
  }

  // ADMIN — list all targets
  async listAllTargets(query: TargetsQueryDto) {
    const {
      page = 1,
      limit = 20,
      memberId,
      completed,
      salesType,
      startDate,
      endDate,
    } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    if (completed !== undefined) {
      where.completed = completed;
    }

    if (salesType) {
      where.salesType = salesType;
    }

    if (memberId) {
      where.user = {
        memberId: {
          contains: memberId,
          mode: 'insensitive',
        },
      };
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = parseQueryDateStart(startDate);
      if (endDate) where.createdAt.lte = parseQueryDateEnd(endDate);
    }

    const [targets, total] = await this.prisma.$transaction([
      this.prisma.targetAssignment.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        include: {
          user: {
            select: {
              id: true,
              memberId: true,
              firstName: true,
              lastName: true,
            },
          },
          purchase: {
            select: {
              id: true,
              amount: true,
              packageId: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.targetAssignment.count({ where }),
    ]);

    return {
      data: targets,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ADMIN — update target
  async updateTarget(id: number, dto: UpdateTargetDto, adminId?: number) {
    const target = await this.prisma.targetAssignment.findUnique({
      where: { id },
    });

    if (!target) throw new NotFoundException('Target not found');

    return this.prisma.$transaction(async (tx) => {
      const packageAmount = new Decimal(dto.targetAmount).div(
        this.multiplierValue(dto.multiplier),
      );

      const updated = await tx.targetAssignment.update({
        where: { id },
        data: {
          packageAmount: packageAmount.toFixed(2),
          multiplier: dto.multiplier,
          targetAmount: new Decimal(dto.targetAmount),
          salesType: dto.salesType,
        },
      });

      await tx.packagePurchase.update({
        where: { id: target.purchaseId },
        data: {
          amount: packageAmount.toFixed(2),
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorType: 'admin',
          action: 'TARGET_UPDATED',
          entity: 'TargetAssignment',
          entityId: id,
          before: {
            multiplier: target.multiplier,
            targetAmount: target.targetAmount.toString(),
            salesType: target.salesType,
            completed: target.completed,
          },
          after: {
            packageAmount: updated.packageAmount.toString(),
            multiplier: updated.multiplier,
            targetAmount: updated.targetAmount.toString(),
            salesType: updated.salesType,
            completed: updated.completed,
          },
        },
      });
      return updated;
    });
  }

  // ADMIN — delete target
  async deleteTarget(id: number, adminId?: number) {
    const target = await this.prisma.targetAssignment.findUnique({
      where: { id },
    });

    if (!target) throw new NotFoundException('Target not found');

    await this.prisma.$transaction(async (tx) => {
      // Count how many targets this user has
      const count = await tx.targetAssignment.count({
        where: {
          userId: target.userId,
        },
      });

      // If this is the ONLY target
      if (count === 1) {
        await tx.user.update({
          where: { id: target.userId },
          data: {
            lockWithdrawalsTillTarget: false,
          },
        });
      }

      // Delete the target
      await tx.targetAssignment.delete({
        where: { id },
      });

      // Remove generated ROI logs linked to this purchase before deleting purchase
      await tx.packageIncomeLog.deleteMany({
        where: { purchaseId: target.purchaseId },
      });

      // Delete associated target purchase
      await tx.packagePurchase.delete({
        where: { id: target.purchaseId },
      });

      const eWallet = await tx.wallet.findUnique({
        where: {
          userId_type: {
            userId: target.userId,
            type: WalletType.E_WALLET,
          },
        },
      });

      if (eWallet && new Decimal(eWallet.balance.toString()).gt(0)) {
        await tx.wallet.update({
          where: { id: eWallet.id },
          data: { balance: '0' },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: eWallet.id,
            userId: target.userId,
            type: TransactionType.ADJUSTMENT,
            direction: 'DEBIT',
            amount: new Decimal(eWallet.balance.toString()).toFixed(2),
            balanceAfter: '0.00',
            txNumber: generateTxNumber(),
            purpose: `E_WALLET zeroed after target/package delete #${target.purchaseId}`,
            meta: {
              source: 'TARGET_DELETE',
              targetId: target.id,
              purchaseId: target.purchaseId,
              adminId: adminId ?? null,
            },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorType: 'admin',
          action: 'TARGET_DELETED',
          entity: 'TargetAssignment',
          entityId: id,
          before: {
            userId: target.userId,
            purchaseId: target.purchaseId,
            targetAmount: target.targetAmount.toString(),
            achieved: target.achieved.toString(),
            completed: target.completed,
          },
          after: { deleted: true },
        },
      });
    });
  }

  async getTargetStats() {
    const [
      totalTargetsGiven,
      totalTargetsReached,
      totalRoiGenerated,
      roiFromCompletedTargets,
    ] = await this.prisma.$transaction([
      // total targets assigned
      this.prisma.targetAssignment.count(),

      // completed targets
      this.prisma.targetAssignment.count({
        where: { completed: true },
      }),

      // ROI generated from all target packages
      this.prisma.packageIncomeLog.aggregate({
        _sum: { amount: true },
        where: {
          purchase: {
            isTarget: true,
          },
        },
      }),

      // ROI generated from completed targets only
      this.prisma.packageIncomeLog.aggregate({
        _sum: { amount: true },
        where: {
          purchase: {
            isTarget: true,
            targetAssignment: {
              some: {
                completed: true,
              },
            },
          },
        },
      }),
    ]);

    return {
      totalTargetsGiven,
      totalTargetsReached,
      totalRoiGenerated: totalRoiGenerated._sum.amount ?? '0',
      roiFromCompletedTargets: roiFromCompletedTargets._sum.amount ?? '0',
    };
  }

  async getTargetBusinessVolumeStats() {
    const [totalTargets, lockedUsers] = await this.prisma.$transaction([
      this.prisma.targetAssignment.aggregate({
        _sum: {
          targetAmount: true,
          achieved: true,
        },
      }),

      this.prisma.user.count({
        where: {
          lockWithdrawalsTillTarget: true,
        },
      }),
    ]);

    const totalTargetVolume = totalTargets._sum.targetAmount ?? new Decimal(0);

    const totalAchievedVolume = totalTargets._sum.achieved ?? new Decimal(0);

    const remainingVolume = new Decimal(totalTargetVolume).minus(
      totalAchievedVolume,
    );

    const completionPercent = totalTargetVolume.equals(0)
      ? 0
      : totalAchievedVolume.div(totalTargetVolume).mul(100).toDecimalPlaces(2);

    return {
      totalTargetVolume: totalTargetVolume.toString(),
      totalAchievedVolume: totalAchievedVolume.toString(),
      remainingVolume: remainingVolume.toString(),
      averageCompletionPercent: completionPercent.toString(),
      usersUnderTargetLock: lockedUsers,
    };
  }

  async assignTarget(userId: number, dto: AssignTargetDto) {
    const user = await this.prisma.user.findUnique({
      where: { memberId: dto.memberId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // check if user has already a target
    const existingTarget = await this.prisma.targetAssignment.findFirst({
      where: {
        userId: user.id,
        completed: false,
      },
    });
    
    if (existingTarget) {
      throw new BadRequestException('User already has an active target');
    }

    // find package based on amount
    const pkg = await this.prisma.package.findFirst({
      where: {
        investmentMax: {
          gte: dto.packageAmount,
        },
        investmentMin: {
          lte: dto.packageAmount,
        },
      },
    });

    if (!pkg) {
      throw new BadRequestException('No matching package found');
    }

    const purchaseDto: PurchasePackageDto = {
      packageId: pkg.id,
      amount: dto.packageAmount,
      userId: dto.memberId,
      split: dto.split,
      isTarget: true,
      targetMultiplier: dto.targetMultiplier,
      targetType: dto.targetType,
      targetNeededToUnlockDailyRoi: dto.targetNeededToUnlockDailyRoi,
    };

    await this.packageService.purchasePackage(userId, Role.ADMIN, purchaseDto);

    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: 'admin',
        action: 'TARGET_ASSIGNED',
        entity: 'TargetAssignment',
        after: {
          memberId: dto.memberId,
          packageId: pkg.id,
          packageAmount: dto.packageAmount,
          targetMultiplier: dto.targetMultiplier,
          targetType: dto.targetType,
        },
      },
    });

    return {
      message: 'Target assigned successfully',
    };
  }

  // USER — list own targets
  async listUserTargets(userId: number) {
    return this.prisma.targetAssignment.findMany({
      where: {
        userId,
      },
      include: {
        purchase: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
