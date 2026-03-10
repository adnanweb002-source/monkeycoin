import { IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateRankDto {
  @IsString()
  name: string;

  @IsNumber()
  requiredLeft: number;

  @IsNumber()
  requiredRight: number;

  @IsNumber()
  rewardAmount: number;

  @IsOptional()
  @IsString()
  rewardTitle?: string;

  @IsNumber()
  order: number;
}