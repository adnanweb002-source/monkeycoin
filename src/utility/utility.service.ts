import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from 'src/notifications/notifcations.service';
import { QueryStatus } from '@prisma/client';
import { nowInstant } from '../common/toronto-time';


@Injectable()
export class UtilityService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) { }

  // 1️⃣ Submit a query (User)
  async submitQuery(userId: number, message: string) {
    if (!message?.trim()) throw new BadRequestException('Message is required');

    const created = await this.prisma.query.create({
      data: { userId, message },
    });

    await this.notificationsService.createNotification(
      userId,
      'Query Submitted',
      'Your query has been submitted successfully. Our support team will get back to you shortly.',
      false,
      undefined,
      undefined,
      '/support'
    );
    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: 'user',
        action: 'QUERY_SUBMITTED',
        entity: 'Query',
        entityId: created.id,
        after: {
          status: created.status,
          message,
        },
      },
    });
    return { ok: true, message: 'Query submitted successfully' };
  }

  async replyToQueryUser(userId: number, queryId: number, message: string) {
    const query = await this.prisma.query.findUnique({
      where: { id: queryId },
    });
    if (!query) throw new NotFoundException('Query not found');

    if (query.userId !== userId) throw new BadRequestException('You are not allowed to reply to this query');

    // Add reply
    const reply = await this.prisma.queryReply.create({
      data: {
        queryId,
        message,
        userId: userId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: 'user',
        action: 'QUERY_REPLIED_BY_USER',
        entity: 'QueryReply',
        entityId: reply.id,
        after: {
          queryId,
          message,
        },
      },
    });

    return reply;
  }

  // 2️⃣ Admin reply to query
  async replyToQueryAdmin(adminId: number, queryId: number, message: string, shouldClose: boolean) {
    const query = await this.prisma.query.findUnique({
      where: { id: queryId },
    });
    if (!query) throw new NotFoundException('Query not found');

    // Add reply
    const reply = await this.prisma.queryReply.create({
      data: {
        queryId,
        message,
        userId: null, // reply by admin
      },
    });

    if (shouldClose) {
      await this.prisma.query.update({
        where: { id: queryId },
        data: { status: 'CLOSED', updatedAt: nowInstant() },
      });
    }

    let notification = `Your query has been answered by our support team. Please check the response and let us know if you have any further questions.`;

    if (shouldClose) {
      notification = `Your query has been answered and closed by our support team. Please check the response and let us know if you have any further questions.`;
    }

    await this.notificationsService.createNotification(
      query.userId,
      'Query Answered',
      message,
      false,
      undefined,
      undefined,
      '/support'
    );

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        actorType: 'admin',
        action: shouldClose ? 'QUERY_REPLIED_AND_CLOSED_BY_ADMIN' : 'QUERY_REPLIED_BY_ADMIN',
        entity: 'Query',
        entityId: queryId,
        before: {
          status: query.status,
        },
        after: {
          replyId: reply.id,
          status: shouldClose ? 'CLOSED' : query.status,
        },
      },
    });

    return reply;
  }

  // 3️⃣ Get user queries (paginated)
  async getUserQueries(userId: number, skip = 0, take = 20) {
    return this.prisma.query.findMany({
      where: { userId },
      skip,
      take,
      orderBy: { id: 'desc' },
      include: { replies: true },
    });
  }

  // 4️⃣ Admin — Get all queries (paginated)
  async getAllQueries(skip = 0, take = 20, status?: QueryStatus) {
    return this.prisma.query.findMany({
      where: status ? { status } : {},
      skip,
      take,
      orderBy: { id: 'desc' },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        replies: true,
      },
    });
  }

  // USER — VIEW HOLIDAYS
  async listHolidays() {
    return this.prisma.holiday.findMany({
      orderBy: { date: 'asc' },
    });
  }

  // ADMIN — CREATE / UPDATE / DELETE
  async createHoliday(adminId: number, dto: { title: string; date: Date, type: string }) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.holiday.create({ data: dto });
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorType: 'admin',
          action: 'HOLIDAY_CREATED',
          entity: 'Holiday',
          entityId: created.id,
          after: created,
        },
      });
      return created;
    });
  }

  async updateHoliday(
    id: number,
    dto: Partial<{
      title: string;
      date: Date;
      type: string;
    }>,
    adminId?: number,
  ) {
    const existing = await this.prisma.holiday.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Holiday not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.holiday.update({
        where: { id },
        data: dto,
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorType: 'admin',
          action: 'HOLIDAY_UPDATED',
          entity: 'Holiday',
          entityId: id,
          before: existing,
          after: updated,
        },
      });
      return updated;
    });
  }

  async deleteHoliday(id: number, adminId?: number) {
    const existing = await this.prisma.holiday.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Holiday not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.holiday.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorType: 'admin',
          action: 'HOLIDAY_DELETED',
          entity: 'Holiday',
          entityId: id,
          before: existing,
          after: { deleted: true },
        },
      });
    });
    return { ok: true };
  }
}
