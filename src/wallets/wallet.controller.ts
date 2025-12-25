// wallet.controller.ts (example)
import { Controller, Post, Body, Param, Req, Get } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt.auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { UseGuards } from '@nestjs/common';
import { TransferDto } from './dto/transfer.dto';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { WalletType } from '@prisma/client';

@Controller('wallet')
export class WalletController {
  constructor(private svc: WalletService) {}

  @UseGuards(JwtAuthGuard)
  @Get('user-wallets')
  async getUserWallets(@Req() req) {
    return this.svc.getUserWallets(req.user.id);
  }

  @Post('transfer')
  async transfer(@Body() dto: any) {
    return this.svc.transferFunds(dto);
  }

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
    @Body() body: { skip?: number; take?: number; status?: string },
  ) {
    return this.svc.getWithdrawalRequests(
      req.user.id,
      body.skip ?? 0,
      body.take ?? 20,
      body.status,
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
      body.skip ?? 0,
      body.take ?? 20,
      body.status,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('transactions')
  async getTransactions(
    @Req() req,
    @Body() body: { skip?: number; take?: number; walletType: WalletType },
  ) {
    return this.svc.getWalletTransactions(
      req.user.id,
      body.walletType,
      body.skip ?? 0,
      body.take ?? 20,
    );
  }

}