import { IsOptional, IsEnum, IsDecimal } from 'class-validator';
import { TargetMultiplier, TargetSalesType } from '@prisma/client';

export class UpdateTargetDto {
  @IsEnum(TargetMultiplier)
  multiplier: TargetMultiplier;

  @IsEnum(TargetSalesType)
  salesType: TargetSalesType;

  @IsDecimal()
  targetAmount: string;

  @IsDecimal()
  packageAmount: string;
}