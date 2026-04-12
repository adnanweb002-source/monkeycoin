import { SetMetadata } from '@nestjs/common';
import { SKIP_CACHE_INVALIDATION_KEY } from '../cache.metadata';

/** Skip automatic namespace invalidation for this handler (rare). */
export const SkipCacheInvalidation = () =>
  SetMetadata(SKIP_CACHE_INVALIDATION_KEY, true);
