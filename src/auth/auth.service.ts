import { Injectable, BadRequestException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RegisterDto } from './dto/register.dto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';
import { Prisma } from '@prisma/client';
import { TwoFactorService } from './twofactor.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private cfg: ConfigService,
    private twoFactor: TwoFactorService,
  ) {}

  private async hashPassword(password: string) {
    return argon2.hash(password);
  }

  private async verifyPassword(hash: string, password: string) {
    return argon2.verify(hash, password);
  }

  async  register(dto: RegisterDto, ip: string) {
    // Basic uniqueness checks
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { username: dto.username }],
      },
    });
    if (existing) {
      throw new ConflictException('Email or username already in use');
    }

    const passwordHash = await this.hashPassword(dto.password);

    // TODO: validate sponsor/parent existence, placement logic; for now accept optional sponsor/parent.

    if (dto.sponsorMemberId) {
      const sponsor = await this.prisma.user.findUnique({ where: { memberId: dto.sponsorMemberId } });
      if (!sponsor) throw new BadRequestException('Invalid sponsorMemberId');
    }
    if (dto.parentMemberId) {
      const parent = await this.prisma.user.findUnique({ where: { memberId: dto.parentMemberId } });
      if (!parent) throw new BadRequestException('Invalid parentMemberId');
    }

    const user = await this.prisma.user.create({
      data: {
        memberId: `M${Date.now()}`, // or use more robust generator
        username: dto.username,
        email: dto.email,
        passwordHash,
        sponsorId: dto.sponsorMemberId ? (await this.prisma.user.findUnique({ where: { memberId: dto.sponsorMemberId } }))?.id : null,
        parentId: dto.parentMemberId ? (await this.prisma.user.findUnique({ where: { memberId: dto.parentMemberId } }))?.id : null,
        // For simplicity, not implementing full binary tree placement logic here
        // In real system, would need to find correct position in tree
        position: dto.position || 'LEFT',
      },
    });

    // Audit
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorType: 'user',
        action: 'REGISTER',
        entity: 'User',
        entityId: user.id,
        ip,
        after: Prisma.JsonNull, // optionally include created user details; careful with sensitive data
      },
    });

    return { id: user.id, memberId: user.memberId, username: user.username };
  }

  async login(dto: LoginDto, ip: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.usernameOrEmail }, { username: dto.usernameOrEmail }],
      },
      include: { twoFactor: true },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await this.verifyPassword(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // If 2FA enabled, verify code
    if (user.twoFactor && user.twoFactor.enabled) {
      if (!dto.code) throw new UnauthorizedException('2FA code required');
      const verified = this.twoFactor.verifyCode(user.twoFactor.secretEnc, dto.code);
      if (!verified) throw new UnauthorizedException('Invalid 2FA code');
    }

    // Issue tokens
    const tokens = await this.issueTokens(user.id);

    // audit
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorType: 'user',
        action: 'LOGIN',
        entity: 'User',
        entityId: user.id,
        ip,
      },
    });

    return tokens;
  }

  private async issueTokens(userId: number) {
    const payload = { sub: userId };
    const at = this.jwtService.sign(payload, {
      secret: this.cfg.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.cfg.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m',
    });

    const rt = this.jwtService.sign(payload, {
      secret: this.cfg.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.cfg.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d',
    });

    // Hash the refresh token before storing
    const rtHash = await argon2.hash(rt);

    const exp = new Date();
    exp.setDate(exp.getDate() + 7); // refresh expiry; align with env in production

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: rtHash,
        userId,
        expiresAt: exp,
      },
    });

    return { accessToken: at, refreshToken: rt };
  }

  async refresh(refreshToken: string) {
    // Verify token signature
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.cfg.get<string>('JWT_REFRESH_SECRET'),
      }) as any;
      const userId = payload.sub;
      // Find token by comparing hash
      const tokens = await this.prisma.refreshToken.findMany({ where: { userId, revoked: false } });

      let match:any = null;
      for (const t of tokens) {
        try {
          const ok = await argon2.verify(t.tokenHash, refreshToken);
          if (ok) {
            match = t;
            break;
          }
        } catch (e) {
          // ignore
        }
      }
      if (!match) throw new UnauthorizedException('Invalid refresh token');

      // Issue new tokens and revoke old refresh token
      await this.prisma.refreshToken.update({ where: { id: match.id }, data: { revoked: true } });
      return this.issueTokens(userId);
    } catch (e) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: number) {
    // Revoke all refresh tokens for user (or only current one if we tracked id)
    await this.prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } });
    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: 'user',
        action: 'LOGOUT',
        entity: 'User',
        entityId: userId,
      },
    });
    return { ok: true };
  }

  async changePassword(userId: number, dto: any, ip: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { twoFactor: true } });
    if (!user) throw new UnauthorizedException('User not found');

    const ok = await this.verifyPassword(user.passwordHash, dto.oldPassword);
    if (!ok) throw new UnauthorizedException('Old password incorrect');

    // verify 2FA
    if (user.twoFactor && user.twoFactor.enabled) {
      const verified = this.twoFactor.verifyCode(user.twoFactor.secretEnc, dto.twoFactorCode);
      if (!verified) throw new UnauthorizedException('Invalid 2FA code');
    }

    const newHash = await this.hashPassword(dto.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });

    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: 'user',
        action: 'PASSWORD_CHANGE',
        entity: 'User',
        entityId: userId,
        ip,
      },
    });

    // revoke refresh tokens on password change
    await this.prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } });

    return { ok: true };
  }

  async changeEmail(userId: number, dto: any, ip: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { twoFactor: true } });
    if (!user) throw new UnauthorizedException('User not found');

    // verify 2FA
    if (user.twoFactor && user.twoFactor.enabled) {
      const verified = this.twoFactor.verifyCode(user.twoFactor.secretEnc, dto.twoFactorCode);
      if (!verified) throw new UnauthorizedException('Invalid 2FA code');
    }

    // ensure new email not already used
    const exist = await this.prisma.user.findUnique({ where: { email: dto.newEmail } });
    if (exist) throw new ConflictException('Email already in use');

    const before = { email: user.email };
    await this.prisma.user.update({ where: { id: userId }, data: { email: dto.newEmail } });

    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: 'user',
        action: 'EMAIL_CHANGE',
        entity: 'User',
        entityId: userId,
        ip,
        before,
        after: { email: dto.newEmail },
      },
    });

    // In a real system send verification link to new email to validate before enabling.
    return { ok: true };
  }
}
