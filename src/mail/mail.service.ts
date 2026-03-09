  import { Injectable, Logger } from '@nestjs/common';
  import { ConfigService } from '@nestjs/config';
  import * as nodemailer from 'nodemailer';

  @Injectable()
  export class MailService {
    private transporter: nodemailer.Transporter;
    private logger = new Logger(MailService.name);

    constructor(private cfg: ConfigService) {
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
      try {
        const info = await this.transporter.sendMail({
          from: this.cfg.get<string>('SMTP_FROM'),
          to,
          subject,
          text: body,
          html: `<p>${body.replace(/\n/g, '<br/>')}</p>`,
        });

        this.logger.log(`Email sent to ${to}: ${info.messageId}`);

        return true;
      } catch (error) {
        this.logger.error(`Failed to send email to ${to}`, error);
        throw error;
      }
    }
  }
