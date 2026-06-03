export const CACHE_NAMESPACE_KEY = 'cache:namespace';
export const CACHEABLE_KEY = 'cache:cacheable';
export const INVALIDATE_EXTRA_KEY = 'cache:invalidateExtra';
export const SKIP_CACHE_INVALIDATION_KEY = 'cache:skipInvalidation';

export type CacheScope = 'global' | 'user';

export type CacheableOptions = {
  /** Seconds until the entry expires */
  ttlSeconds: number;
  /** Must match invalidation namespaces (e.g. same string as @CacheNamespace) */
  namespace: string;
  /** global = one entry for all users; user = per authenticated user (JWT) */
  scope?: CacheScope;
};

export type InvalidateExtraOptions = {
  /** Additional namespaces to clear (e.g. wallet when purchasing a package) */
  namespaces: string[];
};
