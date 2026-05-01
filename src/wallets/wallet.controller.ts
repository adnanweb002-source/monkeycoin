// wallet.controller.ts (example)
import {
  Controller,
  Post,
  Body,
  Param,
  Req,
  Get,
  Query,
  Put,
  Delete,
  BadRequestException,
  UnauthorizedException,
  Headers,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { UseGuards } from '@nestjs/common';
import { TransferDto } from './dto/transfer.dto';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { WalletType, TransactionType } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import crypto from 'crypto';
import { CreateCryptoDepositDto } from './dto/deposit.dto';
import {
  depositBonusActiveWhereToronto,
  parseQueryDateEnd,
  parseQueryDateStart,
} from '../common/toronto-time';
import { CacheNamespace } from '../cache/decorators/cache-namespace.decorator';
import { Cacheable } from '../cache/decorators/cacheable.decorator';
import { SkipCacheInvalidation } from '../cache/decorators/skip-cache-invalidation.decorator';

@Controller('wallet')
@CacheNamespace('wallet')
export class WalletController {
  constructor(
    private svc: WalletService,
    private prisma: PrismaService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 15, namespace: 'wallet', scope: 'user' })
  @Get('user-wallets')
  async getUserWallets(@Req() req) {
    return this.svc.getUserWallets(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('transfer')
  async transfer(@Req() req, @Body() dto: any) {
    dto.fromUserId = req.user.id;
    return this.svc.transferFunds(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('internal-transfer')
  async internalTransfer(
    @Req() req,
    @Body()
    dto: {
      fromWalletType: WalletType;
      toWalletType: WalletType;
      amount: string;
    },
  ) {
    return this.svc.tranferFundsInternal({
      userId: req.user.id,
      fromWalletType: dto.fromWalletType,
      toWalletType: dto.toWalletType,
      amount: dto.amount,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('withdraw')
  async withdraw(@Req() req, @Body() dto: any) {
    dto.userId = req.user.id;
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded
      ? (forwarded as string).split(',')[0]
      : req.socket.remoteAddress;
    return this.svc.createWithdrawRequest(dto, ip);
  }


  @UseGuards(JwtAuthGuard)
  @Post('deposit-request')
  async createDeposit(
    @Req() req,
    @Body() body: { amount: string; method?: string; reference?: string },
  ) {
    return this.svc.createDepositRequest({
      userId: req.user.id,
      amount: body.amount,
      method: body.method,
      reference: body.reference,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admin/deposits/:id/approve')
  approveDeposit(@Param('id') id: string, @Req() req) {
    return this.svc.approveDeposit(Number(id), req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admin/deposits/:id/reject')
  rejectDeposit(@Param('id') id: string, @Req() req) {
    return this.svc.rejectDeposit(Number(id), req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admin/withdrawal/:id/approve')
  approveWithdrawal(
    @Param('id') id: string,
    @Req() req,
    @Body() body: { adminNote: string },
  ) {
    return this.svc.approveWithdrawal(Number(id), req.user.id, body.adminNote);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admin/withdrawal/:id/reject')
  rejectWithdrawal(
    @Param('id') id: string,
    @Req() req,
    @Body() body: { adminNote: string },
  ) {
    return this.svc.rejectWithdrawal(Number(id), req.user.id, body.adminNote);
  }

  @UseGuards(JwtAuthGuard)
  @Post('/withdrawal/:id/cancel')
  cancelWithdrawal(
    @Param('id') id: string,
    @Req() req,
  ) {
    return this.svc.cancelWithdrawal(Number(id), req.user.id);
  }


  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admin/bonus-credit')
  async bonusCredit(
    @Body() body: { userId: number; amount: string; reason?: string },
    @Req() req,
  ) {
    return this.svc.adminBonusCredit({
      userId: body.userId,
      amount: body.amount,
      reason: body.reason,
      adminId: req.user.id,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 15, namespace: 'wallet', scope: 'user' })
  @Get('withdraw-requests')
  async getWithdrawalRequests(
    @Req() req,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.getWithdrawalRequests(
      req.user.id,
      req.user.role,
      Number(skip) || 0,
      Number(take) || 20,
      status,
    );
  }

  @UseGuards(JwtAuthGuard)
  @SkipCacheInvalidation()
  @Post('deposit-requests')
  async getDepositRequests(
    @Req() req,
    @Body() body: { skip?: number; take?: number; status?: string },
  ) {
    return this.svc.getDepositRequests(
      req.user.id,
      req.user.role,
      body.skip ?? 0,
      body.take ?? 20,
      body.status,
    );
  }

  verifySignature(rawBody: string, headerSig: string) {
    const secret = process.env.NOWPAYMENTS_IPN_SECRET;
    if (!secret?.trim() || !headerSig) {
      return false;
    }
    const computed = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');

    return computed === headerSig;
  }

  @Post('payments/ipn')
  async handleIpn(@Req() req, @Headers('x-nowpayments-sig') sig: string) {
    const raw = JSON.stringify(req.body);

    if (!this.verifySignature(raw, sig))
      throw new UnauthorizedException('Invalid signature');

    const payload = req.body;
    const { payment_id, payment_status, actually_paid, pay_currency, price_amount } = payload;

    await this.prisma.paymentGatewayLog.create({
      data: { paymentId: payment_id.toString(), payload },
    });

    const dep = await this.prisma.externalDeposit.findUnique({
      where: { paymentId: payment_id.toString() },
    });

    if (!dep) return { ok: true };

    if (dep.status === 'finished') return { ok: true };

    await this.prisma.externalDeposit.update({
      where: { id: dep.id },
      data: {
        status: payment_status,
        paidAmount: price_amount?.toString(),
        meta: payload,
      },
    });

    if (payment_status === 'finished') {
      await this.svc.creditWallet({
        userId: dep.userId,
        walletType: WalletType.D_WALLET,
        amount: price_amount.toString(),
        txType: TransactionType.DEPOSIT,
        purpose: 'Deposit via NOWPayments',
        meta: payload,
      });

      const wallet = await this.svc.getWallet(dep.userId, WalletType.D_WALLET);

      await this.svc.handleDepositConfirmationMail({
        userId: dep.userId,
        amount: price_amount.toString(),
        externalTxId: payment_id.toString(),
        balanceAfter: wallet.balance.toString(),
      });

      // Find the active bonus for the current calendar day in Toronto
      const activeBonus = await this.prisma.depositBonus.findFirst({
        where: depositBonusActiveWhereToronto(),
      });

      let bonusAmount = 0;

      if (activeBonus) {
        bonusAmount = (price_amount * activeBonus.bonusPercentage) / 100;

        if (bonusAmount > 0) {
          await this.svc.creditWallet({
            userId: dep.userId,
            walletType: WalletType.A_WALLET,
            amount: bonusAmount.toString(),
            txType: TransactionType.ADMIN_BONUS,
            purpose: `Deposit bonus (${activeBonus.bonusPercentage}%) for deposit`,
            meta: payload,
          });
        }
      }
    }

    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('deposit/crypto')
  createCryptoDeposit(@Req() req, @Body() dto: CreateCryptoDepositDto) {
    return this.svc.createCryptoDeposit(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 5, namespace: 'wallet', scope: 'user' })
  @Get('deposit-status/:id')
  async getDepositStatus(@Param('id') id: string, @Req() req) {
    return this.svc.getDepositStatus(Number(id), req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 20, namespace: 'wallet', scope: 'user' })
  @Get('deposit/history')
  async getMyDeposits(
    @Req() req,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.max(parseInt(limit, 10) || 10, 1);

    const skip = (pageNum - 1) * pageSize;

    const [data, total, sumTotal] = await this.prisma.$transaction([
      this.prisma.externalDeposit.findMany({
        where: { userId: req.user.id },
        skip,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.prisma.externalDeposit.count({
        where: { userId: req.user.id },
      }),
      this.prisma.externalDeposit.aggregate({
        where: { userId: req.user.id, status: 'finished' },
        _sum: {
          paidAmount: true,
        },
      }),
    ]);

    return {
      page: pageNum,
      limit: pageSize,
      total,
      sumTotal: sumTotal._sum.paidAmount || 0,
      totalPages: Math.ceil(total / pageSize),
      data,
    };
  }

  @UseGuards(JwtAuthGuard)
  @SkipCacheInvalidation()
  @Post('transactions')
  async getTransactions(@Req() req, @Body() body: any) {
    const dto = body.data ?? body;

    return this.svc.getWalletTransactions(
      req.user.id,
      req.user.role,
      dto.walletType,
      dto.skip ?? 0,
      dto.take ?? 20,
      dto?.filters ?? {}
    );
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 30, namespace: 'wallet', scope: 'user' })
  @Get('income/binary')
  async getBinaryIncome(
    @Req() req,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.svc.getBinaryIncome(
      req.user.id,
      Number(skip) || 0,
      Number(take) || 20,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 30, namespace: 'wallet', scope: 'user' })
  @Get('income/direct')
  async getDirectIncome(
    @Req() req,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.svc.getDirectIncome(
      req.user.id,
      Number(skip) || 0,
      Number(take) || 20,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 30, namespace: 'wallet', scope: 'user' })
  @Get('income/referral')
  async getReferralIncome(
    @Req() req,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.svc.getReferralIncome(
      req.user.id,
      Number(skip) || 0,
      Number(take) || 20,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 45, namespace: 'wallet', scope: 'user' })
  @Get('income/gain-report')
  async gainReport(
    @Req() req,
    @Query('type') type: TransactionType,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('self') self?: string,
  ) {
    return this.svc.getGainReport(
      req.user.id,
      type,
      from ? parseQueryDateStart(from) : undefined,
      to ? parseQueryDateEnd(to) : undefined,
      Number(skip) || 0,
      Number(take) || 20,
      self
    );
  }

  // ---- CREATE USER WALLET ----
  @UseGuards(JwtAuthGuard)
  @Post('/create-external-wallet')
  async createWallet(
    @Req() req,
    @Body() body: { supportedWalletId: number; address: string },
  ) {
    if (!body.supportedWalletId || !body.address)
      throw new BadRequestException('supportedWalletId and address required');

    return this.svc.createUserWallet(req.user.id, body);
  }

  // ---- UPDATE USER WALLET (respects change limit) ----
  @UseGuards(JwtAuthGuard)
  @Put(':walletId/update-external-wallet')
  async updateWallet(
    @Req() req,
    @Param('walletId') walletId: string,
    @Body() body: { address: string },
  ) {
    return this.svc.updateUserWallet(req.user.id, {
      walletId: Number(walletId),
      address: body.address,
    });
  }

  // ---- DELETE USER WALLET ----
  @UseGuards(JwtAuthGuard)
  @Delete(':walletId/delete-external-wallet')
  async deleteWallet(@Req() req, @Param('walletId') walletId: string) {
    return this.svc.deleteUserWallet(req.user.id, Number(walletId));
  }

  // ---- LIST MY WALLETS ----
  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 60, namespace: 'wallet', scope: 'user' })
  @Get('my-external-wallets')
  async listMyWallets(@Req() req) {
    return this.svc.listUserWallets(req.user.id);
  }

  // ---- ADMIN: LIST SUPPORTED WALLET TYPES ----
  @UseGuards(JwtAuthGuard)
  @Cacheable({ ttlSeconds: 300, namespace: 'wallet', scope: 'global' })
  @Get('admin/supported-wallet-types')
  async listSupportedWallets() {
    return this.svc.listSupportedWallets();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admin/create-external-wallet-type')
  async createWalletType(
    @Body()
    body: {
      name: string;
      currency: string;
      allowedChangeCount: number;
    },
  ) {
    return this.svc.upsertSupportedWallet(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Put('admin/:id/update-external-wallet-type')
  async updateWalletType(
    @Param('id') id: string,
    @Body()
    body: {
      name: string;
      currency: string;
      allowedChangeCount: number;
    },
  ) {
    return this.svc.upsertSupportedWallet({
      id: Number(id),
      ...body,
    });
  }

  // ---- DELETE SUPPORTED WALLET ----
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete('admin.:id/delete-external-wallet-type')
  async deleteWalletType(@Param('id') id: string) {
    return this.svc.deleteSupportedWallet(Number(id));
  }

  // ---- ADMIN OVERRIDE USER WALLET ----
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Put('admin/:walletId/override-external-wallet')
  async overrideWallet(
    @Req() req,
    @Param('walletId') walletId: string,
    @Body() body: { address: string },
  ) {
    return this.svc.adminUpdateUserWallet({
      walletId: Number(walletId),
      address: body.address,
      adminId: req.user.id,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Cacheable({ ttlSeconds: 15, namespace: 'wallet', scope: 'user' })
  @Get('admin/deposits')
  async listAllDeposits(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.max(parseInt(limit, 10) || 10, 1);
    const skip = (pageNum - 1) * pageSize;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.externalDeposit.findMany({
        skip,
        take: pageSize,
        orderBy: { id: 'desc' },
        include: {
          user: true,
        },
      }),
      this.prisma.externalDeposit.count(),
    ]);

    return {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Cacheable({ ttlSeconds: 30, namespace: 'wallet', scope: 'user' })
  @Get('admin/deposits/:id')
  getDeposit(@Param('id') id: string) {
    return this.prisma.externalDeposit.findUnique({
      where: { id: Number(id) },
    });
  }
}
