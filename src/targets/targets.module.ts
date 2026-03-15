import { Module } from '@nestjs/common';
import { TargetsService } from './targets.service';
import { TargetsController } from './targets.controller';
import { PrismaService } from '../prisma.service';
import { PackagesService } from 'src/packages/packages.service';
import { WalletModule } from 'src/wallets/wallet.module';
import { TreeService } from 'src/tree/tree.service';
import { NotificationsService } from 'src/notifications/notifcations.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { MailService } from 'src/mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MailQueue } from 'src/mail/mail.queue';
@Module({
  imports: [WalletModule],
  controllers: [TargetsController],
  providers: [
    TargetsService,
    PrismaService,
    PackagesService,
    TreeService,
    NotificationsService,
    NotificationsGateway,
    MailService,
    JwtService,
    ConfigService,
    MailQueue
  ],
})
export class TargetsModule {}