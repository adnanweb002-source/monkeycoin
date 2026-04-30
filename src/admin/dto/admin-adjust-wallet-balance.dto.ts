import { WalletType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class AdminAdjustWalletBalanceDto {
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @IsEnum(WalletType)
  walletType: WalletType;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'balance must be a valid non-negative amount with up to 2 decimals',
  })
  balance: string;

  @IsString()
  @IsNotEmpty()
  twoFactorCode: string;

  @IsString()
  @IsNotEmpty()
  keySalt: string;

  @IsString()
  @IsNotEmpty()
  requestTs: string;

  @IsString()
  @IsNotEmpty()
  dynamicKey: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
