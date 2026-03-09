import { Module } from '@nestjs/common';
import { NotificationsService } from './notifcations.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { PrismaService } from '../prisma.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {MailService} from 'src/mail/mail.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    PrismaService,
    ConfigService,
    MailService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}