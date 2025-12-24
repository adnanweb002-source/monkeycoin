import { IsBoolean, IsDecimal, IsInt, IsNotEmpty, IsString } from 'class-validator';

export class CreatePackageDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsDecimal()
  investmentMin: string;

  @IsDecimal()
  investmentMax: string;

  @IsDecimal()
  dailyReturnPct: string;

  @IsInt()
  durationDays: number;

  @IsDecimal()
  capitalReturn: string;

  @IsBoolean()
  isActive: boolean;
}
