import { Module } from '@nestjs/common';
import { AdminUsersController, AdminController } from './admin.controller';
import { AdminUsersService } from './admin.service';
import { PrismaService } from '../prisma.service';
import { WalletService } from 'src/wallets/wallet.service';
import { PackagesCronService } from 'src/packages/packages.cron';
import { NowPaymentsService } from 'src/wallets/deposit-gateway.service';
import { AuthService } from 'src/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TwoFactorService } from 'src/auth/twofactor.service';
import { MailService } from 'src/auth/mail.service';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AdminUsersController, AdminController],
  providers: [
    AdminUsersService,
    PrismaService,
    WalletService,
    PackagesCronService,
    NowPaymentsService,
    AuthService,
    JwtService,
    ConfigService,
    TwoFactorService,
    MailService,
  ],
  exports: [AdminUsersService],
})
export class AdminModule {}
