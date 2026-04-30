import { IsNotEmpty, IsString } from 'class-validator';

export class AdminWalletAdjustChallengeDto {
  @IsString()
  @IsNotEmpty()
  memberId: string;
}
