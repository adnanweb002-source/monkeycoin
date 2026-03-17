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
@Injectable()
export class PackagesService {
  private readonly log = new Logger(PackagesService.name);
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private treeService: TreeService,
    private notificationsService: NotificationsService,
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

  async processTargetVolume(
    tx: Prisma.TransactionClient,
    userId: number,
    bv: Decimal,
    type: TargetSalesType,
  ) {
    return;
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
  ) {
    // get the buyer
    let current = await tx.user.findUnique({
      where: { id: userId },
      select: { sponsorId: true, position: true },
    });

    while (current?.sponsorId) {
      const sponsor = await tx.user.findUnique({
        where: { id: current.sponsorId },
        select: {
          id: true,
          position: true,
        },
      });

      if (!sponsor) break;

      const field = current.position === 'LEFT' ? 'leftBv' : 'rightBv';
      const rankField =
        current.position === 'LEFT' ? 'rankLeftVolume' : 'rankRightVolume';

      await tx.user.update({
        where: { id: sponsor.id },
        data: {
          [field]: { increment: bv.toNumber() },
          [rankField]: { increment: bv.toNumber() },
        },
      });

      // trigger target engine
      await this.processTargetVolume(
        tx,
        sponsor.id,
        bv,
        TargetSalesType.INDIRECT,
      );

      await this.notificationsService.createNotification(
        sponsor.id,
        'Binary Volume Update',
        `Your ${field === 'leftBv' ? 'left' : 'right'} binary volume increased by ${bv.toFixed()}.`,
        false,
        undefined,
        undefined,
        '/reports/track-referral',
      );

      current = await tx.user.findUnique({
        where: { id: sponsor.id },
        select: { sponsorId: true, position: true },
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
    this.log.log('BuyerID, Buyer Role and dto' + buyerId + buyerRole);
    this.log.log(`The dto: ${dto}`);

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

    // If the buyer is not an admin, the userId must be either the buyer themselves or someone in the downline
    if (buyerRole !== Role.ADMIN) {
      if (targetUserId !== user?.memberId) {
        const isDownline = await this.walletService.isInDownline(
          buyerId,
          user.id,
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

    // fetch rule config
    const rules = await this.getPackageWalletRules();

    // compute wallet deductions
    const parts = this.validateSplitConfig(buyerRole, dto.split, amt, rules);

    const purchase = this.prisma.$transaction(async (tx) => {
      // 🔹 debit multiple wallets based on split
      let purpose = '';
      if (buyerId! == user.id) {
        purpose = `${user.memberId} - Package purchase ${pkg.name}`;
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
      // next-day start + duration
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 1);

      // If start Date is a sunday, shift to the following Monday
      if (startDate.getDay() === 0) {
        startDate.setDate(startDate.getDate() + 1);
      }

      // if start Date is a holiday, shift to the next day until it's not a holiday
      const holiday = await this.prisma.holiday.findFirst({
        where: { date: startDate },
      });

      while (holiday) {
        startDate.setDate(startDate.getDate() + 1);
        const nextHoliday = await this.prisma.holiday.findFirst({
          where: { date: startDate },
        });
        if (!nextHoliday) break;
      }

      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + pkg.durationDays);

      // If end Date falls on a Sunday, shift by one day to Saturday
      if (endDate.getDay() === 0) {
        endDate.setDate(endDate.getDate() + 1);
      }

      // if end Date falls on a holiday, shift to the next day until it's not a holiday
      let endHoliday = await this.prisma.holiday.findFirst({
        where: { date: endDate },
      });
      while (endHoliday) {
        endDate.setDate(endDate.getDate() + 1);
        endHoliday = await this.prisma.holiday.findFirst({
          where: { date: endDate },
        });
      }

      const purchase = await tx.packagePurchase.create({
        data: {
          userId: user.id,
          buyerId,
          packageId: pkg.id,
          amount: amt.toFixed(),
          startDate,
          endDate,
          status: 'ACTIVE',
          splitConfig: dto.split,
          isTarget: dto.isTarget ?? false,
        },
      });

       // 🔹 BV = full package amount (adjust if business logic changes)
      const bv = amt;

      await this.addBinaryVolume(tx, user.id, bv);


      if (user.sponsorId) {
        await this.processTargetVolume(
          tx,
          user.sponsorId,
          amt,
          TargetSalesType.DIRECT,
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
      await tx.user.update({
        where: { id: user.id },
        data: {
          activePackageCount: { increment: 1 },
          lockWithdrawalsTillTarget: dto.isTarget || false,
        },
      });

      // ➜ REFERRAL BONUS and PACKAGE COUNT INCREMENT
      if (buyerId == user.id) {
        if (user?.sponsorId) {
          const sponsor = await this.prisma.user.findUnique({
            where: { id: user.sponsorId },
          });

          if (!sponsor) {
            throw new NotFoundException('Sponsor not found');
          }

          const bonus = await this.prisma.adminSetting.findUnique({
            where: { key: SETTING_TYPE.REFERRAL_INCOME_RATE },
          });

          const bonusRate = this.parseRate(bonus?.value);

          const bonusAmt = amt.mul(bonusRate);

          let response: any = null;

          if (bonusAmt.gt(0)) {
            response = await this.walletService.creditWalletTransaction(tx, {
              userId: user.sponsorId,
              walletType: WalletType.I_WALLET,
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

      if (buyerId !== user.id){
        if (buyer?.sponsorId) {
          const sponsor = await this.prisma.user.findUnique({
            where: { id: buyer.sponsorId },
          });

          if (!sponsor) {
            throw new NotFoundException('Sponsor not found');
          }

          const bonus = await this.prisma.adminSetting.findUnique({
            where: { key: SETTING_TYPE.REFERRAL_INCOME_RATE },
          });

          const bonusRate = this.parseRate(bonus?.value);

          const bonusAmt = amt.mul(bonusRate);

          let response: any = null;

          if (bonusAmt.gt(0)) {
            response = await this.walletService.creditWalletTransaction(tx, {
              userId: buyer.sponsorId,
              walletType: WalletType.I_WALLET,
              amount: bonusAmt.toString(),
              txType: TransactionType.REFERRAL_INCOME,
              purpose: `Referral bonus from ${buyer.memberId}`,
              meta: { fromMemberId: buyer.memberId },
            });

            await this.addBinaryVolume(tx, buyer.id, bv);

            const html = EmailTemplates.referralIncome(
              sponsor.firstName + ' ' + sponsor.lastName,
              bonusAmt.toFixed(),
              buyer.firstName + ' ' + buyer.lastName,
              response?.balanceAfter,
            );

            await this.notificationsService.createNotificationTransaction(
              tx,
              buyer.sponsorId,
              'Referral Bonus Earned',
              `You have earned a referral bonus of $${bonusAmt.toFixed()} from ${buyer.firstName} ${buyer.lastName}'s package purchase.`,
              true,
              html,
              'New Referral Earnings Credited!',
              '/income/referral',
            );
          }
        }
      }

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
          `You have successfully purchased the ${pkg.name} package for ${user.firstName} ${user.lastName}. The package will be active from ${startDate.toDateString()} to ${endDate.toDateString()}.`,
          true,
          html,
          `You purchased ${pkg.name} for ${user.firstName} ${user.lastName}`,
          '/profile?tab=packages',
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
          `The ${pkg.name} package has been purchased for you by ${buyer.firstName} ${buyer.lastName}. It will be active from ${startDate.toDateString()} to ${endDate.toDateString()}. Enjoy the benefits of your new package!`,
          true,
          html2,
          `New Package Added to Your Account`,
          '/profile?tab=packages',
        );
      } else {
        const html = EmailTemplates.packageSelf(
          user.firstName + ' ' + user.lastName,
          pkg.name,
          amt.toFixed(),
          'Transaction Id',
          parts.map((p) => `${p.wallet}: $${p.amount}`).join(', '),
          startDate.toDateString(),
          '/profile?tab=packages',
        );

        await this.notificationsService.createNotificationTransaction(
          tx,
          user.id,
          'Package Purchased',
          `You have successfully purchased the ${pkg.name} package. It will be active from ${startDate.toDateString()} to ${endDate.toDateString()}. Enjoy the benefits of your new package!`,
          true,
          html,
          `${pkg.name} purchased successfully`,
          '/profile?tab=packages',
        );
      }
    });

    return {
      "message": "Package purchased successfully",
      "data": {
        "purchasedBy": buyer.memberId,
        "purchasedFor": user.memberId,
        "dailyRoI": pkg.dailyReturnPct,
        "totalRoI": (pkg.durationDays * Number(pkg.dailyReturnPct) / 100) * Number(dto.amount),
        "totalDays": pkg.durationDays,
        
      }
    }

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
