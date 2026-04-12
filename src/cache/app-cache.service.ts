import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class AppCacheService implements OnModuleDestroy {
  private readonly log = new Logger(AppCacheService.name);
  private readonly keyPrefix: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.keyPrefix = this.config.get<string>('CACHE_KEY_PREFIX') ?? 'hc:v1';
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  buildCacheKey(parts: {
    namespace: string;
    scope: string;
    method: string;
    url: string;
  }): string {
    const hash = createHash('sha256')
      .update(`${parts.method}:${parts.url}`)
      .digest('hex')
      .slice(0, 40);
    return `${this.keyPrefix}:${parts.namespace}:${parts.scope}:${hash}`;
  }

  async getJson<T>(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(key);
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      await this.redis.unlink(key);
      return undefined;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  /** Deletes all keys for a logical namespace (prefix match). */
  async invalidateNamespace(namespace: string): Promise<void> {
    const pattern = `${this.keyPrefix}:${namespace}:*`;
    let cursor = '0';
    let total = 0;
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        200,
      );
      cursor = next;
      if (keys.length) {
        await this.redis.unlink(...keys);
        total += keys.length;
      }
    } while (cursor !== '0');
    if (total > 0) {
      this.log.debug(`Invalidated ${total} key(s) for namespace "${namespace}"`);
    }
  }

  async invalidateNamespaces(namespaces: string[]) {
    const uniq = [...new Set(namespaces.filter(Boolean))];
    for (const ns of uniq) {
      await this.invalidateNamespace(ns);
    }
  }
}
