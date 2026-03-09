import { Module } from '@nestjs/common';
import { NotificationsService } from './notifcations.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { PrismaService } from '../prisma.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MailModule } from 'src/mail/mail.module';

@Module({
  imports: [JwtModule.register({}), MailModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    PrismaService,
    ConfigService,

  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}