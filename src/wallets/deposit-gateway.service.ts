import axios from 'axios';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class NowPaymentsService {
  constructor(private prisma: PrismaService) {}

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

    return res.data;
  }
}
