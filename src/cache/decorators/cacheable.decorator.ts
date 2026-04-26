import { SetMetadata } from '@nestjs/common';
import { CACHEABLE_KEY, CacheableOptions } from '../cache.metadata';

/** Opt-in Redis cache for GET handlers. */
export const Cacheable = (options: CacheableOptions) =>
  SetMetadata(CACHEABLE_KEY, options);
