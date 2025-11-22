// wallet.controller.ts (example)
import { Controller, Post, Body, Param } from '@nestjs/common';
import { WalletService } from './wallet.service';

@Controller('wallet')
export class WalletController {
  constructor(private svc: WalletService) {}

  @Post('create-for-user/:userId')
  async createForUser(@Param('userId') userId: string) {
    await this.svc.createWalletsForUser(Number(userId));
    return { ok: true };
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
    return this.svc.handleDepositConfirmation({ userId, amount, externalTxId, meta });
  }
}
