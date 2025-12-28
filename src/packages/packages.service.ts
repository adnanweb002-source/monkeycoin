import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { WalletService } from '../wallets/wallet.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { PurchasePackageDto } from './dto/purchase-package.dto';
import Decimal from 'decimal.js';
import { TransactionType, WalletType } from '@prisma/client';

@Injectable()
export class PackagesService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
  ) {}

  async addBinaryVolume(
    tx: Prisma.TransactionClient,
    userId: number,
    bv: Decimal,
  ) {
    let current = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, parentId: true, position: true },
    });

    while (current?.parentId) {
      const parent = await tx.user.findUnique({
        where: { id: current.parentId },
        select: { id: true, position: true, leftBv: true, rightBv: true },
      });

      if (!parent) break;

      const field = current.position === 'LEFT' ? 'leftBv' : 'rightBv';

      await tx.user.update({
        where: { id: parent.id },
        data: {
          [field]: new Decimal(parent[field].toString()).plus(bv).toFixed(),
        },
      });

      // climb upward
      current = await tx.user.findUnique({
        where: { id: parent.id },
        select: { id: true, parentId: true, position: true },
      });
    }
  }

  async createPackage(dto: CreatePackageDto) {
    return this.prisma.package.create({ data: dto });
  }

  // -------- ADMIN: UPDATE PACKAGE --------
  async updatePackage(id: number, dto: UpdatePackageDto) {
    const pkg = await this.prisma.package.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Package not found');

    return this.prisma.package.update({
      where: { id },
      data: dto,
    });
  }

  // -------- USER: LIST ACTIVE PACKAGES --------
  async listActivePackages() {
    return this.prisma.package.findMany({
      where: { isActive: true },
      orderBy: { investmentMin: 'asc' },
    });
  }

  // -------- USER: PURCHASE PACKAGE --------
  async purchasePackage(userId: number, dto: PurchasePackageDto) {
    const pkg = await this.prisma.package.findUnique({
      where: { id: dto.packageId },
    });

    if (!pkg || !pkg.isActive)
      throw new BadRequestException('Invalid or inactive package');

    const amt = new Decimal(dto.amount);

    if (amt.lt(pkg.investmentMin) || amt.gt(pkg.investmentMax)) {
      throw new BadRequestException('Amount not within package range');
    }

    return this.prisma.$transaction(async (tx) => {
      // Debit M Wallet
      await this.walletService.debitWallet({
        userId,
        walletType: WalletType.F_WALLET,
        amount: amt.toFixed(),
        txType: TransactionType.PACKAGE_PURCHASE,
        purpose: `Package purchase: ${pkg.name}`,
        meta: { packageId: pkg.id, amount: amt.toFixed() },
      });

      // 2️⃣ Generate BV = full amount (or percentage if required)
      const bv = amt; // or amt.mul(0.8) if 80% BV

      // 3️⃣ Propagate BV upward
      await this.addBinaryVolume(tx, userId, bv);

      // Start next day
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 1);

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + pkg.durationDays);

      return tx.packagePurchase.create({
        data: {
          userId,
          packageId: pkg.id,
          amount: amt.toFixed(),
          startDate,
          endDate,
          status: 'ACTIVE',
        },
      });
    });
  }

  // -------- USER: MY PACKAGES --------
  async listUserPackages(userId: number) {
    return this.prisma.packagePurchase.findMany({
      where: { userId },
      include: { package: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
