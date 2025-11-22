import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { TreeModule } from './tree/tree.module';
import { WalletModule } from './wallets/wallet.module';
@Module({
  imports: [AuthModule, TreeModule, WalletModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
