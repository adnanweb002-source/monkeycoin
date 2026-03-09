import { Queue } from 'bullmq';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MailQueue {
  private queue: Queue;

  constructor() {
    this.queue = new Queue('mail-queue', {
      connection: {
        host: 'redis',
        port: 6379,
      },
    });
  }

  async addEmailJob(data: {
    to: string;
    subject: string;
    body: string;
  }) {
    await this.queue.add('send-email', data, {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}