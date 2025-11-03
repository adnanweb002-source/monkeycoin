import { IsEmail, IsNotEmpty, IsOptional, Length } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty()
  username: string;

  @IsEmail()
  email: string;

  @Length(8, 128)
  password: string;

  @IsOptional()
  sponsorMemberId?: string;

  @IsOptional()
  parentMemberId?: string;

  @IsOptional()
  position?: 'LEFT' | 'RIGHT';
}
