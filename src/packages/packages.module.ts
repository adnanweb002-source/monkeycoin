import { Module } from '@nestjs/common';
import { PackagesService } from './packages.service';
import { PackagesController } from './packages.controller';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallets/wallet.service';

@Module({
  controllers: [PackagesController],
  providers: [PackagesService, PrismaService, WalletService],
  exports: [PackagesService],
})
export class PackagesModule {}
