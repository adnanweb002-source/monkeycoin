import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { WalletService } from 'src/wallets/wallet.service';
import { Decimal } from 'decimal.js';
import { WalletType, TransactionType } from '@prisma/client';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Logger } from '@nestjs/common/services/logger.service';
import { NotificationsService } from 'src/notifications/notifcations.service';
import { SETTING_TYPE } from '@prisma/client';
import { EmailTemplates } from 'src/mail/templates/email.templates';
import { DateTime } from 'luxon';

@Injectable()
export class BinaryEngineService {
  private readonly log = new Logger(BinaryEngineService.name);
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private scheduler: SchedulerRegistry,
    private notificationsService: NotificationsService,
  ) {
    this.registerClosingCron();
  }

  async registerClosingCron() {
    const setting = await this.prisma.adminSetting.findUnique({
      where: { key: SETTING_TYPE.BACK_OFFICE_OPENING_TIME },
    });

    const time = setting?.value ?? '00:00';
    const [h, m] = time.split(':').map(Number);

    const cronExpr = `${m} ${h} * * *`;

    try {
      this.scheduler.deleteCronJob('binary-closing-job');
    } catch (_) {}

    const job = new CronJob(
      cronExpr,
      async () => {
        await this.runDailyBinaryPayout();
      },
      null,
      false,
      'America/Toronto',
    );

    this.scheduler.addCronJob('binary-closing-job', job);
    job.start();

    this.log.log('Binary payout cron registered at ' + cronExpr);
  }

  async runDailyBinaryPayout(runDate?: Date) {
    // Determine credit day based on closing time
    const creditDate = await this.resolveCreditDate(runDate);

    const torontoNow = DateTime.now().setZone('America/Toronto');

    const start = torontoNow.startOf('day').toJSDate();
    const end = torontoNow.endOf('day').toJSDate();

    const holiday = await this.prisma.holiday.findFirst({
      where: {
        date: {
          gte: start,
          lte: end,
        },
      },
    });
    if (holiday) {
      this.log.debug(`Holiday (${holiday.title}) — skipping binary payout run`);
      return;
    }

    // Skip Sat/Sun
    const day = torontoNow.weekday;
    if (day === 7) {
      this.log.debug('Weekend — skipping binary payout run');
      return;
    }

    console.log('Running Binary Payout for', creditDate.toDateString());

    const rate = await this.getBinaryRate();

    const users = await this.prisma.user.findMany({
      where: {
        leftBv: { gt: 0 },
        rightBv: { gt: 0 },
        activePackageCount: { gt: 0 },
      },
      select: {
        id: true,
        leftBv: true,
        rightBv: true,
        firstName: true,
        lastName: true,
      },
    });

    for (const u of users) {
      await this.processUserBinary(u, rate, creditDate);
    }
  }

  private parseRate(value?: string | null): Decimal {
    if (!value) return new Decimal(0);

    const raw = value.trim();

    if (raw.endsWith('%')) {
      return new Decimal(raw.replace('%', '')).div(100);
    }

    return new Decimal(raw);
  }

  /** -------- Read binary % from AdminSetting -------- */
  private async getBinaryRate(): Promise<Decimal> {
    const setting = await this.prisma.adminSetting.findUnique({
      where: { key: SETTING_TYPE.BINARY_INCOME_RATE },
    });

    if (!setting) {
      throw new Error('Binary income rate not configured');
    }

    return this.parseRate(setting.value);
  }

  /** -------- Resolve credit date using closing time -------- */
  private async resolveCreditDate(input?: Date): Promise<Date> {
    const closing = await this.prisma.adminSetting.findUnique({
      where: { key: SETTING_TYPE.BACK_OFFICE_OPENING_TIME },
    });

    const now = input
      ? DateTime.fromJSDate(input).setZone('America/Toronto')
      : DateTime.now().setZone('America/Toronto');

    let businessDate = now.startOf('day');

    if (!closing) return businessDate.toJSDate();

    const [h, m] = closing.value.split(':').map(Number);

    const closingToday = businessDate.set({
      hour: h,
      minute: m,
      second: 0,
      millisecond: 0,
    });

    // If BEFORE closing → treat as previous business day
    if (now < closingToday) {
      businessDate = businessDate.minus({ days: 1 });
    }

    return businessDate.toJSDate();
  }

  /** -------- Core binary processing per user -------- */
  private async processUserBinary(
    user: {
      id: number;
      leftBv: any;
      rightBv: any;
      firstName: string;
      lastName: string;
    },
    rate: Decimal,
    creditDate: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Prevent duplicate payout for the same day
      const exists = await tx.binaryPayoutLog.findUnique({
        where: { userId_date: { userId: user.id, date: creditDate } },
      });

      if (exists) return;

      const left = new Decimal(user.leftBv.toString());
      const right = new Decimal(user.rightBv.toString());

      const weak = Decimal.min(left, right);
      if (weak.lte(0)) return;

      const payout = weak.mul(rate);

      // 1️⃣ Credit M-Wallet
      await this.walletService.creditWalletTransaction(tx, {
        userId: user.id,
        walletType: WalletType.P_WALLET,
        amount: payout.toFixed(),
        txType: TransactionType.BINARY_INCOME,
        purpose: 'Binary Income',
        meta: {
          weakVolume: weak.toFixed(),
          rate: rate.mul(100).toFixed(),
          creditDate,
        },
      });

      // 2️⃣ Deduct matched volume
      await tx.user.update({
        where: { id: user.id },
        data: {
          leftBv: left.minus(weak).toFixed(),
          rightBv: right.minus(weak).toFixed(),
        },
      });

      const html = EmailTemplates.binaryIncome(
        user.firstName + ' ' + user.lastName,
        payout.toFixed(),
        left.toFixed(),
        right.toFixed(),
        Decimal.max(left.minus(weak), right.minus(weak)).toFixed(),
      );
      await this.notificationsService.createNotification(
        user.id,
        'Binary Income Credited',
        `Your binary income of $${payout.toFixed()} has been credited to your M-Wallet for ${creditDate.toDateString()}. Keep up the good work!`,
        true,
        html,
        'Binary Earnings Notification',
        '/income/binary',
      );

      // 3️⃣ Log payout
      await tx.binaryPayoutLog.create({
        data: {
          userId: user.id,
          volumePaid: weak.toFixed(),
          payoutAmt: payout.toFixed(),
          leftBefore: left.toFixed(),
          rightBefore: right.toFixed(),
          date: creditDate,
        },
      });
    });
  }
}
