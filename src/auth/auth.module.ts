import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaService } from '../prisma.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { LocalStrategy } from './local.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { TwoFactorService } from './twofactor.service';
import { WalletModule } from '../wallets/wallet.module';
import { NowPaymentsService } from 'src/wallets/deposit-gateway.service';

@Global()
@Module({
  imports: [
    PassportModule,
    WalletModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: cfg.get<string>('JWT_ACCESS_EXPIRES_IN') || '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    PrismaService,
    AuthService,
    JwtStrategy,
    LocalStrategy,
    MailService,
    TwoFactorService,
    ConfigService,
    NowPaymentsService
  ],
  exports: [AuthService],
})
export class AuthModule {}
