import { Module } from '@nestjs/common';
import { RankService } from './rank.service';
import { RankController } from './rank.controller';
import { PrismaService } from '../prisma.service';
import { WalletModule } from 'src/wallets/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [RankController],
  providers: [RankService, PrismaService],
  exports: [RankService],
})
export class RankModule {}
