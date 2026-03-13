import {IsNotEmpty } from 'class-validator';

export class PasswordLessLoginDto {
  @IsNotEmpty()
  phoneOrEmail: string;
}
