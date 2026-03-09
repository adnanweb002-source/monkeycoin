import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailQueue } from './mail.queue';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [MailService, MailQueue],
  exports: [MailService, MailQueue], // VERY IMPORTANT
})
export class MailModule {}