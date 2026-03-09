import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from 'src/notifications/notifcations.service';

@Injectable()
export class NowPaymentsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  private api = process.env.NOWPAYMENTS_BASE;
  private key = process.env.NOWPAYMENTS_API_KEY;

  async createPayment(params: {
    userId: number;
    amountUsd: string;
    crypto: string;
    depositId: number;
  }) {
    const res = await axios.post(
      `${this.api}/payment`,
      {
        price_amount: params.amountUsd,
        price_currency: 'USD',
        pay_currency: params.crypto,
        order_id: params.depositId.toString(),
        ipn_callback_url: `${process.env.BASE_URL}/payments/ipn`,
      },
      { headers: { 'x-api-key': this.key } },
    );

    await this.notificationsService.createNotification(
      params.userId,
      'Payment Created',
      `Your payment of ${params.amountUsd} USD in ${params.crypto} has been initiated. Please complete the payment to credit your F-Wallet.`,
      false,
      undefined,
      undefined,
      '/wallet/deposit-history',
    );

    return res.data;
  }
}
