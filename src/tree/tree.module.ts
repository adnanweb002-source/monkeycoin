import { Module } from '@nestjs/common';
import { TreeController } from './tree.controller';
import { TreeService } from './tree.service';
import { PrismaService } from '../prisma.service';
import { BinaryEngineService } from './binary-engine.service';
import { WalletService } from 'src/wallets/wallet.service';

@Module({
  controllers: [TreeController],
  providers: [TreeService, PrismaService, BinaryEngineService, WalletService],
})
export class TreeModule {}
