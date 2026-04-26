import { Module } from '@nestjs/common';
import { TreeController } from './tree.controller';
import { TreeService } from './tree.service';
import { PrismaService } from '../prisma.service';
import { BinaryEngineService } from './binary-engine.service';
import { WalletService } from 'src/wallets/wallet.service';
import { NowPaymentsService } from 'src/wallets/deposit-gateway.service';
import { NotificationsModule } from 'src/notifications/notifications.module';
@Module({
  imports: [NotificationsModule],
  controllers: [TreeController],
  providers: [TreeService, PrismaService, BinaryEngineService, WalletService, NowPaymentsService],
  exports: [BinaryEngineService],
})
export class TreeModule {}
