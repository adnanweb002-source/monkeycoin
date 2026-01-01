import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Status } from '@prisma/client';
import * as argon2 from 'argon2';
import { WalletService } from 'src/wallets/wallet.service';

@Injectable()
export class AdminUsersService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
  ) {}

  async getAllUsers(take: number, skip: number) {
    const users = await this.prisma.user.findMany({
      skip,
      take,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        memberId: true,
        status: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        isWithdrawalRestricted: true,
        externalWallets: {
          include: {
            supportedWallet: true   // <-- fetch related wallet type
          }
    },
      },
    });
    const total = await this.prisma.user.count();

    return { users, total };
  }

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

  async restrictUserWithdrawal(
    adminId: number,
    userId: number,
    restrict: boolean,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new BadRequestException('User not found');

    if (user.isWithdrawalRestricted === true && restrict) {
      return { ok: true, message: `Withdrawal restriction already in place` };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          isWithdrawalRestricted: restrict,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorType: 'admin',
          action: restrict ? 'RESTRICT_WITHDRAWAL' : 'UNRESTRICT_WITHDRAWAL',
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

  async ensureCompanyAccount() {
    let company = await this.prisma.user.findFirst({
      where: { memberId: 'COMPANY' },
    });

    if (company)
      return {
        created: false,
        id: company.id,
        message: 'Company account already exists',
      };

    const companyPassword = await argon2.hash('company_secure_password');

    const result = await this.prisma.$transaction(async (tx) => {
      const newCompany = await tx.user.create({
        data: {
          id: 1,
          memberId: 'COMPANY',
          firstName: 'Monkey',
          lastName: 'Coin',
          email: 'company@monkeycoin.com',
          passwordHash: companyPassword,
          sponsorId: null,
          parentId: null,
          position: 'LEFT',
          status: 'ACTIVE',
          g2faSecret: '',
          isG2faEnabled: false,
          role: 'ADMIN',
        },
      });

      await this.walletService.createWalletsForUser(tx, newCompany.id);

      return newCompany;
    });

    return { created: true, id: result.id, message: 'Company account created' };
  }

  async pruneSystem(adminId: number, confirm: string) {
    if (!confirm) {
      throw new BadRequestException(
        'Prune operation not confirmed. Pass confirm=true',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // keep company root
      const company = await tx.user.findUnique({
        where: { memberId: 'COMPANY' },
      });

      // 1️⃣ Delete dependent tables first
      await tx.packageIncomeLog.deleteMany({});
      await tx.packagePurchase.deleteMany({});
      await tx.walletTransaction.deleteMany({});
      await tx.withdrawalRequest.deleteMany({});
      await tx.depositRequest.deleteMany({});
      await tx.wallet.deleteMany({
        where: { userId: { not: company?.id ?? -1 } },
      });
      await tx.queryReply.deleteMany({});
      await tx.query.deleteMany({});
      await tx.refreshToken.deleteMany({});
      await tx.twoFactorSecret.deleteMany({});
      await tx.auditLog.deleteMany({});

      // 2️⃣ Delete all users except COMPANY
      await tx.user.deleteMany({
        where: { id: { not: company?.id ?? -1 } },
      });

      // 3️⃣ Reset BV values on company account
      if (company) {
        await tx.user.update({
          where: { id: company.id },
          data: { leftBv: 0, rightBv: 0 },
        });
      }

      // 4️⃣ Write audit event
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorType: 'admin',
          action: 'SYSTEM_PRUNE',
          entity: 'System',
          before: {},
          after: { pruned: true },
        },
      });

      return { ok: true };
    });
  }
}
