import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallets/wallet.service';
import { Decimal } from 'decimal.js';
import { SETTING_TYPE, TransactionType, WalletType } from '@prisma/client';
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
    this.registerOpeningCron();
  }

  private async getCronTime(settingKey: SETTING_TYPE, fallbackTime: string) {
    const setting = await this.prisma.adminSetting.findUnique({
      where: { key: settingKey },
    });

    return setting?.value ?? fallbackTime;
  }

  async registerClosingCron() {
    const time = await this.getCronTime('BACK_OFFICE_CLOSING_TIME', '23:59');
    const [h, m] = time.split(':').map(Number);

    // cron format: m h * * *
    const cronExpr = `${m} ${h} * * *`;

    // remove old job if exists
    try {
      this.scheduler.deleteCronJob('daily-package-returns-generate-job');
    } catch (_) {}

    const job = new CronJob(
      cronExpr,
      async () => {
        await this.runDailyReturnGeneration();
      },
      null,
      false,
      APP_ZONE,
    );

    this.scheduler.addCronJob('daily-package-returns-generate-job', job);
    job.start();

    this.log.log('Daily package yield generation cron registered at ' + cronExpr);
  }

  async registerOpeningCron() {
    const time = await this.getCronTime('BACK_OFFICE_OPENING_TIME', '09:00');
    const [h, m] = time.split(':').map(Number);

    // cron format: m h * * *
    const cronExpr = `${m} ${h} * * *`;

    // remove old job if exists
    try {
      this.scheduler.deleteCronJob('daily-package-returns-credit-job');
    } catch (_) {}

    const job = new CronJob(
      cronExpr,
      async () => {
        await this.runDailyReturnCredit();
      },
      null,
      false,
      APP_ZONE,
    );

    this.scheduler.addCronJob('daily-package-returns-credit-job', job);
    job.start();

    this.log.log('Daily package credit cron registered at ' + cronExpr);
  }

  async creditPendingReturns(creditDate: Date) {

    const logs: any = await this.prisma.packageIncomeLog.findMany({
      where: {
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
    await this.runDailyReturnCredit();
    await this.runDailyReturnGeneration();
  }

  async runDailyReturnCredit() {
    const torontoNow = DateTime.now().setZone(APP_ZONE);
    const creditDate = torontoNow.startOf('day').toJSDate();

    this.log.log(
      'Running opening package credits for ' + creditDate.toDateString(),
    );

    await this.creditPendingReturns(creditDate);

    this.log.log('Opening package credit run complete');
  }

  async runDailyReturnGeneration() {
    const torontoNow = DateTime.now().setZone(APP_ZONE);

    // Normalize date (strip time)
    const creditDate = torontoNow.startOf('day').toJSDate();

    // Skip Sun
    const day = torontoNow.weekday;
    // 1 = Monday, 7 = Sunday
    if (day === 7) {
      this.log.debug(
        'Sunday — skipping package earnings generation',
      );
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
        `Holiday (${holiday.title}) — skipping package earnings generation run.`,
      );
      return;
    }

    this.log.log(
      'Running closing package yield generation for ' + creditDate.toDateString(),
    );

    // Generate today's ROI at closing (but DON'T credit)
    await this.generateTodayReturns(creditDate);

    this.log.log('Closing package yield generation run complete');
  }
}
