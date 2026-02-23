import { Module } from '@nestjs/common';
import { PackagesService } from './packages.service';
import { PackagesController } from './packages.controller';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallets/wallet.service';
import { PackagesCronService } from './packages.cron';
import { TreeService } from 'src/tree/tree.service';
import { NowPaymentsService } from 'src/wallets/deposit-gateway.service';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [PackagesController],
  providers: [
    PackagesService,
    PrismaService,
    WalletService,
    PackagesCronService,
    TreeService,
    NowPaymentsService,
  ],
  exports: [PackagesService],
})
export class PackagesModule {}
