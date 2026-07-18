import { logger } from "#veryfront/utils";
import type { RateLimitConfig, RateLimitStore } from "./types.ts";
import { MemoryRateLimitStore } from "./memory-store.ts";
import { fixedWindowStrategy, slidingWindowStrategy, tokenBucketStrategy } from "./strategies.ts";
import { resolveRateLimitClientKey } from "./client-key.ts";

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

function defaultKeyGenerator(request: Request, trustProxy: boolean): string {
  return resolveRateLimitClientKey(request, trustProxy, "unknown");
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
    keyGenerator,
    onRateLimitExceeded,
    skip,
    message = "Too many requests. Please try again later.",
    store = new MemoryRateLimitStore(),
    trustProxy = false,
  } = config;

  const resolvedKeyGenerator = keyGenerator ??
    ((req: Request) => defaultKeyGenerator(req, trustProxy));

  const strategyFn = getStrategy(strategy);

  return async function rateLimitMiddleware(
    request: Request,
    next: (req: Request) => Promise<Response>,
  ): Promise<Response> {
    if (skip && (await skip(request))) {
      return next(request);
    }

    const key = resolvedKeyGenerator(request);

    let result: Awaited<ReturnType<typeof strategyFn>>;
    try {
      result = await strategyFn(key, { ...config, maxRequests, windowMs }, store);
    } catch (error) {
      // Fail closed: only the rate-limit store/strategy path triggers this.
      // If the store throws (e.g. Redis outage), reject the request with 503
      // instead of letting it through. Failing open would silently disable
      // rate limiting and expose brute-force, scraping, and credential-stuffing
      // surfaces during transient store failures.
      //
      // Downstream handler errors (from next(request)) and user-callback errors
      // (skip, keyGenerator, onRateLimitExceeded) are intentionally NOT caught
      // here so they remain observable as 5xx via the normal error handler and
      // are not masked as rate-limit outages with Retry-After: 60.
      logger.error("Rate limiting error — failing closed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return new Response("Service temporarily unavailable", {
        status: 503,
        headers: { "Retry-After": "60" },
      });
    }

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
