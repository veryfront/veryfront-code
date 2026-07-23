import { createError, INVALID_ARGUMENT, toError } from "#veryfront/errors";
import { setActiveSpanAttributes } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export interface RateLimitConfig {
  strategy: "fixed-window" | "sliding-window" | "token-bucket";
  maxRequests: number;
  windowMs: number;
  /** Maximum number of identifiers retained in memory. Defaults to 10,000. */
  maxIdentifiers?: number;
  identify?: (context: Record<string, unknown>) => string;
  errorMessage?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

interface Limiter {
  check(identifier: string): RateLimitResult;
  reset(identifier: string): void;
  clear(): void;
}

type ResolvedRateLimitConfig = Readonly<
  Omit<RateLimitConfig, "maxIdentifiers"> & { maxIdentifiers: number }
>;

const DEFAULT_MAX_IDENTIFIERS = 10_000;
const MAX_IDENTIFIERS = 1_000_000;
const MAX_IDENTIFIER_LENGTH = 4_096;

function positiveSafeInteger(
  value: unknown,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw INVALID_ARGUMENT.create({
      detail: `${name} must be a positive safe integer no greater than ${maximum}`,
    });
  }
  return value as number;
}

function normalizeRateLimitConfig(config: RateLimitConfig): ResolvedRateLimitConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw INVALID_ARGUMENT.create({ detail: "Rate limit configuration must be an object" });
  }
  if (
    config.strategy !== "fixed-window" && config.strategy !== "sliding-window" &&
    config.strategy !== "token-bucket"
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Rate limit strategy is not supported" });
  }
  if (config.identify !== undefined && typeof config.identify !== "function") {
    throw INVALID_ARGUMENT.create({ detail: "Rate limit identify must be a function" });
  }
  if (
    config.errorMessage !== undefined &&
    (typeof config.errorMessage !== "string" || config.errorMessage.trim().length === 0)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Rate limit errorMessage must be a non-empty string" });
  }

  return Object.freeze({
    strategy: config.strategy,
    maxRequests: positiveSafeInteger(config.maxRequests, "maxRequests"),
    windowMs: positiveSafeInteger(config.windowMs, "windowMs"),
    maxIdentifiers: positiveSafeInteger(
      config.maxIdentifiers ?? DEFAULT_MAX_IDENTIFIERS,
      "maxIdentifiers",
      MAX_IDENTIFIERS,
    ),
    ...(config.identify === undefined ? {} : { identify: config.identify }),
    ...(config.errorMessage === undefined ? {} : { errorMessage: config.errorMessage }),
  });
}

function setBoundedEntry<T>(
  entries: Map<string, T>,
  identifier: string,
  value: T,
  maximum: number,
): void {
  if (entries.has(identifier)) {
    entries.delete(identifier);
  } else if (entries.size >= maximum) {
    const oldestIdentifier = entries.keys().next().value;
    if (oldestIdentifier !== undefined) entries.delete(oldestIdentifier);
  }
  entries.set(identifier, value);
}

class FixedWindowLimiter implements Limiter {
  private requests = new Map<string, { count: number; resetAt: number }>();

  constructor(private config: ResolvedRateLimitConfig) {}

  check(identifier: string): RateLimitResult {
    const now = Date.now();
    const entry = this.requests.get(identifier);

    if (!entry || now >= entry.resetAt) {
      const resetAt = now + this.config.windowMs;
      setBoundedEntry(
        this.requests,
        identifier,
        { count: 1, resetAt },
        this.config.maxIdentifiers,
      );

      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetAt,
      };
    }

    if (entry.count >= this.config.maxRequests) {
      setBoundedEntry(this.requests, identifier, entry, this.config.maxIdentifiers);
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      };
    }

    entry.count++;
    setBoundedEntry(this.requests, identifier, entry, this.config.maxIdentifiers);

    return {
      allowed: true,
      remaining: this.config.maxRequests - entry.count,
      resetAt: entry.resetAt,
    };
  }

  reset(identifier: string): void {
    this.requests.delete(identifier);
  }

  clear(): void {
    this.requests.clear();
  }
}

class SlidingWindowLimiter implements Limiter {
  private requests = new Map<string, number[]>();

  constructor(private config: ResolvedRateLimitConfig) {}

  check(identifier: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const timestamps = this.requests.get(identifier) ?? [];
    let firstActiveIndex = 0;
    while (
      firstActiveIndex < timestamps.length &&
      (timestamps[firstActiveIndex] ?? Number.POSITIVE_INFINITY) <= windowStart
    ) {
      firstActiveIndex++;
    }
    const activeTimestamps = firstActiveIndex === 0
      ? timestamps
      : timestamps.slice(firstActiveIndex);

    if (activeTimestamps.length >= this.config.maxRequests) {
      const resetAt = (activeTimestamps[0] ?? now) + this.config.windowMs;
      setBoundedEntry(
        this.requests,
        identifier,
        activeTimestamps,
        this.config.maxIdentifiers,
      );
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfter: Math.max(0, Math.ceil((resetAt - now) / 1_000)),
      };
    }

    activeTimestamps.push(now);
    setBoundedEntry(
      this.requests,
      identifier,
      activeTimestamps,
      this.config.maxIdentifiers,
    );
    return {
      allowed: true,
      remaining: this.config.maxRequests - activeTimestamps.length,
      resetAt: (activeTimestamps[0] ?? now) + this.config.windowMs,
    };
  }

  reset(identifier: string): void {
    this.requests.delete(identifier);
  }

  clear(): void {
    this.requests.clear();
  }
}

class TokenBucketLimiter implements Limiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private refillRate: number;

  constructor(private config: ResolvedRateLimitConfig) {
    this.refillRate = config.maxRequests / config.windowMs;
  }

  check(identifier: string): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(identifier);

    if (!bucket) {
      const tokens = this.config.maxRequests - 1;
      setBoundedEntry(
        this.buckets,
        identifier,
        { tokens, lastRefill: now },
        this.config.maxIdentifiers,
      );

      return {
        allowed: true,
        remaining: tokens,
        resetAt: now + this.config.windowMs,
      };
    }

    const timePassed = now - bucket.lastRefill;
    bucket.tokens = Math.min(this.config.maxRequests, bucket.tokens + timePassed * this.refillRate);
    bucket.lastRefill = now;
    setBoundedEntry(this.buckets, identifier, bucket, this.config.maxIdentifiers);

    if (bucket.tokens < 1) {
      const timeUntilToken = (1 - bucket.tokens) / this.refillRate;

      return {
        allowed: false,
        remaining: 0,
        resetAt: now + this.config.windowMs,
        retryAfter: Math.ceil(timeUntilToken / 1000),
      };
    }

    bucket.tokens--;

    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      resetAt: now + this.config.windowMs,
    };
  }

  reset(identifier: string): void {
    this.buckets.delete(identifier);
  }

  clear(): void {
    this.buckets.clear();
  }
}

function createLimiterByStrategy(config: ResolvedRateLimitConfig): Limiter {
  if (config.strategy === "fixed-window") return new FixedWindowLimiter(config);
  if (config.strategy === "sliding-window") return new SlidingWindowLimiter(config);
  return new TokenBucketLimiter(config);
}

export function createRateLimiter(config: RateLimitConfig): {
  check: (context?: Record<string, unknown>) => RateLimitResult;
  reset: (context?: Record<string, unknown>) => void;
  clear: () => void;
} {
  const resolvedConfig = normalizeRateLimitConfig(config);
  const limiter = createLimiterByStrategy(resolvedConfig);

  function getIdentifier(context?: Record<string, unknown>): string {
    const identifier = resolvedConfig.identify?.(context ?? {}) ?? "default";
    if (
      typeof identifier !== "string" || identifier.length === 0 ||
      identifier.length > MAX_IDENTIFIER_LENGTH
    ) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Rate limit identifier must be a non-empty string no longer than ${MAX_IDENTIFIER_LENGTH} characters`,
      });
    }
    return identifier;
  }

  return {
    check(context?: Record<string, unknown>): RateLimitResult {
      return limiter.check(getIdentifier(context));
    },
    reset(context?: Record<string, unknown>): void {
      limiter.reset(getIdentifier(context));
    },
    clear(): void {
      limiter.clear();
    },
  };
}

export function rateLimitMiddleware(
  config: RateLimitConfig,
): <T>(context: Record<string, unknown>, next: () => Promise<T>) => Promise<T> {
  const resolvedConfig = normalizeRateLimitConfig(config);
  const limiter = createRateLimiter(resolvedConfig);

  return function middleware<T>(
    context: Record<string, unknown>,
    next: () => Promise<T>,
  ): Promise<T> {
    return withSpan(
      "agent.middleware.rateLimit",
      () => {
        const result = limiter.check(context);

        setActiveSpanAttributes({
          "rateLimit.allowed": result.allowed,
          "rateLimit.remaining": result.remaining,
          "rateLimit.strategy": resolvedConfig.strategy,
        });

        if (result.allowed) return next();

        setActiveSpanAttributes({
          "rateLimit.retryAfter": result.retryAfter ?? 0,
        });

        throw toError(
          createError({
            type: "agent",
            message: resolvedConfig.errorMessage ??
              `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
          }),
        );
      },
      {
        "rateLimit.strategy": resolvedConfig.strategy,
        "rateLimit.maxRequests": resolvedConfig.maxRequests,
      },
    );
  };
}
