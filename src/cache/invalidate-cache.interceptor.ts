import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { AppCacheService } from './app-cache.service';
import {
  CACHE_NAMESPACE_KEY,
  INVALIDATE_EXTRA_KEY,
  InvalidateExtraOptions,
  SKIP_CACHE_INVALIDATION_KEY,
} from './cache.metadata';

@Injectable()
export class InvalidateCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: AppCacheService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const method = req.method as string;
    if (
      method === 'GET' ||
      method === 'HEAD' ||
      method === 'OPTIONS'
    ) {
      return next.handle();
    }

    const handler = context.getHandler();
    if (this.reflector.get(SKIP_CACHE_INVALIDATION_KEY, handler)) {
      return next.handle();
    }

    const controller = context.getClass();
    const classNs = this.reflector.get<string | undefined>(
      CACHE_NAMESPACE_KEY,
      controller,
    );
    const extra = this.reflector.get<InvalidateExtraOptions | undefined>(
      INVALIDATE_EXTRA_KEY,
      handler,
    );

    if (!classNs && !extra?.namespaces?.length) {
      return next.handle();
    }

    return next.handle().pipe(
      mergeMap((data) =>
        from(
          (async () => {
            const res = context.switchToHttp().getResponse();
            const status = res.statusCode;
            if (status >= 200 && status < 300) {
              const namespaces = [
                classNs,
                ...(extra?.namespaces ?? []),
              ].filter(Boolean) as string[];
              await this.cache.invalidateNamespaces(namespaces);
            }
            return data;
          })(),
        ),
      ),
    );
  }
}
