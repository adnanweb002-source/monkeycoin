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
    const amt = new Decimal(amount);
    if (amt.lte(0)) throw new BadRequestException('Amount must be positive');

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId_type: { userId, type: walletType } as any },
      });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const bal = new Decimal(wallet.balance.toString());
      if (bal.lt(amt)) throw new BadRequestException('Insufficient balance');

      const newBalance = bal.minus(amt);
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance.toFixed() },
      });

      const txNo = generateTxNumber();
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: 'WITHDRAW',
          amount: amt.toFixed(),
          direction: 'DEBIT',
          purpose: 'Withdrawal requested',
          balanceAfter: newBalance.toFixed(),
          txNumber: txNo,
          meta: JSON.stringify({ method, address }),
        },
      });

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
        txNumber: txNo,
        balanceAfter: newBalance.toFixed(),
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

      // Ledger entry (NO balance change)
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: params.userId,
          type: TransactionType.DEPOSIT,
          amount: amt.toFixed(),
          direction: 'CREDIT',
          purpose: 'Deposit request created',
          balanceAfter: wallet.balance, // unchanged
          txNumber: generateTxNumber(),
          meta: {
            depositRequestId: deposit.id,
            status: 'PENDING',
          },
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
}
