import {
  IsDecimal,
  IsInt,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsString,
  IsObject,
} from 'class-validator';
import { TargetMultiplier, TargetSalesType } from '@prisma/client';

export class PurchasePackageDto {
  @IsInt()
  packageId: number;

  @IsDecimal()
  amount: string;

  @IsOptional()
  @IsString()
  userId?: string; // memberId of target user

  // percentage split by wallet
  @IsObject()
  split: Record<string, number>;
  // example:
  // { F_WALLET: 40, M_WALLET: 60 }

  @IsOptional()
  @IsBoolean()
  isTarget?: boolean;

  @IsOptional()
  @IsEnum(TargetMultiplier)
  targetMultiplier?: TargetMultiplier;

  @IsOptional()
  @IsEnum(TargetSalesType)
  targetType?: TargetSalesType;

  @IsOptional()
  @IsDecimal()
  targetNeededToUnlockDailyRoi?: string;
}