import { isResponseLike } from "./response-like.ts";
/** Result returned from cached request auth. */
export type CachedRequestAuthResult<TAuth> = TAuth | Response;

/** Options accepted by create request auth cache. */
export interface CreateRequestAuthCacheOptions<TAuth> {
  /** Authenticate value. */
  authenticate: (
    request: Request,
  ) => Promise<CachedRequestAuthResult<TAuth>> | CachedRequestAuthResult<TAuth>;
  /** Callback that handles should cache. */
  shouldCache?: (result: CachedRequestAuthResult<TAuth>) => boolean;
}

/** Public API contract for request auth cache. */
export interface RequestAuthCache<TAuth> {
  /** Callback that handles authenticate. */
  authenticate: (request: Request) => Promise<CachedRequestAuthResult<TAuth>>;
}

/** Create request auth cache. */
export function createRequestAuthCache<TAuth>(
  options: CreateRequestAuthCacheOptions<TAuth>,
): RequestAuthCache<TAuth> {
  const cache = new WeakMap<Request, TAuth>();
  const shouldCache = options.shouldCache ?? ((result) => !isResponseLike(result));

  return {
    async authenticate(request) {
      if (cache.has(request)) {
        const cached = cache.get(request);
        if (cached !== undefined) return cached;
      }

      const result = await options.authenticate(request);
      if (shouldCache(result) && !isResponseLike(result)) {
        cache.set(request, result);
      }
      return result;
    },
  };
}
