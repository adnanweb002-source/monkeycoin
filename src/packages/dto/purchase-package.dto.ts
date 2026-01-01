import { IsDecimal, IsInt, IsOptional } from 'class-validator';

export class PurchasePackageDto {
  @IsInt()
  packageId: number;

  @IsDecimal()
  amount: string;

  @IsOptional()
  userId?: number;

  // percentage split by wallet
  split: Record<string, number>; 
  // example:
  // { F_WALLET: 40, M_WALLET: 60 }
}
