import { IsNotEmpty, Length, IsOptional } from 'class-validator';

export class ChangePasswordDto {
  @IsNotEmpty()
  oldPassword: string;

  @Length(8, 128)
  newPassword: string;

  @IsOptional()
  twoFactorCode: string;
}
