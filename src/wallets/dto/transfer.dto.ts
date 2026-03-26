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

  @IsEnum(['D_WALLET', 'P_WALLET', 'E_WALLET', 'A_WALLET'])
  fromWalletType: 'D_WALLET' | 'P_WALLET' | 'E_WALLET' | 'A_WALLET';

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
