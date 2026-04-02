import {
  ForbiddenException,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  isCsrfProtectionEnabled,
} from './csrf-cookie';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const CSRF_EXEMPT_PATHS = new Set([
  '/auth/register',
  '/auth/login',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/request-2fa-reset',
  '/auth/request-2fa-reset-by-admin',
  '/auth/reset-2fa',
  '/wallet/payments/ipn',
  '/admin/bootstrap/company',
]);

function normalizePath(urlPath: string): string {
  const base = urlPath.split('?')[0] || '';
  if (base.length > 1 && base.endsWith('/')) return base.slice(0, -1);
  return base;
}

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (!isCsrfProtectionEnabled()) {
      next();
      return;
    }

    const method = (req.method || 'GET').toUpperCase();
    if (!MUTATING.has(method)) {
      next();
      return;
    }

    const path = normalizePath(req.path || req.url || '');
    if (CSRF_EXEMPT_PATHS.has(path)) {
      next();
      return;
    }

    if (!req.cookies?.access_token) {
      next();
      return;
    }

    const cookieTok = req.cookies?.[CSRF_COOKIE_NAME];
    const headerTokRaw = req.headers[CSRF_HEADER_NAME];
    const headerTok = Array.isArray(headerTokRaw)
      ? headerTokRaw[0]
      : headerTokRaw;

    if (
      !cookieTok ||
      !headerTok ||
      typeof headerTok !== 'string' ||
      cookieTok !== headerTok
    ) {
      throw new ForbiddenException('CSRF token missing or invalid');
    }

    next();
  }
}
