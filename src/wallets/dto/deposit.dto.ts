import { IsDecimal, IsNotEmpty, IsString } from 'class-validator';

export class CreateCryptoDepositDto {
  @IsDecimal()
  amount: string; // USD

  @IsString()
  @IsNotEmpty()
  crypto: string; // e.g. USDTTRC20, BTC
}
