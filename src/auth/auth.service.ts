import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RegisterDto } from './dto/register.dto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';
import { PasswordLessLoginDto } from './dto/password-less-login.dto';
import { TwoFactorService } from './twofactor.service';
import { WalletService } from 'src/wallets/wallet.service';
import { WalletType, TransactionType, Position } from '@prisma/client';
import { NotificationsService } from 'src/notifications/notifcations.service';
import * as crypto from 'crypto';
import { EmailTemplates } from 'src/mail/templates/email.templates';
import axios from 'axios';
import { ProfileChangeDto } from './dto/profile-update-dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private cfg: ConfigService,
    private twoFactor: TwoFactorService,
    private walletService: WalletService,
    private notificationsService: NotificationsService,
  ) {}

  private async hashPassword(password: string) {
    return argon2.hash(password);
  }

  private async verifyPassword(hash: string, password: string) {
    return argon2.verify(hash, password);
  }

  private async findAvailablePlacement(
    startParentId: number,
    preferredPosition?: Position,
  ) {
    let queue = [startParentId];

    while (queue.length) {
      const pid = queue.shift()!;

      // If a preferred position is provided
      if (preferredPosition) {
        const existing = await this.prisma.user.findFirst({
          where: { parentId: pid, position: preferredPosition },
          select: { id: true },
        });

        // If slot is empty → return immediately
        if (!existing) {
          return { parentId: pid, position: preferredPosition };
        }

        // If filled → go deeper ONLY on that side
        queue.push(existing.id);
        continue;
      }

      // Default behavior (normal BFS both sides)

      // Check LEFT
      const left = await this.prisma.user.findFirst({
        where: { parentId: pid, position: Position.LEFT },
        select: { id: true },
      });

      if (!left) {
        return { parentId: pid, position: Position.LEFT };
      }

      // Check RIGHT
      const right = await this.prisma.user.findFirst({
        where: { parentId: pid, position: Position.RIGHT },
        select: { id: true },
      });

      if (!right) {
        return { parentId: pid, position: Position.RIGHT };
      }

      // Both filled → go deeper
      queue.push(left.id);
      queue.push(right.id);
    }

    throw new BadRequestException('No available slot in tree');
  }

  private async generateUniqueMemberId(): Promise<string> {
    while (true) {
      const memberId = `V${crypto.randomInt(10000000, 100000000)}`; // V + 8 digits

      const existing = await this.prisma.user.findUnique({
        where: { memberId },
        select: { id: true },
      });

      if (!existing) {
        return memberId;
      }
    }
  }

  async register(dto: RegisterDto, ip: string) {
    const {
      firstName,
      lastName,
      phone,
      country,
      email,
      password,
      sponsorMemberId,
      parentMemberId,
      position,
    } = dto;

    // -----------------------------
    // 1. Unique Check
    // -----------------------------
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { phoneNumber: phone }] },
    });

    if (existing) {
      throw new ConflictException('Email or phone number already in use');
    }

    // -----------------------------
    // 2. Hash Password
    // -----------------------------
    const passwordHash = await this.hashPassword(password);

    // -----------------------------
    // 3. Resolve Sponsor
    // -----------------------------
    let sponsorId: number;

    if (sponsorMemberId) {
      const sponsor = await this.prisma.user.findUnique({
        where: { memberId: sponsorMemberId },
      });
      if (!sponsor) throw new BadRequestException('Invalid sponsorMemberId');
      sponsorId = sponsor.id;
    } else {
      sponsorId = 1; // COMPANY ROOT
    }

    // -----------------------------
    // 4. Resolve Parent
    // -----------------------------
    let parentId;
    let finalPosition = (position ?? 'RIGHT') as 'LEFT' | 'RIGHT';

    if (parentMemberId) {
      const parent = await this.prisma.user.findUnique({
        where: { memberId: parentMemberId },
      });
      if (!parent) throw new BadRequestException('Invalid parentMemberId');

      parentId = parent.id;
    } else {
      const parent = await this.findAvailablePlacement(sponsorId, position);

      parentId = parent.parentId;
      finalPosition = parent.position;
    }

    // -----------------------------
    // 5. Check if slot is already filled
    // -----------------------------
    const slotTaken = await this.prisma.user.findFirst({
      where: {
        parentId,
        position: finalPosition,
      },
    });

    console.log(
      `Checking slot for parentId ${parentId} and position ${finalPosition}:`,
      slotTaken,
    );

    if (slotTaken) {
      throw new BadRequestException(
        `Position ${finalPosition} under parent ${parentMemberId ?? 'COMPANY'} is already occupied.`,
      );
    }

    // -----------------------------
    // 6. Transaction (User + Wallets + Audit)
    // -----------------------------
    // Member ID has to be V and then 8 digits
    const memberId = await this.generateUniqueMemberId();
    const result = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          memberId: memberId,
          firstName,
          lastName,
          phoneNumber: phone,
          country,
          email,
          passwordHash,
          sponsorId,
          parentId,
          position: finalPosition,
          status: 'ACTIVE',

          // Ensure these exist in your Prisma schema (you have them)
          g2faSecret: '',
          isG2faEnabled: false,
        },
      });

      console.log('New user created with ID:', newUser.id);

      console.log('Creating wallets for user ID:', newUser.id);
      // Create 4 Wallets
      await this.walletService.createWalletsForUser(tx, newUser.id);

      // Audit Log
      await tx.auditLog.create({
        data: {
          actorId: newUser.id,
          actorType: 'user',
          action: 'REGISTER',
          entity: 'User',
          entityId: newUser.id,
          ip,
          after: { created: true },
        },
      });
      return newUser;
    });

    const html = EmailTemplates.registration(
      result.firstName + ' ' + result.lastName,
      result.memberId,
      dto.password,
      `${process.env.FRONTEND_URL}/login`,
    );

    await this.notificationsService.createNotification(
      result.id,
      'Welcome to Vaultire Infinite!',
      `Your account has been successfully created. Your member ID is ${result.memberId}. Start exploring our platform and enjoy the benefits of being part of the Vaultire community!`,
      true,
      html,
      'Welcome Aboard! Your Vaultire Infinite Account is Ready!',
      '/profile',
    );

    // Get the tokens for the new user
    const tokens = await this.issueTokens(result.id);

    // -----------------------------
    // 7. Return Response
    // -----------------------------
    return {
      id: result.id,
      memberId: result.memberId,
      email: result.email,
      phone: result.phoneNumber,
      firstName: result.firstName,
      lastName: result.lastName,
      country: result.country,
      sponsorId,
      parentId,
      position: finalPosition,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async login(dto: LoginDto, ip: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.phoneOrEmail },
          { phoneNumber: dto.phoneOrEmail },
          { memberId: dto.phoneOrEmail },
        ],
      },
      include: { twoFactorSecret: true }, // corrected
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('Account suspended. Contact support.');
    }

    const ok = await this.verifyPassword(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // If 2FA enabled, verify code
    if (user.twoFactorSecret && user.twoFactorSecret.enabled) {
      if (!dto.code) throw new UnauthorizedException('2FA code required');
      const verified = this.twoFactor.verifyCode(
        user.twoFactorSecret.secretEnc,
        dto.code,
      );
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

  async passwordLessloginForAdminOnly(
    userId: number,
    dto: PasswordLessLoginDto,
    ip: string,
  ) {
    const adminUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: userId }],
      },
    });

    if (!adminUser) {
      throw new ForbiddenException('Request forbidden');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.phoneOrEmail },
          { phoneNumber: dto.phoneOrEmail },
          { memberId: dto.phoneOrEmail },
        ],
      },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

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
      const tokens = await this.prisma.refreshToken.findMany({
        where: { userId, revoked: false },
      });

      let match: any = null;
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
      await this.prisma.refreshToken.update({
        where: { id: match.id },
        data: { revoked: true },
      });
      return this.issueTokens(userId);
    } catch (e) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: number) {
    // Revoke all refresh tokens for user (or only current one if we tracked id)
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
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

  async requestPasswordReset(email: string, ip: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Do not reveal if email exists
    if (!user) {
      return { ok: true };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = await argon2.hash(rawToken);

    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + 30); // 30 min expiry

    await this.prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: expiry,
      },
    });

    const frontendUrl = this.cfg.get<string>('FRONTEND_URL');

    const resetLink = `${frontendUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

    const html = EmailTemplates.forgotPassword(
      user.firstName + ' ' + user.lastName,
      resetLink,
    );

    // send email
    await this.notificationsService.createNotification(
      user.id,
      'Reset Your Password',
      `Click the link below to reset your password:\n\n${resetLink}\n\nThis link expires in 30 minutes.`,
      true,
      html,
      'Reset Your Vaultire Infinite Password!',
      '',
      false,
    );

    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorType: 'user',
        action: 'PASSWORD_RESET_REQUEST',
        entity: 'User',
        entityId: user.id,
        ip,
      },
    });

    return { ok: true };
  }

  async getLocation(ip: string) {
    const geo = await axios.get(`http://ip-api.com/json/${ip}`);

    const location = `${geo.data.city}, ${geo.data.country}`;

    return location;
  }

  async resetPassword(
    email: string,
    token: string,
    newPassword: string,
    ip: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) throw new BadRequestException('Something went wrong'); // do not reveal email existence

    const tokens = await this.prisma.passwordResetToken.findMany({
      where: {
        userId: user.id,
        used: false,
      },
    });

    let matchedToken: any = null;

    for (const t of tokens) {
      const valid = await argon2.verify(t.tokenHash, token);
      if (valid) {
        matchedToken = t;
        break;
      }
    }

    if (!matchedToken) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (matchedToken.expiresAt < new Date()) {
      throw new BadRequestException('Reset token expired');
    }

    const newHash = await this.hashPassword(newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      });

      await tx.passwordResetToken.update({
        where: { id: matchedToken.id },
        data: { used: true },
      });

      // revoke refresh tokens
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revoked: false },
        data: { revoked: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorType: 'user',
          action: 'PASSWORD_RESET',
          entity: 'User',
          entityId: user.id,
          ip,
        },
      });
    });

    const location = await this.getLocation(ip);

    const html = EmailTemplates.passwordChanged(
      user.firstName + ' ' + user.lastName,
      new Date().toLocaleString(),
      ip,
      location,
    );

    await this.notificationsService.createNotification(
      user.id,
      'Password Reset Successful',
      'Your password has been successfully reset. If this was not you, contact support immediately.',
      true,
      html,
      'Your Vaultire Infinite Password Was Successfully Updated!',
      '/profile?tab=security',
    );

    return { ok: true };
  }

  async changePassword(userId: number, dto: any, ip: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { twoFactorSecret: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const ok = await this.verifyPassword(user.passwordHash, dto.oldPassword);
    if (!ok) throw new UnauthorizedException('Old password incorrect');

    // verify 2FA
    if (user.twoFactorSecret && user.twoFactorSecret.enabled) {
      const verified = this.twoFactor.verifyCode(
        user.twoFactorSecret.secretEnc,
        dto.twoFactorCode,
      );
      if (!verified) throw new UnauthorizedException('Invalid 2FA code');
    }

    const newHash = await this.hashPassword(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

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
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
    const location = await this.getLocation(ip);
    const html = EmailTemplates.passwordChanged(
      user.firstName + ' ' + user.lastName,
      new Date().toLocaleString(),
      ip,
      location,
    );

    await this.notificationsService.createNotification(
      userId,
      'Password Changed',
      'Your account password was recently changed. If you did not perform this action, please contact our support immediately.',
      true,
      html,
      'Your Vaultire Infinite Password Was Successfully Updated!',
      '/profile?tab=security',
    );

    return { ok: true };
  }

  async changeEmail(userId: number, dto: any, ip: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { twoFactorSecret: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    // verify 2FA
    if (user.twoFactorSecret && user.twoFactorSecret.enabled) {
      const verified = this.twoFactor.verifyCode(
        user.twoFactorSecret.secretEnc,
        dto.twoFactorCode,
      );
      if (!verified) throw new UnauthorizedException('Invalid 2FA code');
    }

    // ensure new email not already used
    const exist = await this.prisma.user.findUnique({
      where: { email: dto.newEmail },
    });
    if (exist) throw new ConflictException('Email already in use');

    const before = { email: user.email };
    await this.prisma.user.update({
      where: { id: userId },
      data: { email: dto.newEmail },
    });

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

    const html = EmailTemplates.profileUpdated(
      user.firstName + ' ' + user.lastName,
      new Date().toLocaleString(),
      ip,
      before.email,
      dto.newEmail,
    );

    await this.notificationsService.createNotification(
      userId,
      'Email Changed',
      `Your account email was recently changed from ${before.email} to ${dto.newEmail}. If you did not perform this action, please contact our support immediately.`,
      true,
      html,
      'Your Profile Has Been Updated',
      '/profile',
    );

    return { ok: true };
  }

  async changeAvatar(userId: number, dto: any, ip: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const before = user;

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarId: dto.avatarId },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: 'user',
        action: 'AVATAR_CHANGE',
        entity: 'User',
        entityId: userId,
        ip,
        before,
        after: { email: dto.avatarId },
      },
    });

    const html = EmailTemplates.profileUpdated(
      user.firstName + ' ' + user.lastName,
      new Date().toLocaleString(),
      ip,
      `<img src=${this.cfg.get<string>('FRONTEND_URL')}/src/assets/avatars/${before.avatarId}.png width="140" style="display:block;border:0;">`,
      `<img src=${this.cfg.get<string>('FRONTEND_URL')}/src/assets/avatars/${dto.avatarId}.png width="140" style="display:block;border:0;">`,
    );

    await this.notificationsService.createNotification(
      userId,
      'Avatar Changed',
      `Your account avatar was recently changed. If you did not perform this action, please contact our support immediately.`,
      true,
      html,
      'Your Profile Has Been Updated',
      '/profile',
    );

    return { ok: true };
  }

  async updateUserProfile(userId: number, dto: ProfileChangeDto, ip: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const before = user;

    let data = {};

    if (dto.firstName) {
      data['firstName'] = dto.firstName;
    }
    if (dto.lastName) {
      data['lastName'] = dto.lastName;
    }
    if (dto.country) {
      data['country'] = dto.country;
    }
    if (dto.phoneNumber) {
      data['phoneNumber'] = dto.phoneNumber;
    }
    if (dto.email) {
      data['email'] = dto.email;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No update details found');
    }

    const htmlStringAfter = Object.entries(data)
      .map(([key, value]) => `${key.toUpperCase()}: ${value}`)
      .join('<br>');

    const formatValue = (val: any) =>
      typeof val === 'object' && val !== null
        ? JSON.stringify(val)
        : (val ?? '');

    const htmlStringBefore = Object.entries(data)
      .map(([key]) => `${key.toUpperCase()}: ${formatValue(before?.[key])}`)
      .join('<br>');

    await this.prisma.user.update({
      where: { id: userId },
      data: data,
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: 'user',
        action: 'PROFILE_UPDATE',
        entity: 'User',
        entityId: userId,
        ip,
        before,
        after: data,
      },
    });

    const html = EmailTemplates.profileUpdated(
      user.firstName + ' ' + user.lastName,
      new Date().toLocaleString(),
      ip,
      htmlStringBefore,
      htmlStringAfter,
    );

    await this.notificationsService.createNotification(
      userId,
      'Profile Updated',
      `Your profile was recently changed. If you did not perform this action, please contact our support immediately.`,
      true,
      html,
      'Your Profile Has Been Updated',
      '/profile',
    );

    return { ok: true };
  }

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        memberId: true,
        email: true,
        phoneNumber: true,
        firstName: true,
        lastName: true,
        country: true,
        sponsorId: true,
        parentId: true,
        position: true,
        status: true,
        isG2faEnabled: true,
        role: true,
        leftBv: true,
        rightBv: true,
        rankLeftVolume: true,
        rankRightVolume: true,
        avatarId: true,
        isWithdrawalRestricted: true,
        lockWithdrawalsTillTarget: true,
        isCrossLineTransferRestricted: true,
        currentRank: true
      },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }

  async getAllUserDataForExport() {
    const allData = await this.prisma.user.findMany({
      include: {
        wallets: true,
        externalWallets: true,
      },
    });
    return allData;
  }
}
