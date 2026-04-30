import { createHmac, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';

/** Clock skew bound for wallet-adjust HMAC (`requestTs`). */
export const ADMIN_WALLET_ADJUST_KEY_MAX_AGE_MS = 60_000;

function getSecret(): string {
  const serverSecret = process.env.ADMIN_WALLET_ADJUST_KEY;
  if (!serverSecret) {
    throw new BadRequestException('Dynamic security key is not configured');
  }
  return serverSecret;
}

/** Payload encoding must stay in sync between challenge + verify. */
export function buildAdminWalletAdjustPayload(params: {
  memberId: string;
  keySalt: string;
  requestTs: string;
}): string {
  const { memberId, keySalt, requestTs } = params;
  return `${memberId}:${keySalt}:${requestTs}`;
}

/** Server-side HMAC used by `/admin/wallets/adjust-balance/challenge`. */
export function signAdminWalletAdjustDynamicKey(params: {
  memberId: string;
  keySalt: string;
  requestTs: string;
}): string {
  const payload = buildAdminWalletAdjustPayload(params);
  const expected = createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex');
  return expected;
}

/** Same verification as historically used on `adjust-balance` POST. */
export function verifyAdminWalletAdjustDynamicKey(params: {
  memberId: string;
  keySalt: string;
  requestTs: string;
  dynamicKey: string;
}): void {
  const { memberId, keySalt, requestTs, dynamicKey } = params;

  const ts = Number(requestTs);
  if (!Number.isFinite(ts)) {
    throw new BadRequestException('Invalid request timestamp');
  }

  const ageMs = Math.abs(Date.now() - ts);
  if (ageMs > ADMIN_WALLET_ADJUST_KEY_MAX_AGE_MS) {
    throw new UnauthorizedException(
      'Dynamic key expired. Retry with fresh salt',
    );
  }

  const expected = signAdminWalletAdjustDynamicKey({
    memberId,
    keySalt,
    requestTs,
  });

  const providedBuf = Buffer.from(dynamicKey);
  const expectedBuf = Buffer.from(expected);

  if (
    providedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(providedBuf, expectedBuf)
  ) {
    throw new UnauthorizedException('Invalid dynamic security key');
  }
}
