import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { AppCacheService } from './app-cache.service';
import { HttpCacheInterceptor } from './http-cache.interceptor';
import { InvalidateCacheInterceptor } from './invalidate-cache.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('REDIS_HOST', '127.0.0.1');
        const port = Number(config.get<string>('REDIS_PORT', '6379'));
        return new Redis({
          host,
          port,
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        });
      },
    },
    AppCacheService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpCacheInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: InvalidateCacheInterceptor,
    },
  ],
  exports: [REDIS_CLIENT, AppCacheService],
})
export class RedisCacheModule {}
