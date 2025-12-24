import { IsEmail, IsNotEmpty, IsOptional, Length, IsPhoneNumber } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty()
  firstName: string;

  @IsNotEmpty()
  lastName: string;

  @IsNotEmpty()
  phone: string;

  @IsNotEmpty()
  country: string;

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
