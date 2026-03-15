import { IsOptional, IsInt, IsDateString, Min, Max } from 'class-validator';

export class UpdateDepositBonusDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  bonusPercentage?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}