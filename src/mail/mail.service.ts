import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailQueue } from './mail.queue';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private logger = new Logger(MailService.name);

  constructor(
    private cfg: ConfigService,
    private mailQueue: MailQueue,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.cfg.get<string>('SMTP_HOST'),
      port: Number(this.cfg.get<string>('SMTP_PORT')) || 587,
      secure: false,
      auth: {
        user: this.cfg.get<string>('SMTP_USER'),
        pass: this.cfg.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendMail(to: string, subject: string, body: string) {
    await this.mailQueue.addEmailJob({
      to,
      subject,
      body,
    });

    return true;
  }
}
