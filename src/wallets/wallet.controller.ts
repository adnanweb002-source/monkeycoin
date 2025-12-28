// wallet.controller.ts (example)
import { Controller, Post, Body, Param, Req, Get, Query } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { UseGuards } from '@nestjs/common';
import { TransferDto } from './dto/transfer.dto';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { WalletType } from '@prisma/client';

@Controller('wallet')
export class WalletController {
  constructor(private svc: WalletService) {}

  @UseGuards(JwtAuthGuard)
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
  async withdraw(@Body() dto: any) {
    return this.svc.createWithdrawRequest(dto);
  }

  // webhook for deposit confirmations (call by payment gateway)
  @Post('webhook/deposit')
  async depositWebhook(@Body() payload: any) {
    // validate payload signature, etc.
    const { userId, amount, externalTxId, meta } = payload;
    return this.svc.handleDepositConfirmation({
      userId,
      amount,
      externalTxId,
      meta,
    });
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

  @UseGuards(JwtAuthGuard)
  @Post('transactions')
  async getTransactions(@Req() req, @Body() body: any) {
    const dto = body.data ?? body;

    return this.svc.getWalletTransactions(
      req.user.id,
      req.user.role,
      dto.walletType,
      dto.skip ?? 0,
      dto.take ?? 20,
    );
  }

  @UseGuards(JwtAuthGuard)
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
}
