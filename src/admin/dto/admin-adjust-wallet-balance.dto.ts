import { WalletType } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class AdminAdjustWalletBalanceDto {
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @IsEnum(WalletType)
  walletType: WalletType;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a valid positive amount with up to 2 decimals',
  })
  amount: string;

  @IsString()
  @IsIn(['CREDIT', 'DEBIT'])
  direction: 'CREDIT' | 'DEBIT';

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
