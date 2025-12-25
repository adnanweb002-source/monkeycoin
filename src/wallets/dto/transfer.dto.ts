import {
  IsDecimal,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
export class TransferDto {
  @IsInt()
  fromUserId: number;

  @IsEnum(['F_WALLET', 'I_WALLET', 'M_WALLET', 'BONUS_WALLET'])
  fromWalletType: 'F_WALLET' | 'I_WALLET' | 'M_WALLET' | 'BONUS_WALLET';

  @IsString()
  @IsNotEmpty()
  toMemberId: string; 

  @IsDecimal()
  amount: string;

  @IsOptional()
  @IsInt()
  requestedByUserId?: number; 

  @IsOptional()
  twoFactorVerified?: boolean;
}
