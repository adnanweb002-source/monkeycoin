import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class BroadcastNotificationDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsBoolean()
  sendEmail: boolean;

  @IsOptional()
  @IsString()
  emailSubject?: string;

  @IsOptional()
  @IsString()
  redirectUrl?: string;
}
