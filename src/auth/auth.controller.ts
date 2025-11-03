import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Get,
  ForbiddenException,
  Param,
  Query,
  Ip,
  Req,
  HttpCode,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt.auth.guard';
import { ChangePasswordDto } from './dto/change-password.dto';
import { EmailChangeDto } from './dto/email-change.dto';
import { TwoFactorService } from './twofactor.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.authService.register(dto, ip);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Request() req) {
    return this.authService.logout(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto, @Ip() ip: string) {
    return this.authService.changePassword(req.user.id, dto, ip);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-email')
  async changeEmail(@Request() req, @Body() dto: EmailChangeDto, @Ip() ip: string) {
    return this.authService.changeEmail(req.user.id, dto, ip);
  }

  // 2FA setup
  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  async setup2fa(@Request() req) {
    return this.twoFactorService.generateSetup(req.user.id, req.user.email);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/verify')
  async verify2fa(@Request() req, @Body('code') code: string, @Ip() ip: string) {
    return this.twoFactorService.verifyAndEnable(req.user.id, code, ip, req.user.id);
  }

  // Request reset link (email)
  @Post('2fa/reset/request')
  async request2faReset(@Body('email') email: string) {
    return this.twoFactorService.requestReset(email);
  }

  // Admin backdoor: reset 2fa for user (requires admin role) — this is a sample, hook into RBAC
  @UseGuards(JwtAuthGuard)
  @Post('admin/users/:id/2fa-reset')
  async adminReset2fa(@Request() req, @Param('id') userId: string, @Ip() ip: string) {
    // NOTE: enforce admin role in real world (additional guard)
    if (!req.user || !req.user.roles || !req.user.roles.includes('ADMIN')) {
      throw new ForbiddenException('Admin role required');
    }
    return this.twoFactorService.adminReset(parseInt(userId, 10), req.user.id, ip);
  }
}
