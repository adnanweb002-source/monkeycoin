import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { WalletService } from 'src/wallets/wallet.service';
import { Decimal } from 'decimal.js';
import { WalletType, TransactionType } from '@prisma/client';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Logger } from '@nestjs/common/services/logger.service';

@Injectable()
export class BinaryEngineService {
  private readonly log = new Logger(BinaryEngineService.name);
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private scheduler: SchedulerRegistry,
  ) {
    this.registerClosingCron();
  }

  async registerClosingCron() {

    const today = new Date();

    // Skip Sat/Sun
    const day = today.getDay();
    if (day === 0 || day === 6) {
      this.log.debug('Weekend — skipping binary payout run');
      return;
    }

    // Skip holidays
    const holiday = await this.prisma.holiday.findFirst({
      where: { date: today },
    });
    if (holiday) {
      this.log.debug(
        `Holiday (${holiday.title}) — skipping binary payout run`,
      );
      return;
    }

    const setting = await this.prisma.adminSetting.findUnique({
      where: { key: 'BACK_OFFICE_CLOSING_TIME' },
    });

    const time = setting?.value ?? '23:59';
    const [h, m] = time.split(':').map(Number);

    const cronExpr = `${m} ${h} * * *`;

    try {
      this.scheduler.deleteCronJob('binary-closing-job');
    } catch (_) {}

    const job = new CronJob(cronExpr, async () => {
      await this.runDailyBinaryPayout();
    });

    this.scheduler.addCronJob('binary-closing-job', job);
    job.start();

    this.log.log('Binary payout cron registered at ' + cronExpr);
  }

  async runDailyBinaryPayout(runDate?: Date) {
    // Determine credit day based on closing time
    const creditDate = await this.resolveCreditDate(runDate);

    console.log('Running Binary Payout for', creditDate.toDateString());

    const rate = await this.getBinaryRate();

    const users = await this.prisma.user.findMany({
      where: {
        leftBv: { gt: 0 },
        rightBv: { gt: 0 },
      },
      select: {
        id: true,
        leftBv: true,
        rightBv: true,
      },
    });

    for (const u of users) {
      await this.processUserBinary(u, rate, creditDate);
    }
  }

  /** -------- Read binary % from AdminSetting -------- */
  private async getBinaryRate(): Promise<Decimal> {
    const setting = await this.prisma.adminSetting.findUnique({
      where: { key: 'BINARY_INCOME_RATE' },
    });

    if (!setting) {
      throw new Error('Binary income rate not configured');
    }

    // stored as string like "10" = 10%
    return new Decimal(setting.value).div(100);
  }

  /** -------- Resolve credit date using closing time -------- */
  private async resolveCreditDate(input?: Date): Promise<Date> {
    const closing = await this.prisma.adminSetting.findUnique({
      where: { key: 'BACK_OFFICE_CLOSING_TIME' },
    });

    const now = input ? new Date(input) : new Date();
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);

    if (!closing) return date;

    // value format expected: "23:59"
    const [h, m] = closing.value.split(':').map(Number);
    const closingToday = new Date(date);
    closingToday.setHours(h, m, 0, 0);

    // If cron ran BEFORE closing time, treat payout as previous day
    if (now < closingToday) {
      date.setDate(date.getDate() - 1);
    }

    return date;
  }

  /** -------- Core binary processing per user -------- */
  private async processUserBinary(
    user: { id: number; leftBv: any; rightBv: any },
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
      await this.walletService.creditWallet({
        userId: user.id,
        walletType: WalletType.M_WALLET,
        amount: payout.toFixed(),
        txType: TransactionType.BINARY_INCOME,
        purpose: 'Daily Binary Income',
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
