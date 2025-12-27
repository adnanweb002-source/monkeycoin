import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallets/wallet.service';
import { Decimal } from 'decimal.js';
import { TransactionType, WalletType } from '@prisma/client';

@Injectable()
export class PackagesCronService {
  private readonly log = new Logger(PackagesCronService.name);

  constructor(
    private prisma: PrismaService,
    private wallets: WalletService,
  ) {}

  // Runs Mon–Fri at 00:10 server time
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailyReturns() {
    const today = new Date();

    // Skip Sat/Sun
    const day = today.getDay();
    if (day === 0 || day === 6) {
      this.log.debug('Weekend — skipping package earnings run');
      return;
    }

    // Normalize date (strip time)
    const creditDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );

    this.log.log('Running daily package credits for ' + creditDate.toDateString());

    // Get active packages that have started and not expired
    const purchases = await this.prisma.packagePurchase.findMany({
      where: {
        status: 'ACTIVE',
        startDate: { lte: creditDate },
        endDate: { gt: creditDate },
      },
      include: { package: true },
    });

    for (const p of purchases) {
      try {
        // Idempotency — skip if already credited today
        const exists = await this.prisma.packageIncomeLog.findUnique({
          where: { purchaseId_creditDate: { purchaseId: p.id, creditDate } },
        });
        if (exists) continue;

        const dailyPct = new Decimal(p.package.dailyReturnPct);
        const amount = new Decimal(p.amount)
          .mul(dailyPct)
          .div(100)
          .toDecimalPlaces(2);

        await this.prisma.$transaction(async (tx) => {
          // Credit M wallet
          await this.wallets.creditWallet({
            userId: p.userId,
            walletType: WalletType.M_WALLET,
            amount: amount.toFixed(),
            txType: TransactionType.ROI_CREDIT,
            purpose: `Daily return for package ${p.package.name}`,
            meta: { purchaseId: p.id, date: creditDate },
          });

          // Log credit to prevent duplicates
          await tx.packageIncomeLog.create({
            data: {
              purchaseId: p.id,
              creditDate,
              amount: amount.toFixed(),
            },
          });
        });

      } catch (err) {
        this.log.error(
          `Package credit failed purchase=${p.id} user=${p.userId}`,
          err.stack ?? err,
        );
      }
    }

    this.log.log('Daily package credit run complete');
  }
}
