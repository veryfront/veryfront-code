export type CachedRequestAuthResult<TAuth> = TAuth | Response;

export interface CreateRequestAuthCacheOptions<TAuth> {
  authenticate: (
    request: Request,
  ) => Promise<CachedRequestAuthResult<TAuth>> | CachedRequestAuthResult<TAuth>;
  shouldCache?: (result: CachedRequestAuthResult<TAuth>) => boolean;
}

export interface RequestAuthCache<TAuth> {
  authenticate: (request: Request) => Promise<CachedRequestAuthResult<TAuth>>;
}

export function createRequestAuthCache<TAuth>(
  options: CreateRequestAuthCacheOptions<TAuth>,
): RequestAuthCache<TAuth> {
  const cache = new WeakMap<Request, TAuth>();
  const shouldCache = options.shouldCache ?? ((result) => !(result instanceof Response));

  return {
    async authenticate(request) {
      if (cache.has(request)) {
        const cached = cache.get(request);
        if (cached !== undefined) return cached;
      }

      const result = await options.authenticate(request);
      if (shouldCache(result) && !(result instanceof Response)) {
        cache.set(request, result);
      }
      return result;
    },
  };
}
