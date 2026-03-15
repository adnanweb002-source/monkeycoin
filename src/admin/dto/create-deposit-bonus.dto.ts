import { IsInt, IsDateString, Min, Max } from 'class-validator';

export class CreateDepositBonusDto {
  @IsInt()
  @Min(1)
  @Max(100)
  bonusPercentage: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}