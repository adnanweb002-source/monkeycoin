import { Module } from '@nestjs/common';
import { RankService } from './rank.service';
import { RankController } from './rank.controller';
import { AdminController } from 'src/admin/admin.controller';
import { PrismaService } from '../prisma.service';
import { WalletModule } from 'src/wallets/wallet.module';
import { WalletService } from 'src/wallets/wallet.service';
import { NotificationsService } from 'src/notifications/notifcations.service';
import { NowPaymentsService } from 'src/wallets/deposit-gateway.service';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { MailService } from 'src/mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MailQueue } from 'src/mail/mail.queue';
import { AdminUsersService } from 'src/admin/admin.service';
import { PackagesCronService } from 'src/packages/packages.cron';
import { TwoFactorService } from 'src/auth/twofactor.service';
@Module({
  controllers: [
    RankController,
    AdminController,
  ],
  providers: [
    RankService,
    WalletService,
    PrismaService,
    NotificationsService,
    NowPaymentsService,
    NotificationsGateway,
    MailService,
    JwtService,
    ConfigService,
    MailQueue,
    AdminUsersService,
    PackagesCronService,
    TwoFactorService
  ],
  exports: [RankService],
})
export class RankModule {}
