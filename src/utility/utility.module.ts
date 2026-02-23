import { Module } from '@nestjs/common';
import { UtilityController } from './utility.controller';
import { UtilityService } from './utility.service';
import { PrismaService } from '../prisma.service';
import { NowPaymentsService } from 'src/wallets/deposit-gateway.service';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [UtilityController],
  providers: [
    UtilityService,
    PrismaService,
    NowPaymentsService,
  ],
  exports: [UtilityService],
})
export class UtilityModule {}
