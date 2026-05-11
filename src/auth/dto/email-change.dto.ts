import { IsEmail, IsOptional } from 'class-validator';

export class EmailChangeDto {
  @IsEmail()
  newEmail: string;

  @IsOptional() 
  twoFactorCode?: string;
}
