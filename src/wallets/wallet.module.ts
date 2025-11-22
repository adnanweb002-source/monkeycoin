import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PrismaService } from '../prisma.service';

@Module({
  providers: [WalletService, PrismaService],
  controllers: [WalletController],
  exports: [WalletService],    // <-- IMPORTANT
})
export class WalletModule {}
