import { Injectable, BadRequestException, NotFoundException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { generateTxNumber } from './utils';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { TransactionType } from '@prisma/client';
import { WalletType } from '@prisma/client';

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  // create 4 wallets for a user (call during registration)
  async createWalletsForUser(userId: number) {
    const data = [
    { userId, type: WalletType.F_WALLET },
    { userId, type: WalletType.I_WALLET },
    { userId, type: WalletType.M_WALLET },
    { userId, type: WalletType.BONUS_WALLET },
    ];

    await this.prisma.wallet.createMany({ data, skipDuplicates: true });
  }

  // get wallet row or throw
  async getWallet(userId: number, type: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId_type: { userId, type } as any },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
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

      return { walletId: wallet.id, balanceAfter: newBalance.toFixed(), txNumber: txNo };
    });
  }

  // core: debit wallet (atomic)
  async debitWallet(params: {
    userId: number;
    walletType: 'F_WALLET'|'I_WALLET'|'M_WALLET'|'BONUS_WALLET';
    amount: string;
    txType: TransactionType;
    purpose?: string;
    allowNegative?: boolean; // normally false
    meta?: any;
  }) {
    const { userId, walletType, amount, txType, purpose, allowNegative = false, meta } = params;
    const amt = new Decimal(amount);
    if (amt.lte(0)) throw new BadRequestException('Amount must be positive');

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId_type: { userId, type: walletType } as any },
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

      return { walletId: wallet.id, balanceAfter: newBalance.toFixed(), txNumber: txNo };
    });
  }

  // internal fund transfer: atomic debit + credit
  // transferMode check: DOWNLINE_ONLY or CROSSLINE
  async transferFunds(params: {
    fromUserId: number;
    fromWalletType: 'F_WALLET'|'I_WALLET'|'M_WALLET'|'BONUS_WALLET';
    toMemberId: string; // recipient memberId
    amount: string;
    requestedByUserId?: number; // for auth checks
    twoFactorVerified?: boolean; // boolean after 2FA check
  }) {
    const { fromUserId, fromWalletType, toMemberId, amount } = params;
    const amt = new Decimal(amount);
    if (amt.lte(0)) throw new BadRequestException('Amount must be positive');

    // Find recipient by memberId
    const recipient = await this.prisma.user.findUnique({ where: { memberId: toMemberId }});
    if (!recipient) throw new NotFoundException('Recipient not found');

    // Check transfer mode from AdminSetting
    const transferModeSetting = await this.prisma.adminSetting.findUnique({ where: { key: 'transfer_mode' }});
    const transferMode = transferModeSetting?.value ?? 'CROSSLINE';

    if (transferMode === 'DOWNLINE_ONLY') {
      // verify recipient is in downline of fromUserId
      const isDownline = await this.isInDownline(fromUserId, recipient.id);
      if (!isDownline) throw new ForbiddenException('Recipient not in your downline');
    }

    // Atomic debit + credit
    return this.prisma.$transaction(async (tx) => {
      // debit sender
      const fromWallet = await tx.wallet.findUnique({ where: { userId_type: { userId: fromUserId, type: fromWalletType } as any }});
      if (!fromWallet) throw new NotFoundException('Sender wallet not found');

      const fromBalance = new Decimal(fromWallet.balance.toString());
      if (fromBalance.lt(amt)) throw new BadRequestException('Insufficient balance');

      const newFromBalance = fromBalance.minus(amt);
      await tx.wallet.update({ where: { id: fromWallet.id }, data: { balance: newFromBalance.toFixed() }});
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
        }
      });

      // credit recipient's same wallet type (mirrors sender wallet)
      const toWallet = await tx.wallet.findUnique({ where: { userId_type: { userId: recipient.id, type: fromWalletType } as any }});
      if (!toWallet) throw new NotFoundException('Recipient wallet not found');

      const toBalance = new Decimal(toWallet.balance.toString());
      const newToBalance = toBalance.plus(amt);
      await tx.wallet.update({ where: { id: toWallet.id }, data: { balance: newToBalance.toFixed() }});
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
        }
      });

      return {
        from: { walletId: fromWallet.id, balanceAfter: newFromBalance.toFixed(), txNumber: txNoOut },
        to: { walletId: toWallet.id, balanceAfter: newToBalance.toFixed(), txNumber: txNoIn },
      };
    });
  }

  // Withdraw request: reserve (debit) funds and create pending withdrawal entry
  async createWithdrawRequest(params: {
    userId: number;
    walletType: 'I_WALLET'|'M_WALLET'|'BONUS_WALLET'|'F_WALLET';
    amount: string;
    method: string; // e.g., 'USDT_TRX'
    address?: string;
  }) {
    const { userId, walletType, amount, method, address } = params;
    const amt = new Decimal(amount);
    if (amt.lte(0)) throw new BadRequestException('Amount must be positive');

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId_type: { userId, type: walletType } as any }});
      if (!wallet) throw new NotFoundException('Wallet not found');

      const bal = new Decimal(wallet.balance.toString());
      if (bal.lt(amt)) throw new BadRequestException('Insufficient balance');

      const newBalance = bal.minus(amt);
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance.toFixed() }});

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
        }
      });

      const wr = await tx.withdrawalRequest.create({
        data: {
          userId,
          walletId: wallet.id,
          amount: amt.toFixed(),
          method,
          address,
          status: 'PENDING',
        }
      });

      return { withdrawalId: wr.id, txNumber: txNo, balanceAfter: newBalance.toFixed() };
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
  async isInDownline(ancestorId: number, candidateId: number, maxDepth = 100): Promise<boolean> {
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
}
