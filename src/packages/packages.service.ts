import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallets/wallet.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { PurchasePackageDto } from './dto/purchase-package.dto';
import Decimal from 'decimal.js';
import { TransactionType, WalletType } from '@prisma/client';
import { TreeService } from 'src/tree/tree.service';
import { SETTING_TYPE } from '@prisma/client';
@Injectable()
export class PackagesService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private treeService: TreeService,
  ) {}

  async upsertPackageWalletRule(wallet: WalletType, minPct: Decimal) {
    return this.prisma.packageWalletConfig.upsert({
      where: { wallet },
      create: { wallet, minPct: minPct.toFixed() },
      update: { minPct: minPct.toFixed() },
    });
  }

  async getPackageWalletRules() {
    const rules = await this.prisma.packageWalletConfig.findMany();
    return rules.reduce(
      (map, r) => {
        map[r.wallet] = new Decimal(r.minPct.toString());
        return map;
      },
      {} as Record<WalletType, Decimal>,
    );
  }

  validateSplitConfig(
    buyerRole: Role,
    split: Record<string, number>,
    amount: Decimal,
    rules: Record<WalletType, Decimal>,
  ) {
    if (!split || Object.keys(split).length === 0)
      throw new BadRequestException('Split configuration required');

    const totalPct = Object.values(split).reduce((a, b) => a + b, 0);
    if (totalPct !== 100)
      throw new BadRequestException('Split must total 100%');

    if (buyerRole !== Role.ADMIN) {
      for (const wallet of Object.keys(rules) as WalletType[]) {
        const provided = new Decimal(split[wallet] ?? 0);
        if (provided.lt(rules[wallet])) {
          throw new BadRequestException(
            `Minimum ${rules[wallet].toFixed()}% required from ${wallet}`,
          );
        }
      }
    } else {
      // Admin: ensure 100% split from Bonus Wallet
      const bonusPct = new Decimal(split[WalletType.BONUS_WALLET] ?? 0);
      if (!bonusPct.eq(100)) {
        throw new BadRequestException(
          `Admin purchases must be 100% from Bonus Wallet`,
        );
      }
    }

    // return computed debits
    return Object.entries(split).map(([wallet, pct]) => ({
      wallet: wallet as WalletType,
      amount: amount.mul(pct).div(100).toFixed(),
    }));
  }

  async addBinaryVolume(
    tx: Prisma.TransactionClient,
    userId: number,
    bv: Decimal,
  ) {
    let current = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, sponsorId: true, position: true },
    });

    while (current?.sponsorId) {
      const sponsor = await tx.user.findUnique({
        where: { id: current.sponsorId },
        select: { id: true, position: true, leftBv: true, rightBv: true },
      });

      if (!sponsor) break;

      const field = current.position === 'LEFT' ? 'leftBv' : 'rightBv';

      await tx.user.update({
        where: { id: sponsor.id },
        data: {
          [field]: new Decimal(sponsor[field].toString()).plus(bv).toFixed(),
        },
      });

      // climb upward
      current = await tx.user.findUnique({
        where: { id: sponsor.id },
        select: { id: true, sponsorId: true, position: true },
      });
    }
  }

  async createPackage(dto: CreatePackageDto) {
    return this.prisma.package.create({ data: dto });
  }

  // -------- ADMIN: UPDATE PACKAGE --------
  async updatePackage(id: number, dto: UpdatePackageDto) {
    const pkg = await this.prisma.package.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Package not found');

    return this.prisma.package.update({
      where: { id },
      data: dto,
    });
  }

  // -------- USER: LIST ACTIVE PACKAGES --------
  async listActivePackages() {
    return this.prisma.package.findMany({
      where: { isActive: true },
      orderBy: { investmentMin: 'asc' },
    });
  }

  async purchasePackage(
    buyerId: number, // person paying
    buyerRole: Role,
    dto: PurchasePackageDto, // includes split + targetUserId?
  ) {
    // If the buyer is not an admin, the userId must be either the buyer themselves or someone in the downline
    if (buyerRole !== Role.ADMIN) {
      const targetUserId = dto.userId ?? buyerId;
      if (targetUserId !== buyerId) {
        const isDownline = await this.walletService.isInDownline(
          buyerId,
          targetUserId,
          Infinity,
        );
        if (!isDownline) {
          throw new BadRequestException('Target user is not in your downline');
        }
      }
    }

    const pkg = await this.prisma.package.findUnique({
      where: { id: dto.packageId },
    });

    if (!pkg || !pkg.isActive)
      throw new BadRequestException('Invalid or inactive package');

    const amt = new Decimal(dto.amount);
    if (amt.lt(pkg.investmentMin) || amt.gt(pkg.investmentMax)) {
      throw new BadRequestException('Amount not within package range');
    }

    const targetUserId = dto.userId ?? buyerId; // self or someone else

    // fetch rule config
    const rules = await this.getPackageWalletRules();

    // compute wallet deductions
    const parts = this.validateSplitConfig(buyerRole, dto.split, amt, rules);

    return this.prisma.$transaction(async (tx) => {
      // 🔹 debit multiple wallets based on split
      for (const p of parts) {
        await this.walletService.debitWallet({
          userId: buyerId,
          walletType: p.wallet,
          amount: p.amount,
          txType: TransactionType.PACKAGE_PURCHASE,
          purpose: `Package purchase: ${pkg.name} (${p.wallet})`,
          meta: { packageId: pkg.id, split: dto.split },
        });
      }

      // 🔹 BV = full package amount (adjust if business logic changes)
      const bv = amt;

      await this.addBinaryVolume(tx, targetUserId, bv);

      // next-day start + duration
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 1);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + pkg.durationDays);

      await tx.packagePurchase.create({
        data: {
          userId: targetUserId,
          buyerId,
          packageId: pkg.id,
          amount: amt.toFixed(),
          startDate,
          endDate,
          status: 'ACTIVE',
          splitConfig: dto.split,
        },
      });

      const user = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: { sponsorId: true, id: true, memberId: true },
      });

      await this.prisma.user.update({
        where: { id: targetUserId },
        data: {
          activePackageCount: { increment: 1 },
        },
      });

      // ➜ REFERRAL BONUS and PACKAGE COUNT INCREMENT
      if (buyerId == targetUserId) {
        if (user?.sponsorId) {
          const bonus = await this.prisma.adminSetting.findUnique({
            where: { key: SETTING_TYPE.REFERRAL_INCOME_RATE },
          });

          const bonusAmt = new Decimal(bonus?.value ?? '0');

          if (bonusAmt.gt(0)) {
            await this.walletService.creditWallet({
              userId: user.sponsorId,
              walletType: WalletType.I_WALLET,
              amount: bonusAmt.toString(),
              txType: TransactionType.REFERRAL_INCOME,
              purpose: `Referral bonus from ${user.memberId}`,
              meta: { fromUserId: user.id, fromMemberId: user.memberId },
            });
          }
        }
      }
    });
  }

  // -------- USER: MY PACKAGES --------
  async listUserPackages(userId: number) {
    return this.prisma.packagePurchase.findMany({
      where: { userId },
      include: { package: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
