import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as speakeasy from 'speakeasy';
import * as CryptoJS from 'crypto-js';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { Prisma } from '@prisma/client';
import * as QRCode from 'qrcode';

@Injectable()
export class TwoFactorService {
  constructor(private prisma: PrismaService, private cfg: ConfigService, private mail: MailService) {}

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
    const secret = speakeasy.generateSecret({ length: 20, name: `Monkey:${email}`, issuer: 'Monkey' });
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

  async generateQrCode(otpauthUrl: string) : Promise<string> {
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

  async verifyAndEnable(userId: number, code: string, ip: string, actorId?: number) {
    const rec = await this.prisma.twoFactorSecret.findUnique({ where: { userId } });
    if (!rec) throw new NotFoundException('2FA not initialized');
    const ok = this.verifyCode(rec.secretEnc, code);
    if (!ok) throw new BadRequestException('Invalid code');

    await this.prisma.twoFactorSecret.update({ where: { userId }, data: { enabled: true } });

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

  async requestReset(email: string) {
    // find user
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('User not found');

    // create a one-time reset token and email that link (for demo we'll send code)
    const token = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
    // store token in audit log or a dedicated table; for simplicity store in audit log
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorType: 'user',
        action: '2FA_RESET_REQUEST',
        entity: 'User',
        entityId: user.id,
        after: { resetCode: token },
      },
    });

    // send email (stub)
    await this.mail.sendMail(user.email, '2FA Reset Request', `Your reset code: ${token}`);

    return { ok: true };
  }

  async adminReset(targetUserId: number, adminId: number, ip: string) {
    // delete or disable the secret
    await this.prisma.twoFactorSecret.updateMany({
      where: { userId: targetUserId },
      data: { enabled: false },
    });

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
}
