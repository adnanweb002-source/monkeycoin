import { Module } from '@nestjs/common';
import { AdminUsersController, AdminController } from './admin.controller';
import { AdminUsersService } from './admin.service';
import { PrismaService } from '../prisma.service';
import { WalletService } from 'src/wallets/wallet.service';

@Module({
  controllers: [AdminUsersController, AdminController],
  providers: [AdminUsersService, PrismaService, WalletService],
  exports: [AdminUsersService],
})
export class AdminModule {}
