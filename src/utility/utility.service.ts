import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { QueryStatus } from '@prisma/client';

@Injectable()
export class UtilityService {
  constructor(private prisma: PrismaService) {}

  // 1️⃣ Submit a query (User)
  async submitQuery(userId: number, message: string) {
    if (!message?.trim()) throw new BadRequestException('Message is required');

    return this.prisma.query.create({
      data: { userId, message },
    });
  }

  // 2️⃣ Admin reply to query
  async replyToQueryAdmin(
    adminId: number,
    queryId: number,
    message: string,
  ) {
    const query = await this.prisma.query.findUnique({ where: { id: queryId } });
    if (!query) throw new NotFoundException('Query not found');

    // Add reply
    const reply = await this.prisma.queryReply.create({
      data: {
        queryId,
        message,
        userId: null, // reply by admin
      },
    });

    // Optionally auto-close query
    await this.prisma.query.update({
      where: { id: queryId },
      data: { status: 'CLOSED', updatedAt: new Date() },
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
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        replies: true,
      },
    });
  }
}

