import { IsDecimal, IsEnum, IsString, IsObject } from 'class-validator';
import { TargetMultiplier, TargetSalesType } from '@prisma/client';

export class AssignTargetDto {
  @IsString()
  memberId: string;

  @IsObject()
  split: Record<string, number>;

  @IsDecimal()
  packageAmount: string;

  @IsEnum(TargetMultiplier)
  targetMultiplier: TargetMultiplier;

  @IsEnum(TargetSalesType)
  targetType: TargetSalesType;

  @IsDecimal()
  targetNeededToUnlockDailyRoi: string;
}
