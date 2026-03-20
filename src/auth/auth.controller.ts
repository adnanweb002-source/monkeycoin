import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Get,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
  Param,
  Query,
  Ip,
  Req,
  HttpCode,
  Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordLessLoginDto } from './dto/password-less-login.dto';
import { JwtAuthGuard } from './jwt.auth.guard';
import { ChangePasswordDto } from './dto/change-password.dto';
import { EmailChangeDto } from './dto/email-change.dto';
import { TwoFactorService } from './twofactor.service';
import { AvatarChangeDto } from './dto/avatar-change.dto';
import { Request as Rqst, Response } from 'express';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { Role } from './enums/role.enum';
import { ProfileChangeDto } from './dto/profile-update-dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res,
  ) {
    const {
      id,
      memberId,
      email,
      phone,
      firstName,
      lastName,
      country,
      sponsorId,
      parentId,
      position,
      accessToken,
      refreshToken,
    } = await this.authService.register(dto, ip);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      domain: process.env.NODE_ENV === 'production' ? '.gogex.xyz' : undefined,
      path: '/',
    };

    res.cookie('access_token', accessToken, {
      ...cookieOptions,
      maxAge: 55 * 60 * 1000,
    });

    res.cookie('refresh_token', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return {
      id,
      memberId,
      email,
      phone,
      firstName,
      lastName,
      country,
      sponsorId,
      parentId,
      position,
    };
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res,
  ) {
    const { accessToken, refreshToken } = await this.authService.login(dto, ip);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      domain: process.env.NODE_ENV === 'production' ? '.gogex.xyz' : undefined,
      path: '/',
    };

    res.cookie('access_token', accessToken, {
      ...cookieOptions,
      maxAge: 55 * 60 * 1000, // 15 min
    });

    res.cookie('refresh_token', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return {
      ok: true,
    };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req, @Res({ passthrough: true }) res) {
    const refreshToken = req.cookies?.refresh_token;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing');
    }

    const tokens = await this.authService.refresh(refreshToken);

    // set new cookies
    res.cookie('access_token', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',
      domain: process.env.NODE_ENV === 'production' ? '.gogex.xyz' : undefined,
      path: '/',
      maxAge: 55 * 60 * 1000,
    });

    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',
      domain: process.env.NODE_ENV === 'production' ? '.gogex.xyz' : undefined,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Request() req, @Res({ passthrough: true }) res) {
    res.clearCookie('access_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? '.gogex.xyz' : undefined,
    });
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.NODE_ENV === 'production' ? '.gogex.xyz' : undefined,
    });
    return {
      ok: true,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @Request() req,
    @Body() dto: ChangePasswordDto,
    @Ip() ip: string,
  ) {
    return this.authService.changePassword(req.user.id, dto, ip);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-email')
  async changeEmail(@Request() req, @Body() dto: EmailChangeDto) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded
      ? (forwarded as string).split(',')[0]
      : req.socket.remoteAddress;
    return this.authService.changeEmail(req.user.id, dto, ip);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-avatar')
  async changeAvatar(@Request() req, @Body() dto: AvatarChangeDto) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded
      ? (forwarded as string).split(',')[0]
      : req.socket.remoteAddress;
    console.log('the ip address', ip, forwarded);
    return this.authService.changeAvatar(req.user.id, dto, ip);
  }

  @UseGuards(JwtAuthGuard)
  @Post('update-user-profile')
  async updateProfile(@Request() req, @Body() dto: ProfileChangeDto) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded
      ? (forwarded as string).split(',')[0]
      : req.socket.remoteAddress;
    return this.authService.updateUserProfile(req.user.id, dto, ip);
  }

  // 2FA setup
  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  async setup2fa(@Request() req) {
    return this.twoFactorService.generateSetup(req.user.id, req.user.email);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/verify')
  async verify2fa(
    @Request() req,
    @Body('code') code: string,
    @Ip() ip: string,
  ) {
    return this.twoFactorService.verifyAndEnable(
      req.user.id,
      code,
      ip,
      req.user.id,
    );
  }

  // Request reset link (email)
  // @Post('2fa/reset/request')
  // async request2faReset(@Body('email') email: string) {
  //   return this.twoFactorService.requestReset(email);
  // }

  // Admin backdoor: reset 2fa for user (requires admin role) — this is a sample, hook into RBAC
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admin/users/:id/2fa-reset')
  async adminReset2fa(
    @Request() req,
    @Param('id') userId: string,
    @Ip() ip: string,
  ) {
    // NOTE: enforce admin role in real world (additional guard)
    if (!req.user || !req.user.role || req.user.role != 'ADMIN') {
      throw new ForbiddenException('Admin role required');
    }
    return this.twoFactorService.adminReset(
      parseInt(userId, 10),
      req.user.id,
      ip,
    );
  }

  // Admin Backdoor Login to User Account
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admin-login-for-user')
  async adminPasswordLessLogin(
    @Body() dto: PasswordLessLoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res,
    @Request() req,
  ) {
    const { accessToken, refreshToken } =
      await this.authService.passwordLessloginForAdminOnly(
        req.user.id,
        dto,
        ip,
      );

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      domain: process.env.NODE_ENV === 'production' ? '.gogex.xyz' : undefined,
      path: '/',
    };

    res.cookie('access_token', accessToken, {
      ...cookieOptions,
      maxAge: 55 * 60 * 1000, // 15 min
    });

    res.cookie('refresh_token', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return {
      ok: true,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('/get-profile')
  async getUserProfile(@Request() req) {
    return this.authService.getProfile(req.user.id);
  }

  @Post('/forgot-password')
  async forgotPassword(@Body('email') email: string, @Ip() ip: string) {
    return this.authService.requestPasswordReset(email, ip);
  }

  @Post('/reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Request() req,
    @Ip() ip: string,
  ) {
    return this.authService.resetPassword(
      dto.email,
      dto.token,
      dto.newPassword,
      ip,
    );
  }

  @Post('/request-2fa-reset')
  async requestTwoFactorReset(
    @Body('email') email: string,
    @Body('memberId') memberId: string,
    @Request() req,
    @Ip() ip: string,
  ) {
    return this.twoFactorService.requestReset(email, memberId, ip);
  }

  @Post('/request-2fa-reset-by-admin')
  async requestTwoFactorResetByAdmin(
    @Body('email') email: string,
    @Body('memberId') memberId: string,
    @Request() req,
  ) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded
      ? (forwarded as string).split(',')[0]
      : req.socket.remoteAddress;
    return this.twoFactorService.requestAdmin2FaReset(email, memberId, ip);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/change/initiate')
  async initiate2faChange(@Request() req, @Body('oldCode') oldCode: string) {
    if (!oldCode) {
      throw new BadRequestException('Old 2FA code is required');
    }

    return this.twoFactorService.initiateChange(req.user.id, oldCode);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/change/confirm')
  async confirm2faChange(
    @Request() req,
    @Body('newCode') newCode: string,
    @Ip() ip: string,
  ) {
    if (!newCode) {
      throw new BadRequestException('New 2FA code is required');
    }

    return this.twoFactorService.confirmChange(req.user.id, newCode, ip);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('admin/2fa-reset-requests')
  async getManual2faResetRequests(
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;

    return this.twoFactorService.getManualResetRequests(
      parsedPage,
      parsedLimit,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post('admin/2fa-reset-requests/:id/status')
  async updateManual2faRequestStatus(
    @Param('id') id: string,
    @Body('status') status: 'APPROVED' | 'REJECTED',
    @Request() req,
    @Ip() ip: string,
  ) {
    if (!req.user || req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin role required');
    }

    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
      throw new BadRequestException('Invalid status');
    }

    return this.twoFactorService.updateManualResetRequestStatus(
      parseInt(id, 10),
      status,
      req.user.id,
      ip,
    );
  }

  @Post('/reset-2fa')
  async resetTwoFactor(
    @Body('email') email: string,
    @Body('token') token: string,
    @Ip() ip: string,
    @Request() req,
  ) {
    return this.twoFactorService.resetTwoFactor(email, token, ip);
  }
}
