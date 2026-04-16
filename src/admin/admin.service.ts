import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { randomUUID } from 'crypto';
import { Position, Status, SETTING_TYPE } from '@prisma/client';
import * as argon2 from 'argon2';
import { WalletService } from 'src/wallets/wallet.service';
import { AuthService } from 'src/auth/auth.service';
import { TwoFactorService } from 'src/auth/twofactor.service';
import { CreateRankDto } from './dto/create-rank.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateDepositBonusDto } from './dto/create-deposit-bonus.dto';
import { UpdateDepositBonusDto } from './dto/update-deposit-bonus.dto';
import {
  parseAdminDateEnd,
  parseAdminDateStart,
} from '../common/toronto-time';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

@Injectable()
export class AdminUsersService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private authService: AuthService,
    private twoFactorService: TwoFactorService,
  ) { }

  async getAllUsers(
    take: number,
    skip: number,
    memberId?: string,
  ) {
    const users = await this.prisma.user.findMany({
      where: {
        memberId: {
          not: 'COMPANY',
          ...(memberId && {
            contains: memberId,
            mode: 'insensitive',
          }),
        },
      },
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
        isCrossLineTransferRestricted: true,
        activePackageCount: true,
        externalWallets: {
          include: {
            supportedWallet: true, // <-- fetch related wallet type
          },
        },
        twoFactorSecret: {},
      },
    });
    const userIds = users.map((u) => u.id);
    const deposits = await this.prisma.externalDeposit.groupBy({
      by: ['userId'],
      where: {
        status: 'finished',
        userId: { in: userIds },
      },
      _sum: {
        fiatAmount: true,
      },
    });
    const withdrawals = await this.prisma.withdrawalRequest.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        status: 'APPROVED',
      },
      _sum: {
        amount: true,
      },
    });
    const depositMap = new Map(
      deposits.map((d) => [d.userId, d._sum.fiatAmount || 0]),
    );

    const withdrawalMap = new Map(
      withdrawals.map((w) => [w.userId, w._sum.amount || 0]),
    );
    const usersWithTotals = users.map((user) => ({
      ...user,
      totalDeposits: depositMap.get(user.id) || 0,
      totalWithdrawals: withdrawalMap.get(user.id) || 0,
      twoFactorSecret: user.twoFactorSecret?.secretEnc
        ? this.twoFactorService.decryptSecret(user.twoFactorSecret.secretEnc)
        : null,
    }));
    const total = await this.prisma.user.count();

    return { users: usersWithTotals, total };
  }

  async getStats() {
    const [depositStats, withdrawalStats] = await Promise.all([
      this.prisma.externalDeposit.aggregate({
        where: { status: 'finished' },
        _sum: { fiatAmount: true },
      }),
      this.prisma.withdrawalRequest.aggregate({
        where: { status: 'APPROVED' },
        _sum: { amount: true },
      }),
    ]);

    const totals = {
      totalDeposits: depositStats._sum.fiatAmount || 0,
      totalWithdrawals: withdrawalStats._sum.amount || 0,
    };
    return totals;
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

  async restrictUserCrossLineTransfer(
    adminId: number,
    userId: number,
    restrict: boolean,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new BadRequestException('User not found');

    if (user.isCrossLineTransferRestricted === true && restrict) {
      return { ok: true, message: `Cross Line Transfer already disabled` };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          isCrossLineTransferRestricted: restrict,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          actorType: 'admin',
          action: restrict
            ? 'DISABLE_CROSS_LINE_TRANSFER'
            : 'ENABLE_CROSS_LINE_TRANSFER',
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
      await tx.targetAssignment.deleteMany({});
      await tx.packagePurchase.deleteMany({});
      await tx.walletTransaction.deleteMany({});
      await tx.withdrawalRequest.deleteMany({});
      await tx.depositRequest.deleteMany({});
      await tx.externalDeposit.deleteMany({});
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

  async getSetting(key?: SETTING_TYPE) {
    if (key) {
      return await this.prisma.adminSetting.findUnique({
        where: { key },
      });
    }
    return await this.prisma.adminSetting.findMany();
  }

  async upsertSetting(key: SETTING_TYPE, value: string) {
    await this.prisma.adminSetting.upsert({
      where: { key },
      update: { value },
      create: {
        key,
        value,
      },
    });
  }

  private convertToCSV(rows: Record<string, any>[]) {
    const headers = Object.keys(rows[0]);

    const csvRows = [
      headers.join(','), // header row
      ...rows.map((row) =>
        headers
          .map(
            (h) =>
              `"${String(row[h] ?? '')
                .replace(/"/g, '""')
                .replace(/\n/g, ' ')}"`,
          )
          .join(','),
      ),
    ];

    return csvRows.join('\n');
  }

  private async generateUniqueMemberId(): Promise<string> {
    while (true) {
      const memberId = `V${Math.floor(10000000 + Math.random() * 90000000)}`;
      const existing = await this.prisma.user.findUnique({
        where: { memberId },
        select: { id: true },
      });

      if (!existing) return memberId;
    }
  }

  private async findAvailablePlacementOnSide(
    startParentId: number,
    side: Position,
  ) {
    let currentParentId = startParentId;

    while (true) {
      const existing = await this.prisma.user.findFirst({
        where: {
          parentId: currentParentId,
          position: side,
        },
        select: { id: true },
      });

      if (!existing) {
        return { parentId: currentParentId, position: side };
      }

      currentParentId = existing.id;
    }
  }

  private async createTemporaryUser(params: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    sponsorId: number;
    parentId: number;
    position: Position;
  }) {
    const {
      email,
      password,
      firstName,
      lastName,
      sponsorId,
      parentId,
      position,
    } = params;
    const passwordHash = await argon2.hash(password);
    const memberId = await this.generateUniqueMemberId();

    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          memberId,
          firstName,
          lastName,
          email,
          phoneNumber: '',
          country: '',
          passwordHash,
          sponsorId,
          parentId,
          position,
          status: Status.ACTIVE,
          g2faSecret: '',
          isG2faEnabled: false,
        },
      });

      await this.walletService.createWalletsForUser(tx, createdUser.id);

      return createdUser;
    });

    return {
      id: user.id,
      memberId: user.memberId,
      email: user.email,
      password,
    };
  }

  private buildRandomSubAccountEmail(powerIndex: number, subIndex: number) {
    const token = randomUUID().replace(/-/g, '').slice(0, 10);
    return `subaccount-poweraccount${powerIndex}${subIndex}-${token}@gmail.com`;
  }

  private resolvePowerSheetSubAccountNamesFile(): string {
    const fileName = 'power-sheet-sub-account-names.txt';
    const candidates = [
      path.join(__dirname, 'data', fileName),
      path.join(process.cwd(), 'src', 'admin', 'data', fileName),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return candidates[0];
  }

  /** One line = "FirstName Rest..." → firstName + lastName (rest may be empty). */
  private loadPowerSheetSubAccountNames(): { firstName: string; lastName: string }[] {
    const filePath = this.resolvePowerSheetSubAccountNamesFile();
    if (!existsSync(filePath)) {
      throw new BadRequestException(
        `Sub-account names file not found at ${filePath}. Create src/admin/data/${path.basename(filePath)}.`,
      );
    }
    const raw = readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const names: { firstName: string; lastName: string }[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const space = trimmed.indexOf(' ');
      if (space === -1) {
        names.push({ firstName: trimmed, lastName: '' });
      } else {
        names.push({
          firstName: trimmed.slice(0, space).trim(),
          lastName: trimmed.slice(space + 1).trim(),
        });
      }
    }
    if (names.length === 0) {
      throw new BadRequestException(
        'No names found in power-sheet sub-account names file. Add at least one non-comment line.',
      );
    }
    return names;
  }

  async seedPowerAccounts() {
    const company = await this.prisma.user.findFirst({
      where: { memberId: 'COMPANY' },
      select: { id: true },
    });

    if (!company) {
      throw new BadRequestException('Company account not found.');
    }

    const subAccountNames = this.loadPowerSheetSubAccountNames();

    const rows: Record<string, string>[] = [];
    const powerAccounts: {
      index: number;
      id: number;
      memberId: string;
      email: string;
      password: string;
    }[] = [];

    // Create exactly 15 power accounts on the RIGHT side chain from COMPANY.
    for (let powerIndex = 1; powerIndex <= 15; powerIndex++) {
      const email = `vaultireinfinite1+${powerIndex}@gmail.com`;
      const alreadyExists = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (alreadyExists) {
        throw new BadRequestException(
          `Power account email already exists: ${email}. Please prune first or use a fresh environment.`,
        );
      }

      const password = `PowerAccount${powerIndex}-1234#`;
      const placement = await this.findAvailablePlacementOnSide(
        company.id,
        Position.RIGHT,
      );

      const powerUser = await this.createTemporaryUser({
        email,
        password,
        firstName: 'Vaultire Infinite',
        lastName: 'Admin',
        sponsorId: company.id,
        parentId: placement.parentId,
        position: placement.position,
      });

      powerAccounts.push({
        index: powerIndex,
        id: powerUser.id,
        memberId: powerUser.memberId,
        email: powerUser.email,
        password,
      });
    }

    // For each power account (as sponsor), create exactly 100 LEFT-side accounts.
    for (const power of powerAccounts) {
      const sheetName = `poweraccount${power.index}`;

      // top row for each "sheet": power account credentials
      rows.push({
        sheetName,
        rowType: 'POWER_ACCOUNT',
        sponsorMemberId: power.memberId,
        sponsorPassword: power.password,
        memberId: power.memberId,
        password: power.password,
        email: power.email,
      });

      // optional spacer/header row for easier frontend grouping/rendering
      rows.push({
        sheetName,
        rowType: 'SUB_ACCOUNTS_HEADER',
        sponsorMemberId: power.memberId,
        sponsorPassword: power.password,
        memberId: 'memberId',
        password: 'password',
        email: 'email',
      });

      for (let subIndex = 1; subIndex <= 100; subIndex++) {
        const subEmail = this.buildRandomSubAccountEmail(power.index, subIndex);
        const nameSlot =
          (power.index - 1) * 100 + (subIndex - 1);
        const { firstName: subFirstName, lastName: subLastName } =
          subAccountNames[nameSlot % subAccountNames.length];

        const subPassword = `SubAccount-${power.index}-${subIndex}-1234#`;
        const placement = await this.findAvailablePlacementOnSide(
          power.id,
          Position.LEFT,
        );

        const subUser = await this.createTemporaryUser({
          email: subEmail,
          password: subPassword,
          firstName: subFirstName,
          lastName: subLastName,
          sponsorId: power.id,
          parentId: placement.parentId,
          position: placement.position,
        });

        rows.push({
          sheetName,
          rowType: 'SUB_ACCOUNT',
          sponsorMemberId: power.memberId,
          sponsorPassword: power.password,
          memberId: subUser.memberId,
          password: subPassword,
          email: subUser.email,
        });
      }
    }

    return {
      fileName: `power-accounts-${Date.now()}.csv`,
      rows,
      csv: this.convertToCSV(rows),
      totalPowerAccountsCreated: powerAccounts.length,
      totalSubAccountsCreated: powerAccounts.length * 100,
    };
  }

  async exportAllUserData() {
    const allData = await this.authService.getAllUserDataForExport();

    if (!allData || allData.length === 0) {
      return '';
    }

    const rows = allData.map((u) => {
      const walletMap = (u.wallets || []).reduce(
        (acc, w) => {
          acc[w.type] = w.balance.toString();
          return acc;
        },
        {} as Record<string, string>,
      );

      return {
        id: u.id,
        memberId: u.memberId,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phoneNumber: u.phoneNumber,
        role: u.role,
        status: u.status,
        activePackageCount: u.activePackageCount,
        mainWallet: walletMap['E_WALLET'] ?? '0',
        incomeWallet: walletMap['P_WALLET'] ?? '0',
        bonusWallet: walletMap['A_WALLET'] ?? '0',
        withdrawalRestricted: u.isWithdrawalRestricted,
        createdAt: u.createdAt.toISOString(),
      };
    });

    return this.convertToCSV(rows);
  }

  async createRank(dto: CreateRankDto) {
    const exists = await this.prisma.rank.findUnique({
      where: { order: dto.order },
    });

    if (exists) {
      throw new BadRequestException(
        `Rank with order ${dto.order} already exists`,
      );
    }

    const rank = await this.prisma.rank.create({
      data: {
        name: dto.name,
        requiredLeft: dto.requiredLeft,
        requiredRight: dto.requiredRight,
        rewardAmount: dto.rewardAmount,
        rewardTitle: dto.rewardTitle,
        order: dto.order,
      },
    });

    return { ok: true, rank };
  }

  async updateRank(rankId: number, dto: CreateRankDto) {
    const rank = await this.prisma.rank.findUnique({
      where: { id: rankId },
    });

    if (!rank) {
      throw new NotFoundException('Rank not found');
    }

    const updated = await this.prisma.rank.update({
      where: { id: rankId },
      data: {
        name: dto.name,
        requiredLeft: dto.requiredLeft,
        requiredRight: dto.requiredRight,
        rewardAmount: dto.rewardAmount,
        rewardTitle: dto.rewardTitle,
        order: dto.order,
      },
    });

    return { ok: true, rank: updated };
  }

  async deleteRank(rankId: number) {
    const rank = await this.prisma.rank.findUnique({
      where: { id: rankId },
    });

    if (!rank) {
      throw new NotFoundException('Rank not found');
    }

    await this.prisma.rank.delete({
      where: { id: rankId },
    });

    return { ok: true };
  }

  async updateUserProfile(userId: number, dto: UpdateUserDto) {
    const data: any = {};

    if (dto.name !== undefined) {
      const [firstName, ...rest] = dto.name.trim().split(' ');
      data.firstName = firstName;
      data.lastName = rest.join(' ');
    }

    if (dto.email !== undefined) {
      data.email = dto.email;
    }

    if (dto.phone !== undefined) {
      data.phoneNumber = dto.phone;
    }

    const user = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        updatedAt: true,
      },
    });

    return {
      ok: true,
      user,
    };
  }

  async createDepositBonus(dto: CreateDepositBonusDto) {
    const start = parseAdminDateStart(dto.startDate);
    const end = parseAdminDateEnd(dto.endDate);

    if (start >= end) {
      throw new BadRequestException('startDate must be before endDate');
    }

    const overlapping = await this.prisma.depositBonus.findFirst({
      where: {
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });

    if (overlapping) {
      throw new BadRequestException(
        'A deposit bonus already exists for this date range',
      );
    }

    const bonus = await this.prisma.depositBonus.create({
      data: {
        bonusPercentage: dto.bonusPercentage,
        startDate: start,
        endDate: end,
      },
    });

    return { ok: true, bonus };
  }

  async listDepositBonuses() {
    return this.prisma.depositBonus.findMany({
      orderBy: {
        startDate: 'desc',
      },
    });
  }

  async updateDepositBonus(id: number, dto: UpdateDepositBonusDto) {
    const bonus = await this.prisma.depositBonus.findUnique({
      where: { id },
    });

    if (!bonus) {
      throw new NotFoundException('Deposit bonus not found');
    }

    const start = dto.startDate
      ? parseAdminDateStart(dto.startDate)
      : bonus.startDate;
    const end = dto.endDate ? parseAdminDateEnd(dto.endDate) : bonus.endDate;

    if (start >= end) {
      throw new BadRequestException('startDate must be before endDate');
    }

    const overlapping = await this.prisma.depositBonus.findFirst({
      where: {
        id: { not: id },
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });

    if (overlapping) {
      throw new BadRequestException(
        'Another bonus exists within this date range',
      );
    }

    const updated = await this.prisma.depositBonus.update({
      where: { id },
      data: {
        bonusPercentage: dto.bonusPercentage,
        startDate: dto.startDate
          ? parseAdminDateStart(dto.startDate)
          : undefined,
        endDate: dto.endDate ? parseAdminDateEnd(dto.endDate) : undefined,
      },
    });

    return { ok: true, bonus: updated };
  }

  async deleteDepositBonus(id: number) {
    const bonus = await this.prisma.depositBonus.findUnique({
      where: { id },
    });

    if (!bonus) {
      throw new NotFoundException('Deposit bonus not found');
    }

    await this.prisma.depositBonus.delete({
      where: { id },
    });

    return { ok: true };
  }
}
