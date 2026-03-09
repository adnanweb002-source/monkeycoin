import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { Logger } from '@nestjs/common';
import { MailService } from 'src/mail/mail.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(
    private prisma: PrismaService,
    private gateway: NotificationsGateway,
    private mailService: MailService,
  ) {}

  // 🔹 CREATE (internal use)
  async createNotification(
    userId: number,
    title: string,
    description: string,
    sendMail?: boolean,
    emailHtml?: string,
    emailSubject?: string,
    redirectUrl?: string,
    createPushNotification = true,
  ) {
    /* Save notification */
    let notification: any;
    
    if (createPushNotification) {
      // Create push notification logic here
      notification = await this.prisma.notification.create({
        data: {
          userId,
          title,
          description,
          redirectionRoute: redirectUrl,
        },
      });

      /* Websocket */

      this.gateway.emitToUser(userId, notification);
    }

    /* Email */

    if (sendMail && emailHtml && emailSubject) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (user?.email) {
        await this.mailService.sendMail(user.email, emailSubject, emailHtml);
      }
    }

    return notification;
  }

  // 🔹 PAGINATED FETCH
  async getUserNotifications(userId: number, take = 10, skip = 0) {
    const [data, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    return {
      data,
      total,
      unreadCount,
    };
  }

  async markAsRead(userId: number, notificationId: number) {
    const notif = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notif) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: number) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }
}
