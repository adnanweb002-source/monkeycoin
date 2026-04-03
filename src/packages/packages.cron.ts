import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallets/wallet.service';
import { Decimal } from 'decimal.js';
import { TransactionType, WalletType } from '@prisma/client';
import { NotificationsService } from 'src/notifications/notifcations.service';
import { DateTime } from 'luxon';
import { APP_ZONE } from '../common/toronto-time';

@Injectable()
export class PackagesCronService {
  private readonly log = new Logger(PackagesCronService.name);

  constructor(
    private prisma: PrismaService,
    private wallets: WalletService,
    private scheduler: SchedulerRegistry,
    private notificationsService: NotificationsService,
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

    const job = new CronJob(
      cronExpr,
      async () => {
        await this.runDailyReturns();
      },
      null,
      false,
      APP_ZONE,
    );

    this.scheduler.addCronJob('daily-package-returns-job', job);
    job.start();

    this.log.log('Daily package returns cron registered at ' + cronExpr);
  }

  async creditPendingReturns(creditDate: Date) {
    const yesterday = DateTime.fromJSDate(creditDate)
      .setZone(APP_ZONE)
      .startOf('day')
      .minus({ days: 1 })
      .toJSDate();

    const logs: any = await this.prisma.packageIncomeLog.findMany({
      where: {
        creditDate: yesterday,
        status: 'PENDING',
      },
      include: {
        purchase: {
          include: {
            package: {},
          },
        },
      },
    });

    for (const log of logs) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.wallets.creditWallet({
            userId: log.purchase.userId,
            walletType: WalletType.E_WALLET,
            amount: log.amount,
            txType: TransactionType.ROI_CREDIT,
            purpose: `Daily return for package ${log.purchase.package.name}`,
            meta: {
              date: log.creditDate,
              packageName: log.purchase.package.name,
            },
          });

          await this.notificationsService.createNotification(
            log.purchase.userId,
            'Daily Package Return',
            `Your package ${log.purchase.package.name} generated $${log.amount} yesterday. It has now been credited.`,
            false,
          );

          await tx.packageIncomeLog.update({
            where: { id: log.id },
            data: { status: 'CREDITED' },
          });
        });
      } catch (err) {
        this.log.error(`Credit failed log=${log.id}`, err);
      }
    }
  }

  async generateTodayReturns(creditDate: Date) {
    const purchases = await this.prisma.packagePurchase.findMany({
      where: {
        status: 'ACTIVE',
        startDate: { lte: creditDate },
        endDate: { gt: creditDate },
      },
      include: { package: true },
    });

    for (const p of purchases) {
      const exists = await this.prisma.packageIncomeLog.findUnique({
        where: {
          purchaseId_creditDate: {
            purchaseId: p.id,
            creditDate,
          },
        },
      });

      if (exists) continue;

      const dailyPct = new Decimal(p.package.dailyReturnPct);
      const amount = new Decimal(p.amount)
        .mul(dailyPct)
        .div(100)
        .toDecimalPlaces(2);

      await this.prisma.packageIncomeLog.create({
        data: {
          purchaseId: p.id,
          creditDate,
          amount: amount.toFixed(),
          status: 'PENDING',
        },
      });
    }
  }

  async runDailyReturns() {
    const torontoNow = DateTime.now().setZone(APP_ZONE);

    // Normalize date (strip time)
    const creditDate = torontoNow.startOf('day').toJSDate();

    // Skip Sun
    const day = torontoNow.weekday;
    // 1 = Monday, 7 = Sunday
    if (day === 7) {
      this.log.debug(
        'Sunday — skipping package earnings generation, crediting for Saturday',
      );
      await this.creditPendingReturns(creditDate);
      return;
    }

    const start = torontoNow.startOf('day').toJSDate();
    const end = torontoNow.endOf('day').toJSDate();

    // Skip holidays
    const holiday = await this.prisma.holiday.findFirst({
      where: {
        date: {
          gte: start,
          lte: end,
        },
      },
    });

    if (holiday) {
      this.log.debug(
        `Holiday (${holiday.title}) — skipping package earnings generation run. Crediting for yesterdat`,
      );
      await this.creditPendingReturns(creditDate);
      return;
    }

    this.log.log(
      'Running daily package credits for ' + creditDate.toDateString(),
    );

    // STEP 1: Credit yesterday's ROI
    await this.creditPendingReturns(creditDate);

    // STEP 2: Generate today's ROI (but DON'T credit)
    await this.generateTodayReturns(creditDate);

    this.log.log('Daily package credit run complete');
  }
}
