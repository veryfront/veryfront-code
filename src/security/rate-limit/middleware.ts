import { logger } from "#veryfront/utils";
import type { RateLimitConfig, RateLimitPresetOptions, RateLimitStore } from "./types.ts";
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

const MAX_CLIENT_KEY_LENGTH = 512;

function assertPositiveSafeInteger(name: string, value: number): void {
  if (Number.isSafeInteger(value) && value > 0) return;
  throw new TypeError(`${name} must be a positive safe integer`);
}

function assertClientKey(key: unknown): asserts key is string {
  if (typeof key === "string" && key.trim().length > 0 && key.length <= MAX_CLIENT_KEY_LENGTH) {
    return;
  }
  throw new TypeError(
    `Rate limit client key must be a non-empty string of at most ${MAX_CLIENT_KEY_LENGTH} characters`,
  );
}

function defaultKeyGenerator(request: Request, trustProxy: boolean): string {
  return resolveRateLimitClientKey(request, trustProxy, "unknown");
}

function isRateLimitStore(
  value: RateLimitStore | RateLimitPresetOptions,
): value is RateLimitStore {
  return "increment" in value && typeof value.increment === "function";
}

function resolvePresetOptions(
  storeOrOptions?: RateLimitStore | RateLimitPresetOptions,
): RateLimitPresetOptions {
  if (!storeOrOptions) return {};
  return isRateLimitStore(storeOrOptions) ? { store: storeOrOptions } : storeOrOptions;
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
  assertPositiveSafeInteger("maxRequests", config.maxRequests);
  assertPositiveSafeInteger("windowMs", config.windowMs);
  if (
    config.strategy !== undefined &&
    !["fixed-window", "sliding-window", "token-bucket"].includes(config.strategy)
  ) {
    throw new TypeError(`Unsupported rate limit strategy: ${String(config.strategy)}`);
  }
  if (
    config.strategy !== undefined && config.strategy !== "fixed-window" && config.store &&
    !(config.store instanceof MemoryRateLimitStore)
  ) {
    throw new TypeError(
      `${config.strategy} requires MemoryRateLimitStore; custom stores support fixed-window only`,
    );
  }

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
    assertClientKey(key);

    let result: Awaited<ReturnType<typeof strategyFn>>;
    try {
      result = await strategyFn(key, { ...config, maxRequests, windowMs }, store);
    } catch {
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
      logger.error("Rate limiting store failed - failing closed");

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
      logger.warn("Rate limit exceeded", {
        limit: maxRequests,
        window: windowMs,
      });

      const response = onRateLimitExceeded
        ? await onRateLimitExceeded(request, key)
        : defaultRateLimitExceeded(request, key, message);

      response.headers.set(
        "Retry-After",
        Math.max(
          1,
          Math.ceil((result.retryAfterMs ?? result.resetTime - Date.now()) / 1_000),
        ).toString(),
      );
      applyRateLimitHeaders(response, headers);
      return response;
    }

    const response = await next(request);
    applyRateLimitHeaders(response, headers);
    return response;
  };
}

export const RateLimitPresets = {
  strict: (storeOrOptions?: RateLimitStore | RateLimitPresetOptions) => {
    const options = resolvePresetOptions(storeOrOptions);
    return createRateLimiter({
      maxRequests: STRICT_MAX_REQUESTS,
      windowMs: STRICT_WINDOW_MS,
      strategy: "sliding-window",
      ...options,
    });
  },

  moderate: (storeOrOptions?: RateLimitStore | RateLimitPresetOptions) => {
    const options = resolvePresetOptions(storeOrOptions);
    return createRateLimiter({
      maxRequests: MODERATE_MAX_REQUESTS,
      windowMs: MODERATE_WINDOW_MS,
      strategy: "fixed-window",
      ...options,
    });
  },

  lenient: (storeOrOptions?: RateLimitStore | RateLimitPresetOptions) => {
    const options = resolvePresetOptions(storeOrOptions);
    return createRateLimiter({
      maxRequests: LENIENT_MAX_REQUESTS,
      windowMs: LENIENT_WINDOW_MS,
      strategy: "fixed-window",
      ...options,
    });
  },

  auth: (storeOrOptions?: RateLimitStore | RateLimitPresetOptions) => {
    const options = resolvePresetOptions(storeOrOptions);
    return createRateLimiter({
      maxRequests: AUTH_MAX_REQUESTS,
      windowMs: AUTH_WINDOW_MS,
      strategy: "sliding-window",
      message: "Too many authentication attempts. Please try again later.",
      ...options,
    });
  },
};
