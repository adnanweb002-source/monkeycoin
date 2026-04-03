import { IsEmail, IsNotEmpty, IsOptional } from 'class-validator';

export class LoginDto {
  @IsNotEmpty()
  phoneOrEmail: string;

  @IsNotEmpty()
  password: string;

  // optional 2FA code if required
  @IsOptional()
  code?: string;
}
