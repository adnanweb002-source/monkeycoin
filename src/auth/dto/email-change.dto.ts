import { IsEmail, IsNotEmpty } from 'class-validator';

export class EmailChangeDto {
  @IsEmail()
  newEmail: string;

  @IsNotEmpty()
  twoFactorCode: string;
}
