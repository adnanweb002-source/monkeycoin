import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { TreeModule } from './tree/tree.module';
import { WalletModule } from './wallets/wallet.module';
import { PackagesModule } from './packages/packages.module';
import { AdminModule } from './admin/admin.module';
import { UtilityModule } from './utility/utility.module';
import { ScheduleModule } from '@nestjs/schedule';
import { MetricsModule } from './metrics/metrics.module';
import { RankModule } from './rankandrewards/ranks.module';
import { TargetsModule } from './targets/targets.module';
import { CsrfMiddleware } from './common/csrf.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60000, limit: 300 }],
    }),
    AuthModule,
    TreeModule,
    WalletModule,
    PackagesModule,
    AdminModule,
    UtilityModule,
    MetricsModule,
    RankModule,
    TargetsModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService, CsrfMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}
