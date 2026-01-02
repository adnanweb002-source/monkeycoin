import { Module } from '@nestjs/common';
import { AdminUsersController, AdminController } from './admin.controller';
import { AdminUsersService } from './admin.service';
import { PrismaService } from '../prisma.service';
import { WalletService } from 'src/wallets/wallet.service';
import { PackagesCronService } from 'src/packages/packages.cron';
import { NowPaymentsService } from 'src/wallets/deposit-gateway.service';

@Module({
  controllers: [AdminUsersController, AdminController],
  providers: [AdminUsersService, PrismaService, WalletService, PackagesCronService, NowPaymentsService],
  exports: [AdminUsersService],
})
export class AdminModule {}
