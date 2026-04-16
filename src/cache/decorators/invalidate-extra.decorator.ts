import { SetMetadata } from '@nestjs/common';
import {
  INVALIDATE_EXTRA_KEY,
  InvalidateExtraOptions,
} from '../cache.metadata';

/** Extra namespaces to invalidate in addition to @CacheNamespace (e.g. cross-module). */
export const InvalidateExtra = (options: InvalidateExtraOptions) =>
  SetMetadata(INVALIDATE_EXTRA_KEY, options);
