import { IsNotEmpty, Length } from 'class-validator';

export class ChangePasswordDto {
  @IsNotEmpty()
  oldPassword: string;

  @Length(8, 128)
  newPassword: string;

  @IsNotEmpty()
  twoFactorCode: string;
}
