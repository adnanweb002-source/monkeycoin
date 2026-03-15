import { Worker } from 'bullmq';
import * as nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

new Worker(
  'mail-queue',
  async (job) => {
    const { to, subject, body } = job.data;

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text: body.replace(/<[^>]*>/g, ''),
      html: body,
    });
  },
  {
    connection: {
      host: 'redis',
      port: 6379,
    },
  },
);