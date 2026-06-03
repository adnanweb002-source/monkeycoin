import { SetMetadata } from '@nestjs/common';
import { CACHE_NAMESPACE_KEY } from '../cache.metadata';

/**
 * Marks a controller so non-GET requests invalidate this Redis namespace on success.
 */
export const CacheNamespace = (namespace: string) =>
  SetMetadata(CACHE_NAMESPACE_KEY, namespace);
