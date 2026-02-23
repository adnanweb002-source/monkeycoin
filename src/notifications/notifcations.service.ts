import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { Logger } from '@nestjs/common';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(
    private prisma: PrismaService,
    private gateway: NotificationsGateway,
  ) {}

  // 🔹 CREATE (internal use)
  async createNotification(
    userId: number,
    title: string,
    description: string,
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        title,
        description,
      },
    });

    // 🔥 Realtime push
    this.gateway.emitToUser(userId, notification);

    return notification;
  }

  // 🔹 PAGINATED FETCH
  async getUserNotifications(
    userId: number,
    take = 10,
    skip = 0,
  ) {
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