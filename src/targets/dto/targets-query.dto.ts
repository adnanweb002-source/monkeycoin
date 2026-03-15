import { IsOptional, IsInt, IsEnum, IsBoolean, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { TargetSalesType } from '@prisma/client';

export class TargetsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number = 20;

  @IsOptional()
  @IsString()
  memberId?: string;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @IsEnum(TargetSalesType)
  salesType?: TargetSalesType;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}