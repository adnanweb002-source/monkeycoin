import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
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
    private scheduler: SchedulerRegistry,
  ) {
    this.registerClosingCron();
  }

  async registerClosingCron() {
    const setting = await this.prisma.adminSetting.findUnique({
      where: { key: 'BACK_OFFICE_CLOSING_TIME' },
    });

    const time = setting?.value ?? '23:59'; // fallback midnight
    const [h, m] = time.split(':').map(Number);

    // cron format: m h * * *
    const cronExpr = `${m} ${h} * * *`;

    // remove old job if exists
    try {
      this.scheduler.deleteCronJob('daily-package-returns-job');
    } catch (_) {}

    const job = new CronJob(cronExpr, async () => {
      await this.runDailyReturns();
    });

    this.scheduler.addCronJob('daily-package-returns-job', job);
    job.start();

    this.log.log('Daily package returns cron registered at ' + cronExpr);

  }

  async runDailyReturns() {
    const today = new Date();

    // Skip Sat/Sun
    const day = today.getDay();
    if (day === 0 || day === 6) {
      this.log.debug('Weekend — skipping package earnings run');
      return;
    }

    // Skip holidays
    const holiday = await this.prisma.holiday.findFirst({
      where: { date: today },
    });
    if (holiday) {
      this.log.debug(
        `Holiday (${holiday.title}) — skipping package earnings run`,
      );
      return;
    }

    // Normalize date (strip time)
    const creditDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );

    this.log.log(
      'Running daily package credits for ' + creditDate.toDateString(),
    );

    // Get active packages that have started and not expired
    const purchases = await this.prisma.packagePurchase.findMany({
      where: {
        status: 'ACTIVE',
        startDate: { lte: creditDate },
        endDate: { gt: creditDate },
      },
      include: { package: true },
    });

    console.log('Found purchases for daily credit:', purchases.length);

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
