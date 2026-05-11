import { Injectable, INestApplication, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

function parsePositiveMs(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({
      transactionOptions: {
        maxWait: parsePositiveMs(
          process.env.PRISMA_TRANSACTION_MAX_WAIT_MS,
          10_000,
        ),
        timeout: parsePositiveMs(
          process.env.PRISMA_TRANSACTION_TIMEOUT_MS,
          60_000,
        ),
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    // use process.on instead of this.$on
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
