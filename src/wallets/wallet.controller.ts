// wallet.controller.ts (example)
import { Controller, Post, Body, Param, Req } from '@nestjs/common';
import { WalletService } from './wallet.service';

@Controller('wallet')
export class WalletController {
  constructor(private svc: WalletService) {}

  // @Post('create-for-user/:userId')
  // async createForUser(@Param('userId') userId: string) {
  //   await this.svc.createWalletsForUser(Number(userId));
  //   return { ok: true };
  // }

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

  @Post('admin/deposits/:id/approve')
  approveDeposit(@Param('id') id: string, @Req() req) {
    return this.svc.approveDeposit(Number(id), req.user.id);
  }

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
}
