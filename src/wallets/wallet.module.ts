import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PrismaService } from '../prisma.service';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { NowPaymentsService } from './deposit-gateway.service';
@Module({
  imports: [NotificationsModule],
  providers: [WalletService, PrismaService, NowPaymentsService],
  controllers: [WalletController],
  exports: [WalletService],    // <-- IMPORTANT
})
export class WalletModule {}
