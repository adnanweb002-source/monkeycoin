import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { generateTxNumber } from './utils';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { TransactionType } from '@prisma/client';
import { WalletType } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { Role } from '@prisma/client';
@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  // check if wallet can be debited (Limits)
  async canDebitWallet(params: {
    userId: number;
    walletType: WalletType;
    amount: string;
  }) {
    const { userId, walletType, amount } = params;

    const amt = new Decimal(amount);
    if (amt.lte(0)) {
      return { ok: false, reason: 'Amount must be greater than zero' };
    }

    // 1) Find wallet
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId_type: { userId, type: walletType } },
    });

    if (!wallet) {
      return { ok: false, reason: 'Wallet not found' };
    }

    const balance = new Decimal(wallet.balance.toString());
    if (amt.gt(balance)) {
      return { ok: false, reason: 'Insufficient wallet balance' };
    }

    // 2) Load limits
    const limit = await this.prisma.walletLimit.findUnique({
      where: { walletType },
    });

    if (limit && limit.isActive) {
      if (amt.lt(limit.minWithdrawal)) {
        return {
          ok: false,
          reason: `Minimum withdrawal is ${limit.minWithdrawal.toString()}`,
        };
      }

      if (amt.gt(limit.maxPerTx)) {
        return {
          ok: false,
          reason: `Maximum per transaction is ${limit.maxPerTx.toString()}`,
        };
      }

      // 4) 24h activity checks
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const stats = await this.prisma.walletTransaction.aggregate({
        where: {
          userId,
          walletId: wallet.id,
          type: 'WITHDRAW',
          createdAt: { gte: since },
        },
        _count: { id: true },
        _sum: { amount: true },
      });

      const txCount = stats._count.id ?? 0;
      const total24h = new Decimal(stats._sum.amount ?? 0);

      if (txCount >= limit.maxTxCount24h) {
        return {
          ok: false,
          reason: `Daily withdrawal limit reached (${limit.maxTxCount24h} tx allowed)`,
        };
      }

      if (total24h.plus(amt).gt(limit.maxAmount24h)) {
        return {
          ok: false,
          reason: `Daily withdrawal cap exceeded (limit ${limit.maxAmount24h.toString()})`,
        };
      }
    }

    // All good
    return { ok: true, walletId: wallet.id };
  }

  // Admin: get wallet limits
  async getWalletLimits() {
    return this.prisma.walletLimit.findMany();
  }

  // Admin: set wallet limits
  async upsertWalletLimit(dto: {
    walletType: WalletType;
    minWithdrawal: string;
    maxPerTx: string;
    maxTxCount24h: number;
    maxAmount24h: string;
    isActive: boolean;
  }) {
    // Validation
    const min = new Decimal(dto.minWithdrawal);
    const maxTx = new Decimal(dto.maxPerTx);
    const max24 = new Decimal(dto.maxAmount24h);

    if (min.lte(0))
      throw new BadRequestException('Minimum withdrawal must be > 0');
    if (maxTx.lt(min))
      throw new BadRequestException('Max per transaction must be >= minimum');
    if (max24.lt(maxTx))
      throw new BadRequestException('24h cap must be >= max per transaction');

    return this.prisma.walletLimit.upsert({
      where: { walletType: dto.walletType },
      update: {
        minWithdrawal: min.toFixed(),
        maxPerTx: maxTx.toFixed(),
        maxTxCount24h: dto.maxTxCount24h,
        maxAmount24h: max24.toFixed(),
        isActive: dto.isActive,
      },
      create: {
        walletType: dto.walletType,
        minWithdrawal: min.toFixed(),
        maxPerTx: maxTx.toFixed(),
        maxTxCount24h: dto.maxTxCount24h,
        maxAmount24h: max24.toFixed(),
        isActive: dto.isActive,
      },
    });
  }

  // create 4 wallets for a user (call during registration)
  async createWalletsForUser(
    tx: PrismaClient | Prisma.TransactionClient,
    userId: number,
  ) {
    const data = [
      { userId, type: WalletType.F_WALLET },
      { userId, type: WalletType.I_WALLET },
      { userId, type: WalletType.M_WALLET },
      { userId, type: WalletType.BONUS_WALLET },
    ];

    await tx.wallet.createMany({ data, skipDuplicates: true });
  }

  // get wallet row or throw
  async getWallet(userId: number, type: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId_type: { userId, type } as any },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async getUserWallets(userId: number) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
    });
    return wallets;
  }

  // read balance
  async getBalance(userId: number, type: string) {
    const wallet = await this.getWallet(userId, type);
    return wallet.balance; // Decimal stored via Prisma
  }

  // core: credit wallet (atomic)
  async creditWallet(params: {
    userId: number;
    walletType: WalletType;
    amount: string; // decimal string
    txType: TransactionType; // TransactionType from prisma
    purpose?: string;
    meta?: any;
  }) {
    const { userId, walletType, amount, txType, purpose, meta } = params;
    const amt = new Decimal(amount);
    if (amt.lte(0)) throw new BadRequestException('Amount must be positive');

    return this.prisma.$transaction(async (tx) => {
      // fetch wallet FOR UPDATE semantics are implicit in transaction (Prisma doesn't expose FOR UPDATE)
      const wallet = await tx.wallet.findUnique({
        where: { userId_type: { userId, type: walletType } as any },
      });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const newBalance = new Decimal(wallet.balance.toString()).plus(amt);

      // update wallet
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance.toFixed() },
      });

      // ledger entry
      const txNo = generateTxNumber();
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: txType,
          amount: amt.toFixed(),
          direction: 'CREDIT',
          purpose: purpose ?? txType,
          balanceAfter: newBalance.toFixed(),
          txNumber: txNo,
          meta: meta ?? Prisma.JsonNull,
        },
      });

      return {
        walletId: wallet.id,
        balanceAfter: newBalance.toFixed(),
        txNumber: txNo,
      };
    });
  }

  // core: debit wallet (atomic)
  async debitWallet(params: {
    userId: number;
    walletType: 'F_WALLET' | 'I_WALLET' | 'M_WALLET' | 'BONUS_WALLET';
    amount: string;
    txType: TransactionType;
    purpose?: string;
    allowNegative?: boolean; // normally false
    meta?: any;
  }) {
    const {
      userId,
      walletType,
      amount,
      txType,
      purpose,
      allowNegative = false,
      meta,
    } = params;
    console.log('Debit Wallet Params:', params);
    const amt = new Decimal(amount);
    if (amt.lte(0)) throw new BadRequestException('Amount must be positive');

    const canDebit = await this.canDebitWallet({ userId, walletType, amount });
    if (!canDebit.ok) {
      throw new BadRequestException(`Cannot debit wallet: ${canDebit.reason}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findFirst({
        where: { userId, type: walletType },
      });

      if (!wallet) throw new NotFoundException('Wallet not found');

      const bal = new Decimal(wallet.balance.toString());
      const newBalance = bal.minus(amt);

      if (!allowNegative && newBalance.lt(0)) {
        throw new BadRequestException('Insufficient balance');
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance.toFixed() },
      });

      const txNo = generateTxNumber();
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: txType,
          amount: amt.toFixed(),
          direction: 'DEBIT',
          purpose: purpose ?? txType,
          balanceAfter: newBalance.toFixed(),
          txNumber: txNo,
          meta: meta ?? Prisma.JsonNull,
        },
      });

      return {
        walletId: wallet.id,
        balanceAfter: newBalance.toFixed(),
        txNumber: txNo,
      };
    });
  }

  // internal fund transfer: atomic debit + credit
  // transferMode check: DOWNLINE_ONLY or CROSSLINE
  async transferFunds(params: {
    fromUserId: number;
    fromWalletType: 'F_WALLET' | 'I_WALLET' | 'M_WALLET' | 'BONUS_WALLET';
    toMemberId: string; // recipient memberId
    amount: string;
    requestedByUserId?: number; // for auth checks
    twoFactorVerified?: boolean; // boolean after 2FA check
  }) {
    const { fromUserId, fromWalletType, toMemberId, amount } = params;
    console.log('The params for transferFunds are:', params);
    const amt = new Decimal(amount);
    if (amt.lte(0)) throw new BadRequestException('Amount must be positive');

    // Find recipient by memberId
    const recipient = await this.prisma.user.findUnique({
      where: { memberId: toMemberId },
    });
    if (!recipient) throw new NotFoundException('Recipient not found');

    const transferMode = 'DOWNLINE_ONLY';

    if (transferMode === 'DOWNLINE_ONLY') {
      const isDownline = await this.isInDownline(fromUserId, recipient.id);
      if (!isDownline)
        throw new ForbiddenException('Recipient not in your downline');
    }

    // Atomic debit + credit
    return this.prisma.$transaction(async (tx) => {
      // debit sender
      const fromWallet = await tx.wallet.findUnique({
        where: {
          userId_type: { userId: fromUserId, type: fromWalletType } as any,
        },
      });
      if (!fromWallet) throw new NotFoundException('Sender wallet not found');

      const fromBalance = new Decimal(fromWallet.balance.toString());
      if (fromBalance.lt(amt))
        throw new BadRequestException('Insufficient balance');

      const newFromBalance = fromBalance.minus(amt);
      await tx.wallet.update({
        where: { id: fromWallet.id },
        data: { balance: newFromBalance.toFixed() },
      });
      const txNoOut = generateTxNumber();
      await tx.walletTransaction.create({
        data: {
          walletId: fromWallet.id,
          userId: fromUserId,
          type: 'TRANSFER_OUT',
          amount: amt.toFixed(),
          direction: 'DEBIT',
          purpose: `Transfer to ${recipient.memberId}`,
          balanceAfter: newFromBalance.toFixed(),
          txNumber: txNoOut,
          meta: JSON.stringify({ toMemberId }),
        },
      });

      // credit recipient's same wallet type (mirrors sender wallet)
      const toWallet = await tx.wallet.findUnique({
        where: {
          userId_type: { userId: recipient.id, type: fromWalletType } as any,
        },
      });
      if (!toWallet) throw new NotFoundException('Recipient wallet not found');

      const toBalance = new Decimal(toWallet.balance.toString());
      const newToBalance = toBalance.plus(amt);
      await tx.wallet.update({
        where: { id: toWallet.id },
        data: { balance: newToBalance.toFixed() },
      });
      const txNoIn = generateTxNumber();
      await tx.walletTransaction.create({
        data: {
          walletId: toWallet.id,
          userId: recipient.id,
          type: 'TRANSFER_IN',
          amount: amt.toFixed(),
          direction: 'CREDIT',
          purpose: `Transfer from ${fromUserId}`,
          balanceAfter: newToBalance.toFixed(),
          txNumber: txNoIn,
          meta: JSON.stringify({ fromUserId }),
        },
      });

      return {
        from: {
          walletId: fromWallet.id,
          balanceAfter: newFromBalance.toFixed(),
          txNumber: txNoOut,
        },
        to: {
          walletId: toWallet.id,
          balanceAfter: newToBalance.toFixed(),
          txNumber: txNoIn,
        },
      };
    });
  }

  async tranferFundsInternal(params: {
    userId: number;
    fromWalletType: WalletType;
    toWalletType: WalletType;
    amount: string;
  }) {
    return {
      status: 'disabled',
      message: 'Internal transfer is currently disabled',
    }
    const { userId, fromWalletType, toWalletType, amount } = params;
    const amt = new Decimal(amount);
    if (amt.lte(0)) throw new BadRequestException('Amount must be positive');

    // Atomic debit + credit between user's own wallets
    return this.prisma.$transaction(async (tx) => {
      // debit fromWallet
      const fromWallet = await tx.wallet.findUnique({
        where: {
          userId_type: { userId, type: fromWalletType } as any,
        },
      });
      if (!fromWallet) throw new NotFoundException('From wallet not found');
      const fromBalance = new Decimal(fromWallet.balance.toString());
      if (fromBalance.lt(amt))
        throw new BadRequestException('Insufficient balance in from wallet');
      const newFromBalance = fromBalance.minus(amt);
      await tx.wallet.update({
        where: { id: fromWallet.id },
        data: { balance: newFromBalance.toFixed() },
      });
      const txNoOut = generateTxNumber();
      await tx.walletTransaction.create({
        data: {
          walletId: fromWallet.id,
          userId,
          type: TransactionType.TRANSFER_OUT,
          amount: amt.toFixed(),
          direction: 'DEBIT',
          purpose: `Internal transfer to ${toWalletType}`,
          balanceAfter: newFromBalance.toFixed(),
          txNumber: txNoOut,
          meta: JSON.stringify({ toWalletType }),
        },
      });
      // credit toWallet
      const toWallet = await tx.wallet.findUnique({
        where: {
          userId_type: { userId, type: toWalletType } as any,
        },
      });
      if (!toWallet) throw new NotFoundException('To wallet not found');
      const toBalance = new Decimal(toWallet.balance.toString());
      const newToBalance = toBalance.plus(amt);
      await tx.wallet.update({
        where: { id: toWallet.id },
        data: { balance: newToBalance.toFixed() },
      });
      const txNoIn = generateTxNumber();
      await tx.walletTransaction.create({
        data: {
          walletId: toWallet.id,
          userId,
          type: TransactionType.TRANSFER_IN,
          amount: amt.toFixed(),
          direction: 'CREDIT',
          purpose: `Internal transfer from ${fromWalletType}`,
          balanceAfter: newToBalance.toFixed(),
          txNumber: txNoIn,
          meta: JSON.stringify({ fromWalletType }),
        },
      });
      return {
        from: {
          walletId: fromWallet.id,
          balanceAfter: newFromBalance.toFixed(),
          txNumber: txNoOut,
        },
        to: {
          walletId: toWallet.id,
          balanceAfter: newToBalance.toFixed(),
          txNumber: txNoIn,
        },
      };
    });
  }

  // Withdraw request: reserve (debit) funds and create pending withdrawal entry
  async createWithdrawRequest(params: {
    userId: number;
    walletType: 'I_WALLET' | 'M_WALLET' | 'BONUS_WALLET' | 'F_WALLET';
    amount: string;
    method: string; // e.g., 'USDT_TRX'
    address?: string;
  }) {
    const { userId, walletType, amount, method, address } = params;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.isWithdrawalRestricted) {
      throw new ForbiddenException('Withdrawals are restricted for your account. Please contact support.');
    }

    const amt = new Decimal(amount);
    if (amt.lte(0)) throw new BadRequestException('Amount must be positive');

    const canDebit = await this.canDebitWallet({ userId, walletType, amount });
    if (!canDebit.ok) {
      throw new BadRequestException(`Cannot debit wallet: ${canDebit.reason}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId_type: { userId, type: walletType } as any },
      });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const bal = new Decimal(wallet.balance.toString());
      if (bal.lt(amt)) throw new BadRequestException('Insufficient balance');

      const wr = await tx.withdrawalRequest.create({
        data: {
          userId,
          walletId: wallet.id,
          amount: amt.toFixed(),
          method,
          address,
          status: 'PENDING',
        },
      });

      return {
        withdrawalId: wr.id,
        balanceAfter: bal.toFixed(),
      };
    });
  }

  // Handle deposit confirmation (e.g. webhook) -> credit F_WALLET
  async handleDepositConfirmation(params: {
    userId: number;
    amount: string;
    externalTxId?: string;
    meta?: any;
  }) {
    const { userId, amount, externalTxId, meta } = params;
    // credit F_WALLET; tx type DEPOSIT
    return this.creditWallet({
      userId,
      walletType: 'F_WALLET',
      amount,
      txType: 'DEPOSIT',
      purpose: 'Crypto deposit confirmed',
      meta: { externalTxId, ...meta },
    });
  }

  // helper: check if candidateId is in the downline of userId
  // simple BFS limited depth
  async isInDownline(
    ancestorId: number,
    candidateId: number,
    maxDepth = 100,
  ): Promise<boolean> {
    if (ancestorId === candidateId) return true;
    const queue = [ancestorId];
    let depth = 0;
    while (queue.length && depth < maxDepth) {
      const current = queue.shift();
      // fetch children
      const children = await this.prisma.user.findMany({
        where: { parentId: current },
        select: { id: true },
      });
      for (const c of children) {
        if (c.id === candidateId) return true;
        queue.push(c.id);
      }
      depth++;
    }
    return false;
  }

  // Create deposit request: creates a pending deposit request and ledger entry (no balance change)
  async createDepositRequest(params: {
    userId: number;
    amount: string;
    method?: string;
    reference?: string;
  }) {
    const amt = new Decimal(params.amount);
    if (amt.lte(0)) throw new BadRequestException('Invalid amount');

    const wallet = await this.prisma.wallet.findUnique({
      where: {
        userId_type: {
          userId: params.userId,
          type: WalletType.F_WALLET,
        } as any,
      },
    });
    if (!wallet) throw new NotFoundException('F-Wallet not found');

    return this.prisma.$transaction(async (tx) => {
      const deposit = await tx.depositRequest.create({
        data: {
          userId: params.userId,
          walletId: wallet.id,
          amount: amt.toFixed(),
          method: params.method,
          reference: params.reference,
        },
      });

      return deposit;
    });
  }

  // Admin: approve deposit request

  async approveDeposit(depositRequestId: number, adminId: number) {
    return this.prisma.$transaction(async (tx) => {
      const dr = await tx.depositRequest.findUnique({
        where: { id: depositRequestId },
      });
      if (!dr) throw new NotFoundException('Deposit request not found');
      if (dr.status !== 'PENDING') {
        throw new BadRequestException('Deposit already processed');
      }

      const wallet = await tx.wallet.findUnique({ where: { id: dr.walletId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const amt = new Decimal(dr.amount);
      const newBalance = new Decimal(wallet.balance.toString()).plus(amt);

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance.toFixed() },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: dr.userId,
          type: TransactionType.DEPOSIT,
          amount: amt.toFixed(),
          direction: 'CREDIT',
          purpose: 'Deposit approved by admin',
          balanceAfter: newBalance.toFixed(),
          txNumber: generateTxNumber(),
          meta: {
            depositRequestId: dr.id,
            approvedBy: adminId,
          },
        },
      });

      await tx.depositRequest.update({
        where: { id: dr.id },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });

      return { ok: true };
    });
  }

  async rejectDeposit(depositRequestId: number, adminId: number) {
    return this.prisma.$transaction(async (tx) => {
      const dr = await tx.depositRequest.findUnique({
        where: { id: depositRequestId },
      });
      if (!dr) throw new NotFoundException('Deposit request not found');
      if (dr.status !== 'PENDING') {
        throw new BadRequestException('Deposit already processed');
      }
      await tx.depositRequest.update({
        where: { id: dr.id },
        data: { status: 'REJECTED', approvedAt: new Date() },
      });
      return { ok: true };
    });
  }

  async approveWithdrawal(
    withdrawalRequestId: number,
    adminId: number,
    adminNote: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.isWithdrawalRestricted) {
      throw new ForbiddenException('Withdrawals are restricted for this account. Please enable withdrawal and then approve.');
    }
    
    return this.prisma.$transaction(async (tx) => {
      const wr = await tx.withdrawalRequest.findUnique({
        where: { id: withdrawalRequestId },
      });
      if (!wr) throw new NotFoundException('Withdrawal request not found');
      if (wr.status !== 'PENDING') {
        throw new BadRequestException('Withdrawal already processed');
      }

      // Debit the wallet

      const wallet = await tx.wallet.findUnique({ where: { id: wr.walletId } });
      if (!wallet) throw new NotFoundException('Wallet not found');
      const amt = new Decimal(wr.amount);
      const bal = new Decimal(wallet.balance.toString());

      if (bal.lt(amt)) {
        throw new BadRequestException(
          'Insufficient balance in wallet for withdrawal',
        );
      }

      const newBalance = bal.minus(amt);
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance.toFixed() },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: wr.userId,
          type: TransactionType.WITHDRAW,
          amount: amt.toFixed(),
          direction: 'DEBIT',
          purpose: 'Withdrawal approved by admin',
          balanceAfter: newBalance.toFixed(),
          txNumber: generateTxNumber(),
          meta: {
            withdrawalRequestId: wr.id,
            approvedBy: adminId,
          },
        },
      });

      await tx.withdrawalRequest.update({
        where: { id: wr.id },
        data: {
          status: 'APPROVED',
          updatedAt: new Date(),
          adminNote: adminNote,
        },
      });
      return { ok: true };
    });
  }

  async rejectWithdrawal(
    withdrawalRequestId: number,
    adminId: number,
    adminNote: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const wr = await tx.withdrawalRequest.findUnique({
        where: { id: withdrawalRequestId },
      });
      if (!wr) throw new NotFoundException('Withdrawal request not found');
      if (wr.status !== 'PENDING') {
        throw new BadRequestException('Withdrawal already processed');
      }
      await tx.withdrawalRequest.update({
        where: { id: wr.id },
        data: {
          status: 'REJECTED',
          updatedAt: new Date(),
          adminNote: adminNote,
        },
      });
      return { ok: true };
    });
  }

  async adminBonusCredit(params: {
    userId: number;
    amount: string;
    reason?: string;
    adminId: number;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('User account is not active');
    }
    return this.creditWallet({
      userId: params.userId,
      walletType: WalletType.BONUS_WALLET,
      amount: params.amount,
      txType: TransactionType.RANK_REWARD,
      purpose: params.reason ?? 'Admin bonus credit',
      meta: {
        creditedBy: params.adminId,
      },
    });
  }

  async getWalletTransactions(
    userId: number,
    userRole: Role,
    walletType: WalletType,
    skip = 0,
    take = 20,
  ) {
    if (userRole !== Role.ADMIN) {
      const wallet = await this.getWallet(userId, walletType);

      const transactions = await this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      });

      return transactions;
    } else {
      const transactions = await this.prisma.walletTransaction.findMany({
        where: {
          wallet: { type: walletType },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          walletId: true,
          userId: true,
          txNumber: true,
          type: true,
          direction: true,
          amount: true,
          purpose: true,
          balanceAfter: true,
          createdAt: true,
          meta: true,
        },
        skip,
        take,
      });

      return transactions;
    }
  }

  async getWithdrawalRequests(
    userId: number,
    role: Role,
    skip = 0,
    take = 20,
    status?: string,
  ) {
    if (role !== Role.ADMIN) {
      const requests = await this.prisma.withdrawalRequest.findMany({
        where: { userId, status: status ?? undefined },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      });
      return requests;
    } else {
      const requests = await this.prisma.withdrawalRequest.findMany({
        where: { status: status ?? undefined },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      });
      return requests;
    }
  }

  async getDepositRequests(
    userId: number,
    role: Role,
    skip = 0,
    take = 20,
    status?: string,
  ) {
    if (role !== Role.ADMIN) {
      const requests = await this.prisma.depositRequest.findMany({
        where: { userId, status: status ?? undefined },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      });
      return requests;
    } else {
      const requests = await this.prisma.depositRequest.findMany({
        where: { status: status ?? undefined },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      });
      return requests;
    }
  }

  async getIncomeDetails(
    userId: number,
    type: TransactionType,
    skip = 0,
    take = 20,
  ) {
    const [txns, agg] = await this.prisma.$transaction([
      this.prisma.walletTransaction.findMany({
        where: { userId, type, direction: 'CREDIT' },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),

      this.prisma.walletTransaction.aggregate({
        _sum: { amount: true },
        where: { userId, type, direction: 'CREDIT' },
      }),
    ]);

    const total = agg._sum.amount
      ? new Decimal(agg._sum.amount.toString()).toFixed()
      : '0';

    return {
      total,
      count: txns.length,
      transactions: txns,
    };
  }

  async getBinaryIncome(userId: number, skip = 0, take = 20) {
    return this.getIncomeDetails(
      userId,
      TransactionType.BINARY_INCOME,
      skip,
      take,
    );
  }

  async getDirectIncome(userId: number, skip = 0, take = 20) {
    return this.getIncomeDetails(
      userId,
      TransactionType.ROI_CREDIT,
      skip,
      take,
    );
  }

  async getGainReport(userId: number, from?: Date, to?: Date) {
    const where: any = {
      userId,
      direction: 'CREDIT',
      type: {
        not: TransactionType.DEPOSIT,
      },
    };

    if (from || to) {
      where.createdAt = {};

      if (from) where.createdAt.gte = new Date(from);

      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const agg = await this.prisma.walletTransaction.groupBy({
      by: ['type'],
      where,
      _sum: { amount: true },
    });

    const total = agg.reduce((sum, r) => {
      return sum.plus(r._sum.amount?.toString() ?? '0');
    }, new Decimal(0));

    return {
      total: total.toFixed(),
      breakdown: agg.map((r) => ({
        type: r.type,
        amount: r._sum.amount?.toString() ?? '0',
      })),
    };
  }

  // Admin: Supported Wallets CRUD
  async listSupportedWallets() {
    return this.prisma.supportedWallet.findMany();
  }

  async upsertSupportedWallet(dto: {
    id?: number;
    name: string;
    currency: string;
    allowedChangeCount: number;
  }) {
    return this.prisma.supportedWallet.upsert({
      where: { id: dto.id ?? 0 },
      update: {
        name: dto.name,
        currency: dto.currency,
        allowedChangeCount: dto.allowedChangeCount,
      },
      create: dto,
    });
  }

  async deleteSupportedWallet(id: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.userWallet.deleteMany({
        where: { supportedWalletId: id },
      });
      await tx.supportedWallet.delete({ where: { id } });

      return { ok: true };
    });
  }

  async adminUpdateUserWallet(dto: {
    walletId: number;
    address: string;
    adminId: number;
  }) {
    const wallet = await this.prisma.userWallet.findUnique({
      where: { id: dto.walletId },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');

    return this.prisma.userWallet.update({
      where: { id: wallet.id },
      data: { address: dto.address }, // NO increment
    });
  }

  // User: CRUD for user wallets

  async getSupportedWallets() {
    return this.prisma.supportedWallet.findMany();
  }

  async listUserWallets(userId: number) {
    return this.prisma.userWallet.findMany({
      where: { userId },
      include: { supportedWallet: true },
    });
  }

  async createUserWallet(
    userId: number,
    dto: {
      supportedWalletId: number;
      address: string;
    },
  ) {
    const sw = await this.prisma.supportedWallet.findUnique({
      where: { id: dto.supportedWalletId },
    });
    if (!sw) throw new BadRequestException('Wallet type not supported');

    return this.prisma.userWallet.create({
      data: { userId, supportedWalletId: sw.id, address: dto.address },
    });
  }

  async updateUserWallet(
    userId: number,
    dto: {
      walletId: number;
      address: string;
    },
  ) {
    const wallet = await this.prisma.userWallet.findUnique({
      where: { id: dto.walletId },
      include: { supportedWallet: true },
    });

    if (!wallet || wallet.userId !== userId)
      throw new NotFoundException('Wallet not found');

    if (wallet.changeCount >= wallet.supportedWallet.allowedChangeCount)
      throw new BadRequestException('Wallet change limit reached');

    return this.prisma.userWallet.update({
      where: { id: wallet.id },
      data: {
        address: dto.address,
        changeCount: wallet.changeCount + 1,
      },
    });
  }

  async deleteUserWallet(userId: number, walletId: number) {
    const wallet = await this.prisma.userWallet.findFirst({
      where: { id: walletId, userId },
    });

    if (!wallet) throw new NotFoundException('Wallet not found');

    await this.prisma.userWallet.delete({ where: { id: walletId } });
    return { ok: true };
  }
}
