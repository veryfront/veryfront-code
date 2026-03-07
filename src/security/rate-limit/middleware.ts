import { logger } from "#veryfront/utils";
import type { RateLimitConfig, RateLimitStore } from "./types.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";
import { fixedWindowStrategy, slidingWindowStrategy, tokenBucketStrategy } from "./strategies.ts";

/** Rate limit preset: window durations */
const STRICT_WINDOW_MS = 60_000; // 1 minute
const MODERATE_WINDOW_MS = 60_000; // 1 minute
const LENIENT_WINDOW_MS = 3_600_000; // 1 hour
const AUTH_WINDOW_MS = 900_000; // 15 minutes

/** Rate limit preset: max requests per window */
const STRICT_MAX_REQUESTS = 10;
const MODERATE_MAX_REQUESTS = 100;
const LENIENT_MAX_REQUESTS = 1_000;
const AUTH_MAX_REQUESTS = 5;

/** Default Retry-After header value in seconds */
const DEFAULT_RETRY_AFTER_SECONDS = "60";

function defaultKeyGenerator(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") || "unknown";
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
        "Retry-After": DEFAULT_RETRY_AFTER_SECONDS,
      },
    },
  );
}

function getStrategy(strategy: RateLimitConfig["strategy"]) {
  switch (strategy) {
    case "sliding-window":
      return slidingWindowStrategy;
    case "token-bucket":
      return tokenBucketStrategy;
    case "fixed-window":
    default:
      return fixedWindowStrategy;
  }
}

function applyRateLimitHeaders(response: Response, headers: Headers): void {
  for (const [name, value] of headers) {
    response.headers.set(name, value);
  }
}

export function createRateLimiter(
  config: RateLimitConfig,
): (request: Request, next: (req: Request) => Promise<Response>) => Promise<Response> {
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

  const strategyFn = getStrategy(strategy);

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

        applyRateLimitHeaders(response, headers);
        return response;
      }

      const response = await next(request);
      applyRateLimitHeaders(response, headers);
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
      maxRequests: STRICT_MAX_REQUESTS,
      windowMs: STRICT_WINDOW_MS,
      strategy: "sliding-window",
      store,
    }),

  moderate: (store?: RateLimitStore) =>
    createRateLimiter({
      maxRequests: MODERATE_MAX_REQUESTS,
      windowMs: MODERATE_WINDOW_MS,
      strategy: "fixed-window",
      store,
    }),

  lenient: (store?: RateLimitStore) =>
    createRateLimiter({
      maxRequests: LENIENT_MAX_REQUESTS,
      windowMs: LENIENT_WINDOW_MS,
      strategy: "fixed-window",
      store,
    }),

  auth: (store?: RateLimitStore) =>
    createRateLimiter({
      maxRequests: AUTH_MAX_REQUESTS,
      windowMs: AUTH_WINDOW_MS,
      strategy: "sliding-window",
      message: "Too many authentication attempts. Please try again later.",
      store,
    }),
};
