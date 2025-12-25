import { Injectable, BadRequestException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RegisterDto } from './dto/register.dto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';
import { TwoFactorService } from './twofactor.service';
import { WalletService } from 'src/wallets/wallet.service';
import { WalletType, TransactionType } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private cfg: ConfigService,
    private twoFactor: TwoFactorService,
    private walletService: WalletService,
  ) {}

  private async hashPassword(password: string) {
    return argon2.hash(password);
  }

  private async verifyPassword(hash: string, password: string) {
    return argon2.verify(hash, password);
  }

  private async findAvailablePlacement(startParentId: number, position: 'LEFT' | 'RIGHT') {
  let queue = [startParentId];

  while (queue.length) {
    const pid = queue.shift();

    const existing = await this.prisma.user.findFirst({
      where: { parentId: pid, position },
      select: { id: true },
    });

    if (!existing) {
      return pid;  // slot free here
    }

    queue.push(existing.id); // go deeper
  }

  throw new BadRequestException('No available slot in tree');
}


  async register(dto: RegisterDto, ip: string) {
    const { firstName, lastName, phone, country, email, password, sponsorMemberId, parentMemberId, position } = dto;

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
    let parentId
    const finalPosition = (position ?? 'RIGHT') as 'LEFT' | 'RIGHT';

    if (parentMemberId) {
      const parent = await this.prisma.user.findUnique({
        where: { memberId: parentMemberId },
      });
      if (!parent) throw new BadRequestException('Invalid parentMemberId');

      parentId = parent.id;
    } else {
      parentId = await this.findAvailablePlacement(1, finalPosition)
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

    if (slotTaken) {
      throw new BadRequestException(
        `Position ${finalPosition} under parent ${parentMemberId ?? 'COMPANY'} is already occupied.`,
      );
    }

    // -----------------------------
    // 6. Transaction (User + Wallets + Audit)
    // -----------------------------
    const result = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          memberId: `M${Date.now()}`,
          firstName,
          lastName,
          phoneNumber: phone,
          country,
          email,
          passwordHash,
          sponsorId,
          parentId,
          position: finalPosition,
          status: 'INACTIVE',

          // Ensure these exist in your Prisma schema (you have them)
          g2faSecret: '',
          isG2faEnabled: false,
        },
      });

      console.log('New user created with ID:', newUser.id);


      console.log('Creating wallets for user ID:', newUser.id);
      // Create 4 Wallets
      await this.walletService.createWalletsForUser(tx, newUser.id);

      
      // ➜ REFERRAL BONUS
      if (sponsorId && sponsorId !== 1) {
        const bonus = Number(this.cfg.get('REFERRAL_BONUS') ?? 0);

        if (bonus > 0) {
          await this.walletService.creditWallet({
            userId: sponsorId,
            walletType: WalletType.I_WALLET,
            amount: bonus.toString(),
            txType: TransactionType.BINARY_INCOME,
            purpose: `Referral bonus from ${newUser.memberId}`,
            meta: { fromUserId: newUser.id, fromMemberId: newUser.memberId },
          }
          );
        }
      }

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
    };
  }

  async login(dto: LoginDto, ip: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.phoneOrEmail }, { phoneNumber: dto.phoneOrEmail }],
      },
      include: { twoFactorSecret: true }, // corrected
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedException('Account suspended. Contact support.');
    }


    const ok = await this.verifyPassword(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // If 2FA enabled, verify code
    if (user.twoFactorSecret && user.twoFactorSecret.enabled) {
      if (!dto.code) throw new UnauthorizedException('2FA code required');
      const verified = this.twoFactor.verifyCode(user.twoFactorSecret.secretEnc, dto.code);
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
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { twoFactorSecret: true } });
    if (!user) throw new UnauthorizedException('User not found');

    const ok = await this.verifyPassword(user.passwordHash, dto.oldPassword);
    if (!ok) throw new UnauthorizedException('Old password incorrect');

    // verify 2FA
    if (user.twoFactorSecret && user.twoFactorSecret.enabled) {
      const verified = this.twoFactor.verifyCode(user.twoFactorSecret.secretEnc, dto.twoFactorCode);
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
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { twoFactorSecret: true } });
    if (!user) throw new UnauthorizedException('User not found');

    // verify 2FA
    if (user.twoFactorSecret && user.twoFactorSecret.enabled) {
      const verified = this.twoFactor.verifyCode(user.twoFactorSecret.secretEnc, dto.twoFactorCode);
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
      },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }
}
