import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallets/wallet.service';
import { NotificationsService } from 'src/notifications/notifcations.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { PurchasePackageDto } from './dto/purchase-package.dto';
import Decimal from 'decimal.js';
import { TransactionType, WalletType } from '@prisma/client';
import { TreeService } from 'src/tree/tree.service';
import { SETTING_TYPE } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { EmailTemplates } from 'src/mail/templates/email.templates';
import { TargetSalesType } from '@prisma/client';
import { DateTime } from 'luxon';
import { APP_ZONE } from '../common/toronto-time';
@Injectable()
export class PackagesService {
  private readonly log = new Logger(PackagesService.name);
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private treeService: TreeService,
    private notificationsService: NotificationsService,
  ) { }

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

  async validateSplitConfig(
    buyerRole: Role,
    split: Record<string, number>,
    totalAmount: Decimal,
    rules: Record<WalletType, Decimal>,
    lockWithdrawalsTillTarget: boolean,
  ) {
    const parts: { wallet: WalletType; amount: string }[] = [];
  
    let total = new Decimal(0);
    const splitAmounts: Partial<Record<WalletType, Decimal>> = {};

    if (lockWithdrawalsTillTarget) {
      if (split[WalletType.E_WALLET]) {
        throw new BadRequestException("You can't use the Earning Wallet until you reach your target");
      }
    }
  
    for (const [wallet, amt] of Object.entries(split)) {
      const amount = new Decimal(amt).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  
      if (amount.lte(0)) continue;

      splitAmounts[wallet as WalletType] = amount;
  
      parts.push({
        wallet: wallet as WalletType,
        amount: amount.toFixed(2),
      });
  
      total = total.plus(amount);
    }

    // Enforce configured min percentages even when a wallet is omitted in split.
    if (buyerRole !== Role.ADMIN) {
      for (const [wallet, minPctRaw] of Object.entries(rules) as Array<
        [WalletType, Decimal]
      >) {
        const minPct = new Decimal(minPctRaw ?? 0);
        if (minPct.lte(0)) continue;

        const amount = splitAmounts[wallet] ?? new Decimal(0);
        const pct = amount.div(totalAmount).mul(100);
        if (pct.lt(minPct)) {
          throw new BadRequestException(
            `${wallet} must be at least ${minPct.toFixed()}%`,
          );
        }
      }
    }
  
    // 🔴 STRICT TOTAL CHECK
    if (!total.equals(totalAmount)) {
      throw new BadRequestException(
        `Split total ${total.toFixed(2)} must equal package amount ${totalAmount.toFixed(2)}`
      );
    }
  
    return parts;
  }

  async processTargetVolume(
    tx: Prisma.TransactionClient,
    userId: number,
    bv: Decimal,
    type: TargetSalesType,
  ) {
    // fetch active targets for that user
    const targets = await tx.targetAssignment.findMany({
      where: {
        userId,
        completed: false,
        salesType: type,
      },
    });

    if (!targets.length) return;

    for (const target of targets) {
      const currentAchieved = new Decimal(target.achieved.toString());
      const targetAmount = new Decimal(target.targetAmount.toString());

      const newAchieved = currentAchieved.plus(bv);

      const completed = newAchieved.greaterThanOrEqualTo(targetAmount);

      await tx.targetAssignment.update({
        where: { id: target.id },
        data: {
          achieved: Decimal.min(newAchieved, targetAmount).toFixed(),
          completed,
        },
      });

      if (completed) {
        const remainingTargets = await tx.targetAssignment.count({
          where: {
            userId: target.userId,
            completed: false,
          },
        });

        if (remainingTargets === 0) {
          await tx.user.update({
            where: { id: target.userId },
            data: {
              lockWithdrawalsTillTarget: false,
            },
          });
        }
      }
    }
  }

  // async addBinaryVolume(
  //   tx: Prisma.TransactionClient,
  //   userId: number,
  //   bv: Decimal,
  // ) {
  //   let current = await tx.user.findUnique({
  //     where: { id: userId },
  //     select: { id: true, sponsorId: true, position: true },
  //   });

  //   while (current?.sponsorId) {
  //     const sponsor = await tx.user.findUnique({
  //       where: { id: current.sponsorId },
  //       select: {
  //         id: true,
  //         position: true,
  //         leftBv: true,
  //         rightBv: true,
  //         rankLeftVolume: true,
  //         rankRightVolume: true,
  //       },
  //     });

  //     if (!sponsor) break;

  //     const field = current.position === 'LEFT' ? 'leftBv' : 'rightBv';

  //     const rankField =
  //       current.position === 'LEFT' ? 'rankLeftVolume' : 'rankRightVolume';

  //     await tx.user.update({
  //       where: { id: sponsor.id },
  //       data: {
  //         [field]: new Decimal(sponsor[field].toString()).plus(bv).toFixed(),
  //         [rankField]: new Decimal(sponsor[rankField].toString())
  //           .plus(bv)
  //           .toFixed(),
  //       },
  //     });

  //     await this.processTargetVolume(
  //       tx,
  //       sponsor.id,
  //       bv,
  //       TargetSalesType.INDIRECT,
  //     );

  //     await this.notificationsService.createNotification(
  //       sponsor.id,
  //       'Binary Volume Update',
  //       `Your ${field === 'leftBv' ? 'left' : 'right'} binary volume has increased by ${bv.toFixed()} BV due to a package purchase in your downline. Keep building your network!`,
  //       false,
  //       undefined,
  //       undefined,
  //       '/reports/track-referral',
  //     );

  //     // climb upward
  //     current = await tx.user.findUnique({
  //       where: { id: sponsor.id },
  //       select: { id: true, sponsorId: true, position: true },
  //     });
  //   }
  // }

  async addBinaryVolume(
    tx: Prisma.TransactionClient,
    userId: number,
    bv: Decimal,
    d_wallet_amount: Decimal,
  ) {
    // get the buyer
    let current = await tx.user.findUnique({
      where: { id: userId },
      select: { sponsorId: true, position: true, parentId: true },
    });

    while (current?.parentId) {
      const parent = await tx.user.findUnique({
        where: { id: current.parentId },
        select: {
          id: true,
          position: true,
        },
      });

      if (!parent) break;

      const field = current.position === 'LEFT' ? 'leftBv' : 'rightBv';
      const persistentField = current.position === 'LEFT' ? 'persistentLeftBv' : 'persistentRightBv';
      const rankField =
        current.position === 'LEFT' ? 'rankLeftVolume' : 'rankRightVolume';

      await tx.user.update({
        where: { id: parent.id },
        data: {
          [field]: { increment: bv.toNumber() },
          [rankField]: { increment: bv.toNumber() },
          [persistentField]: { increment: bv.toNumber() },
        },
      });

      await this.notificationsService.createNotification(
        parent.id,
        'Binary Volume Update',
        `Your ${field === 'leftBv' ? 'left' : 'right'} binary volume increased by ${bv.toFixed()}.`,
        false,
        undefined,
        undefined,
        '/reports/track-referral',
      );

      current = await tx.user.findUnique({
        where: { id: parent.id },
        select: { sponsorId: true, position: true, parentId: true },
      });
    }
  }

  async processIndirectTargetVolumeForReferralUpline(
    tx: Prisma.TransactionClient,
    userId: number,
    amount: Decimal,
  ) {
    if (amount.lte(0)) return;

    // DIRECT target is already handled for immediate sponsor.
    // INDIRECT should flow only through referral upline (sponsor chain), starting above direct sponsor.
    let current = await tx.user.findUnique({
      where: { id: userId },
      select: { sponsorId: true },
    });

    let nextSponsorId = current?.sponsorId ?? null;
    if (!nextSponsorId) return;

    const directSponsor = await tx.user.findUnique({
      where: { id: nextSponsorId },
      select: { sponsorId: true },
    });
    nextSponsorId = directSponsor?.sponsorId ?? null;

    while (nextSponsorId) {
      await this.processTargetVolume(
        tx,
        nextSponsorId,
        amount,
        TargetSalesType.INDIRECT,
      );

      const next = await tx.user.findUnique({
        where: { id: nextSponsorId },
        select: { sponsorId: true },
      });
      nextSponsorId = next?.sponsorId ?? null;
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

  private parseRate(value?: string | null): Decimal {
    if (!value) return new Decimal(0);

    const raw = value.trim();

    if (raw.endsWith('%')) {
      return new Decimal(raw.replace('%', '')).div(100);
    }

    return new Decimal(raw);
  }

  async purchasePackage(
    buyerId: number, // person paying
    buyerRole: Role,
    dto: PurchasePackageDto, // includes split + targetUserId?
  ) {
    const targetUserId = dto.userId;

    let user: User | null;

    if (targetUserId) {
      this.log.log('Find user by member ID');
      user = await this.prisma.user.findUnique({
        where: { memberId: targetUserId },
        include: { sponsor: true },
      });
    } else {
      this.log.log('Find user by user id');
      user = await this.prisma.user.findUnique({
        where: { id: buyerId },
        include: { sponsor: true },
      });
    }

    if (!user) {
      throw new BadRequestException('Target user not found');
    }

    const buyer = await this.prisma.user.findUnique({ where: { id: buyerId } });

    if (!buyer) {
      throw new Error('Buyer not found');
    }

    if (buyer.id! == user.id) {
    }

    // If the buyer is not an admin, the userId must be either the buyer themselves or someone in the downline
    if (buyerRole !== Role.ADMIN) {
      if (targetUserId !== user?.memberId) {
        const packagePurchaseType = await this.prisma.adminSetting.findUnique({
          where: { key: SETTING_TYPE.PACKAGE_PURCHASE_TYPE },
        });
        const isDownline = await this.walletService.isInDownline(
          buyerId,
          user.id,
          Infinity,
        );

        const isUpline = await this.walletService.isInUpline(
          buyerId,
          user.id,
          Infinity,
        );
        if (packagePurchaseType && packagePurchaseType.value == 'DOWNLINE') {
          if (!isDownline && !isUpline) {
            throw new BadRequestException(
              'Target user is neither in your upline nor in your downline',
            );
          }
        }
        if (user.isCrossLineTransferRestricted && !isDownline && !isUpline) {
          throw new BadRequestException(
            'Cross Line Fund Transfer is disabled for your account.  Contact support.',
          );
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

    // fetch rule config
    const rules = await this.getPackageWalletRules();

    // compute wallet deductions
    const parts = await this.validateSplitConfig(buyerRole, dto.split, amt, rules, buyer.lockWithdrawalsTillTarget);

    await this.prisma.auditLog.create({
      data: {
        actorId: buyerId,
        actorType: buyerRole === Role.ADMIN ? 'admin' : 'user',
        action: 'PACKAGE_PURCHASE_ATTEMPT',
        entity: 'PackagePurchase',
        after: {
          packageId: pkg.id,
          packageName: pkg.name,
          beneficiaryUserId: user.id,
          beneficiaryMemberId: user.memberId,
          buyerId,
          buyerMemberId: buyer.memberId,
          amount: amt.toFixed(),
          split: dto.split,
          isTarget: dto.isTarget ?? false,
        },
      },
    });

    await this.prisma.$transaction(async (tx) => {
      // 🔹 debit multiple wallets based on split
      let purpose = '';
      if (buyer.id !== user.id) {
        purpose = `${user.memberId} - Package purchase ${pkg.name}`;
      } else {
        purpose = `Self - Package purchase ${pkg.name}`;
      }
      for (const p of parts) {
        await this.walletService.debitWalletTransaction(tx, {
          userId: buyerId,
          walletType: p.wallet,
          amount: p.amount,
          txType: TransactionType.PACKAGE_PURCHASE,
          purpose: purpose,
          meta: {
            packageName: pkg.name,
            purchasedFor: user.memberId,
            purchasedBy: buyer.memberId,
            split: dto.split,
          },
        });
      }

      // same-day start (business calendar in Toronto)
      let startDate = DateTime.now()
        .setZone(APP_ZONE)
        .startOf('day');

      // If Sunday → move to Monday
      if (startDate.weekday === 7) {
        startDate = startDate.plus({ days: 1 });
      }

      // Skip holidays
      while (true) {
        const holiday = await this.prisma.holiday.findFirst({
          where: {
            date: startDate.toJSDate(),
          },
        });

        if (!holiday) break;

        startDate = startDate.plus({ days: 1 });

        if (startDate.weekday === 7) {
          startDate = startDate.plus({ days: 1 });
        }
      }

      // end date
      let endDate = startDate.plus({ days: pkg.durationDays });

      // Sunday fix
      if (endDate.weekday === 7) {
        endDate = endDate.plus({ days: 1 });
      }

      // Skip holidays
      while (true) {
        const holiday = await this.prisma.holiday.findFirst({
          where: {
            date: endDate.toJSDate(),
          },
        });

        if (!holiday) break;

        endDate = endDate.plus({ days: 1 });

        if (endDate.weekday === 7) {
          endDate = endDate.plus({ days: 1 });
        }
      }

      const finalStartDate = startDate.toJSDate();
      const finalEndDate = endDate.toJSDate();

      const purchase = await tx.packagePurchase.create({
        data: {
          userId: user.id,
          buyerId,
          packageId: pkg.id,
          amount: amt.toFixed(),
          startDate: finalStartDate,
          endDate: finalEndDate,
          status: 'ACTIVE',
          splitConfig: dto.split,
          isTarget: dto.isTarget ?? false,
        },
      });

      // 🔹 BV = full package amount (adjust if business logic changes)
      const bv = amt;

      let d_wallet_amount = new Decimal(0);

      for (const p of parts) {
        if (p.wallet === WalletType.D_WALLET) {
          d_wallet_amount = new Decimal(p.amount);
        }
      }

      if (!dto.isTarget) {
        await this.addBinaryVolume(tx, user.id, bv, d_wallet_amount);
      }

      if (user.sponsorId) {
        if (d_wallet_amount.gt(0)) {
          await this.processTargetVolume(
            tx,
            user.sponsorId,
            d_wallet_amount,
            TargetSalesType.DIRECT,
          );
        }
      }

      if (!dto.isTarget && d_wallet_amount.gt(0)) {
        await this.processIndirectTargetVolumeForReferralUpline(
          tx,
          user.id,
          d_wallet_amount,
        );
      }

      if (dto.isTarget) {
        if (!dto.targetMultiplier || !dto.targetType) {
          throw new BadRequestException('Target multiplier and type required');
        }

        const multiplierMap = {
          X1: 1,
          X2: 2,
          X3: 3,
          X4: 4,
          X5: 5,
          X7: 7,
          X10: 10,
        };

        const multiplierValue = multiplierMap[dto.targetMultiplier];

        const targetAmount = amt.mul(multiplierValue);

        await tx.targetAssignment.create({
          data: {
            userId: user.id,
            purchaseId: purchase.id,
            packageAmount: amt.toFixed(),
            multiplier: dto.targetMultiplier,
            salesType: dto.targetType,
            targetAmount: targetAmount.toFixed(),
          },
        });
      }
      const incompleteTargetsForUser = await tx.targetAssignment.count({
        where: { userId: user.id, completed: false },
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          activePackageCount: { increment: 1 },
          lockWithdrawalsTillTarget: incompleteTargetsForUser > 0,
        },
      });

      // ➜ REFERRAL BONUS and PACKAGE COUNT INCREMENT
      if (user?.sponsorId && !dto.isTarget) {
        const sponsor = await this.prisma.user.findUnique({
          where: { id: user.sponsorId },
        });

        if (!sponsor) {
          throw new NotFoundException('Sponsor not found');
        }

        if (sponsor.activePackageCount > 0) {
          const bonus = await this.prisma.adminSetting.findUnique({
            where: { key: SETTING_TYPE.REFERRAL_INCOME_RATE },
          });

          const bonusRate = this.parseRate(bonus?.value);

          const bonusAmt = amt.mul(bonusRate);

          let response: any = null;

          if (bonusAmt.gt(0)) {
            response = await this.walletService.creditWalletTransaction(tx, {
              userId: user.sponsorId,
              walletType: WalletType.P_WALLET,
              amount: bonusAmt.toString(),
              txType: TransactionType.REFERRAL_INCOME,
              purpose: `Referral bonus from ${user.memberId}`,
              meta: { fromMemberId: user.memberId },
            });

            const html = EmailTemplates.referralIncome(
              sponsor.firstName + ' ' + sponsor.lastName,
              bonusAmt.toFixed(),
              user.firstName + ' ' + user.lastName,
              response?.balanceAfter,
            );

            await this.notificationsService.createNotificationTransaction(
              tx,
              user.sponsorId,
              'Referral Bonus Earned',
              `You have earned a referral bonus of $${bonusAmt.toFixed()} from ${user.firstName} ${user.lastName}'s package purchase.`,
              true,
              html,
              'New Referral Earnings Credited!',
              '/income/referral',
            );
          }
        }
      }

      const displayStartDate = startDate.toFormat('ccc dd LLLL yyyy ZZZZ');

      const displayEndDate = endDate.toFormat('ccc dd LLLL yyyy ZZZZ');

      if (buyerId !== user.id) {
        // send notification to buyer
        const html = EmailTemplates.packagePurchasedForOther(
          buyer.firstName + ' ' + buyer.lastName,
          user.firstName + ' ' + user.lastName,
          pkg.name,
          amt.toFixed(),
          'transaction Id',
          parts.map((p) => `${p.wallet}: $${p.amount}`).join(', '),
        );
        await this.notificationsService.createNotificationTransaction(
          tx,
          buyerId,
          `Package Purchased for ${user.firstName} ${user.lastName}`,
          `You have successfully purchased the ${pkg.name} package for ${user.firstName} ${user.lastName}. The package will be active from ${displayStartDate} to ${displayEndDate}.`,
          true,
          html,
          `You purchased ${pkg.name} for ${user.firstName} ${user.lastName}`,
          '/reports/gain-report?type=PACKAGE_PURCHASE',
        );

        // send notification to recipient
        const html2 = EmailTemplates.packageAssigned(
          user.firstName + ' ' + user.lastName,
          pkg.name,
          buyer.firstName + ' ' + buyer.lastName,
          amt.toFixed(),
        );
        await this.notificationsService.createNotificationTransaction(
          tx,
          user.id,
          'Package Purchased for You',
          `The ${pkg.name} package has been purchased for you by ${buyer.firstName} ${buyer.lastName}. It will be active from ${displayStartDate} to ${displayEndDate}. Enjoy the benefits of your new package!`,
          true,
          html2,
          `New Package Added to Your Account`,
          '/reports/gain-report?type=PACKAGE_PURCHASE',
        );
      } else {
        const html = EmailTemplates.packageSelf(
          user.firstName + ' ' + user.lastName,
          pkg.name,
          amt.toFixed(),
          'Transaction Id',
          parts.map((p) => `${p.wallet}: $${p.amount}`).join(', '),
          displayStartDate,
          '/reports/gain-report?type=PACKAGE_PURCHASE',
        );

        await this.notificationsService.createNotificationTransaction(
          tx,
          user.id,
          'Package Purchased',
          `You have successfully purchased the ${pkg.name} package. It will be active from ${displayStartDate} to ${displayEndDate}. Enjoy the benefits of your new package!`,
          true,
          html,
          `${pkg.name} purchased successfully`,
          '/reports/gain-report?type=PACKAGE_PURCHASE',
        );
      }

      await tx.auditLog.create({
        data: {
          actorId: buyerId,
          actorType: buyerRole === Role.ADMIN ? 'admin' : 'user',
          action: 'PACKAGE_PURCHASE_SUCCESS',
          entity: 'PackagePurchase',
          entityId: purchase.id,
          after: {
            purchaseId: purchase.id,
            packageId: pkg.id,
            userId: user.id,
            buyerId,
            amount: amt.toFixed(),
            startDate: finalStartDate.toISOString(),
            endDate: finalEndDate.toISOString(),
            isTarget: dto.isTarget ?? false,
          },
        },
      });
    });

    return {
      message: 'Package purchased successfully',
      data: {
        packageName: pkg.name,
        amount: dto.amount,
        purchasedBy: buyer.memberId,
        purchasedFor: user.memberId,
        dailyRoI: pkg.dailyReturnPct,
        totalRoI:
          ((pkg.durationDays * Number(pkg.dailyReturnPct)) / 100) *
          Number(dto.amount),
        totalDays: pkg.durationDays,
      },
    };
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
