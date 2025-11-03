import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  constructor(private cfg: ConfigService) {}

  async sendMail(to: string, subject: string, body: string) {
    // Implement actual email sending here. For now, just log.
    Logger.log(`Sending email to ${to}: ${subject} - ${body}`);
    return true;
  }
}
