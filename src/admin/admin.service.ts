import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Status } from '@prisma/client';
import * as argon2 from 'argon2';

@Injectable()
export class AdminUsersService {
  constructor(private prisma: PrismaService) {}

  async suspendUser(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.status === Status.SUSPENDED) {
      throw new BadRequestException('User already suspended');
    }

    await this.prisma.$transaction(async (tx) => {
      // suspend user
      await tx.user.update({
        where: { id: userId },
        data: { status: Status.SUSPENDED },
      });

      // revoke all refresh tokens
      await tx.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });

      // audit
      await tx.auditLog.create({
        data: {
          actorType: 'admin',
          action: 'USER_SUSPENDED',
          entity: 'User',
          entityId: userId,
          after: { status: 'SUSPENDED' },
        },
      });
    });

    return { ok: true, status: 'SUSPENDED' };
  }

  async activateUser(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.status === Status.ACTIVE) {
      throw new BadRequestException('User already active');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: Status.ACTIVE },
      });

      await tx.auditLog.create({
        data: {
          actorType: 'admin',
          action: 'USER_ACTIVATED',
          entity: 'User',
          entityId: userId,
          after: { status: 'ACTIVE' },
        },
      });
    });

    return { ok: true, status: 'ACTIVE' };
  }

  async adminDisable2fa(adminId: number, userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { twoFactorSecret: true },
    });

    if (!user) throw new BadRequestException('User not found');

    if (!user.twoFactorSecret) {
      return { ok: true, message: '2FA already disabled' };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.twoFactorSecret.delete({
        where: { userId },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          isG2faEnabled: false,
          g2faSecret: '',
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorType: 'admin',
          action: 'DISABLE_2FA',
          entity: 'User',
          entityId: userId,
        },
      });
    });

    return { ok: true };
  }

  async adminSetPassword(adminId: number, userId: number, newPassword: string) {
    const hash = await argon2.hash(newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: hash },
      });

      await tx.refreshToken.updateMany({
        where: { userId },
        data: { revoked: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorType: 'admin',
          action: 'RESET_PASSWORD',
          entity: 'User',
          entityId: userId,
        },
      });
    });

    return { ok: true };
  }
}
