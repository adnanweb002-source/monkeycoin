import { IsDecimal, IsInt } from 'class-validator';

export class PurchasePackageDto {
  @IsInt()
  packageId: number;

  @IsDecimal()
  amount: string;
}
