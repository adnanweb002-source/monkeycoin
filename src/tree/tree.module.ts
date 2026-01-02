import { Module } from '@nestjs/common';
import { TreeController } from './tree.controller';
import { TreeService } from './tree.service';
import { PrismaService } from '../prisma.service';
import { BinaryEngineService } from './binary-engine.service';
import { WalletService } from 'src/wallets/wallet.service';
import { NowPaymentsService } from 'src/wallets/deposit-gateway.service';

@Module({
  controllers: [TreeController],
  providers: [TreeService, PrismaService, BinaryEngineService, WalletService, NowPaymentsService],
})
export class TreeModule {}
