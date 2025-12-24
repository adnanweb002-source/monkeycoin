import { IsEmail, IsNotEmpty } from 'class-validator';

export class LoginDto {
  @IsNotEmpty()
  phoneOrEmail: string;

  @IsNotEmpty()
  password: string;

  // optional 2FA code if required
  code?: string;
}
