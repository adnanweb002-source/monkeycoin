import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, mergeMap, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AppCacheService } from './app-cache.service';
import { CACHEABLE_KEY } from './cache.metadata';

@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: AppCacheService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const method = req.method as string;
    if (method !== 'GET' && method !== 'HEAD') {
      return next.handle();
    }

    const opts = this.reflector.get(CACHEABLE_KEY, context.getHandler());
    if (!opts) {
      return next.handle();
    }

    const scope =
      opts.scope === 'global'
        ? 'g'
        : `u:${req.user?.id ?? 'anon'}`;

    const key = this.cache.buildCacheKey({
      namespace: opts.namespace,
      scope,
      method,
      url: req.originalUrl ?? req.url,
    });

    return from(this.cache.getJson(key)).pipe(
      mergeMap((cached) => {
        if (cached !== undefined) {
          return of(cached);
        }
        return next.handle().pipe(
          tap({
            next: (body: unknown) => {
              void this.cache.setJson(key, body, opts.ttlSeconds);
            },
          }),
        );
      }),
    );
  }
}
