import { randomBytes } from 'crypto';
import type { Response } from 'express';

export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export function isCsrfProtectionEnabled(): boolean {
  return process.env.CSRF_PROTECTION === 'true';
}

export function setCsrfCookie(res: Response): void {
  if (!isCsrfProtectionEnabled()) return;
  const token = randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    domain: process.env.NODE_ENV === 'production' ? '.gogex.xyz' : undefined,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearCsrfCookie(res: Response): void {
  if (!isCsrfProtectionEnabled()) return;
  res.clearCookie(CSRF_COOKIE_NAME, {
    path: '/',
    domain: process.env.NODE_ENV === 'production' ? '.gogex.xyz' : undefined,
  });
}
