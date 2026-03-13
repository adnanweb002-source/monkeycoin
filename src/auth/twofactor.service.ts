import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as speakeasy from 'speakeasy';
import * as CryptoJS from 'crypto-js';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { Prisma } from '@prisma/client';
import * as QRCode from 'qrcode';
import { NotificationsService } from 'src/notifications/notifcations.service';
import { EmailTemplates } from 'src/mail/templates/email.templates';

@Injectable()
export class TwoFactorService {
  constructor(
    private prisma: PrismaService,
    private cfg: ConfigService,
    private mail: MailService,
    private notifications: NotificationsService,
  ) {}
  private encryptSecret(secret: string) {
    const key = this.cfg.get<string>('AES_KEY');
    if (!key) throw new Error('AES_KEY not configured');
    const cipher = CryptoJS.AES.encrypt(secret, key);
    return cipher.toString();
  }

  private decryptSecret(encrypted: string) {
    const key = this.cfg.get<string>('AES_KEY');
    const bytes = CryptoJS.AES.decrypt(encrypted, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  async generateSetup(userId: number, email: string) {
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `Vaultire:${email}`,
      issuer: 'Vaultire Infinite',
    });
    const otpauthUrl = secret.otpauth_url;
    // Do not store raw secret until verification step
    // store temporary secret in DB as non-enabled; overwrite on verify
    const enc = this.encryptSecret(secret.base32);
    // Upsert
    await this.prisma.twoFactorSecret.upsert({
      where: { userId },
      update: { secretEnc: enc, enabled: false },
      create: { userId, secretEnc: enc, enabled: false },
    });

    const qr = await this.generateQrCode(otpauthUrl);
    return { otpauthUrl, base32: secret.base32, qr };
  }

  async generateQrCode(otpauthUrl: string): Promise<string> {
    try {
      const qr = await QRCode.toDataURL(otpauthUrl);
      return qr;
    } catch (error) {
      throw new BadRequestException('Failed to generate QR code');
    }
  }

  verifyCode(encryptedSecret: string, code: string) {
    const secret = this.decryptSecret(encryptedSecret);
    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });
    return verified;
  }

  async verifyAndEnable(
    userId: number,
    code: string,
    ip: string,
    actorId?: number,
  ) {
    const rec = await this.prisma.twoFactorSecret.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (!rec) throw new NotFoundException('2FA not initialized');
    const ok = this.verifyCode(rec.secretEnc, code);
    if (!ok) throw new BadRequestException('Invalid code');

    await this.prisma.twoFactorSecret.update({
      where: { userId },
      data: { enabled: true },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { isG2faEnabled: true, g2faSecret: rec.secretEnc },
    });

    const html = EmailTemplates.g2faEnabled(
      rec.user.firstName + ' ' + rec.user.lastName,
      new Date().toLocaleString(),
      ip,
    );

    await this.notifications.createNotification(
      userId,
      '2FA Enabled',
      'Two-factor authentication has been enabled on your account.',
      true,
      html,
      'G2FA Successfully Enabled',
      '/profile?tab=security',
    );

    await this.prisma.auditLog.create({
      data: {
        actorId: actorId ?? userId,
        actorType: 'user',
        action: '2FA_ENABLED',
        entity: 'User',
        entityId: userId,
        ip,
      },
    });

    return { ok: true };
  }

  async adminReset(targetUserId: number, adminId: number, ip: string) {
    // delete or disable the secret

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.twoFactorSecret.updateMany({
      where: { userId: targetUserId },
      data: { enabled: false },
    });

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { isG2faEnabled: false },
    });

    const html = EmailTemplates.g2faDisabled(
      user.firstName + ' ' + user.lastName,
    );

    await this.notifications.createNotification(
      targetUserId,
      'Two-Factor Authentication Reset by Admin',
      'Your two-factor authentication has been reset by an administrator. Please set it up again for account security.',
      true,
      html,
      'G2FA Reset by Admin',
      '/profile?tab=security',
    );

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        actorType: 'admin',
        action: '2FA_RESET_ADMIN',
        entity: 'User',
        entityId: targetUserId,
        ip,
      },
    });

    return { ok: true };
  }

  async requestReset(email: string, ip: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: email }, { memberId: email }],
      },
    });

    if (!user) {
      return { ok: true };
    }

    const rawToken = require('crypto').randomBytes(32).toString('hex');
    const tokenHash = CryptoJS.SHA256(rawToken).toString();

    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + 30);

    await this.prisma.twoFactorResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: expiry,
      },
    });

    const frontend = this.cfg.get<string>('FRONTEND_URL');

    const resetLink = `${frontend}/reset-2fa?token=${rawToken}&email=${encodeURIComponent(
      email,
    )}`;

    const html = EmailTemplates.g2faResetRequest(
      user.firstName + ' ' + user.lastName,
      resetLink,
    );

    await this.notifications.createNotification(
      user.id,
      'Reset Two-Factor Authentication',
      `Click the link below to reset your two-factor authentication:\n\n${resetLink}\n\nThis link expires in 30 minutes.`,
      true,
      html,
      'G2FA Reset Request Under Review',
      '',
      false,
    );

    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorType: 'user',
        action: '2FA_RESET_REQUEST',
        entity: 'User',
        entityId: user.id,
        ip,
      },
    });

    return { ok: true };
  }

  async resetTwoFactor(email: string, token: string, ip: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) throw new BadRequestException('Invalid reset request');

    const tokenHash = CryptoJS.SHA256(token).toString();

    const record = await this.prisma.twoFactorResetToken.findFirst({
      where: {
        userId: user.id,
        tokenHash,
        used: false,
      },
    });

    if (!record) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    if (record.expiresAt < new Date()) {
      throw new BadRequestException('Reset token expired');
    }

    await this.prisma.$transaction(async (tx) => {
      // Disable 2FA
      await tx.twoFactorSecret.updateMany({
        where: { userId: user.id },
        data: { enabled: false },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { isG2faEnabled: false },
      });

      await tx.twoFactorSecret.deleteMany({
        where: { userId: user.id },
      });

      await tx.twoFactorResetToken.update({
        where: { id: record.id },
        data: { used: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorType: 'user',
          action: '2FA_RESET',
          entity: 'User',
          entityId: user.id,
          ip,
        },
      });
    });

    const html = EmailTemplates.g2faDisabled(
      user.firstName + ' ' + user.lastName,
    );

    await this.notifications.createNotification(
      user.id,
      'Two-Factor Authentication Disabled',
      'Two-factor authentication has been disabled on your account. If you did not perform this action, contact support immediately.',
      true,
      html,
      'G2FA Successfully Disabled',
    );

    return { ok: true };
  }
}
