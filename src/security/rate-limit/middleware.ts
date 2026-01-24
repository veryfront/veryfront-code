import { logger } from "#veryfront/utils";
import type { RateLimitConfig, RateLimitStore } from "./types.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";
import { fixedWindowStrategy, slidingWindowStrategy, tokenBucketStrategy } from "./strategies.ts";

function defaultKeyGenerator(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  return realIp || "unknown";
}

function defaultRateLimitExceeded(_request: Request, _key: string, message: string): Response {
  return new Response(
    JSON.stringify({
      error: "Too Many Requests",
      message,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "60",
      },
    },
  );
}

export function createRateLimiter(config: RateLimitConfig): (
  request: Request,
  next: (req: Request) => Promise<Response>,
) => Promise<Response> {
  const {
    maxRequests,
    windowMs,
    strategy = "fixed-window",
    keyGenerator = defaultKeyGenerator,
    onRateLimitExceeded,
    skip,
    message = "Too many requests. Please try again later.",
    store = new MemoryRateLimitStore(),
  } = config;

  const strategyFn = {
    "sliding-window": slidingWindowStrategy,
    "token-bucket": tokenBucketStrategy,
    "fixed-window": fixedWindowStrategy,
  }[strategy] ?? fixedWindowStrategy;

  return async function rateLimitMiddleware(
    request: Request,
    next: (req: Request) => Promise<Response>,
  ): Promise<Response> {
    try {
      if (skip && (await skip(request))) {
        return next(request);
      }

      const key = keyGenerator(request);
      const result = await strategyFn(key, { ...config, maxRequests, windowMs }, store);

      const headers = new Headers({
        "X-RateLimit-Limit": maxRequests.toString(),
        "X-RateLimit-Remaining": result.remaining.toString(),
        "X-RateLimit-Reset": result.resetTime.toString(),
      });

      if (!result.allowed) {
        logger.warn(`Rate limit exceeded for key: ${key}`, {
          key,
          limit: maxRequests,
          window: windowMs,
        });

        const response = onRateLimitExceeded
          ? await onRateLimitExceeded(request, key)
          : defaultRateLimitExceeded(request, key, message);

        for (const [name, value] of headers) {
          response.headers.set(name, value);
        }

        return response;
      }

      const response = await next(request);

      for (const [name, value] of headers) {
        response.headers.set(name, value);
      }

      return response;
    } catch (error) {
      logger.error("Rate limiting error", {
        error: error instanceof Error ? error.message : String(error),
      });

      return next(request);
    }
  };
}

export const RateLimitPresets = {
  strict: (store?: RateLimitStore) =>
    createRateLimiter({
      maxRequests: 10,
      windowMs: 60000,
      strategy: "sliding-window",
      store,
    }),

  moderate: (store?: RateLimitStore) =>
    createRateLimiter({
      maxRequests: 100,
      windowMs: 60000,
      strategy: "fixed-window",
      store,
    }),

  lenient: (store?: RateLimitStore) =>
    createRateLimiter({
      maxRequests: 1000,
      windowMs: 3600000,
      strategy: "fixed-window",
      store,
    }),

  auth: (store?: RateLimitStore) =>
    createRateLimiter({
      maxRequests: 5,
      windowMs: 900000,
      strategy: "sliding-window",
      message: "Too many authentication attempts. Please try again later.",
      store,
    }),
};
