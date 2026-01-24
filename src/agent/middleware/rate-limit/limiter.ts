import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { setActiveSpanAttributes, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export interface RateLimitConfig {
  strategy: "fixed-window" | "sliding-window" | "token-bucket";
  maxRequests: number;
  windowMs: number;
  identify?: (context: Record<string, unknown>) => string;
  errorMessage?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

class FixedWindowLimiter {
  private requests = new Map<string, { count: number; resetAt: number }>();

  constructor(private config: RateLimitConfig) {}

  check(identifier: string): RateLimitResult {
    const now = Date.now();
    const entry = this.requests.get(identifier);

    if (!entry || now >= entry.resetAt) {
      const resetAt = now + this.config.windowMs;

      this.requests.set(identifier, { count: 1, resetAt });

      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetAt,
      };
    }

    if (entry.count < this.config.maxRequests) {
      entry.count++;

      return {
        allowed: true,
        remaining: this.config.maxRequests - entry.count,
        resetAt: entry.resetAt,
      };
    }

    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  reset(identifier: string): void {
    this.requests.delete(identifier);
  }

  clear(): void {
    this.requests.clear();
  }
}

class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private refillRate: number;

  constructor(private config: RateLimitConfig) {
    this.refillRate = config.maxRequests / config.windowMs;
  }

  check(identifier: string): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(identifier);

    if (!bucket) {
      const newBucket = {
        tokens: this.config.maxRequests - 1,
        lastRefill: now,
      };

      this.buckets.set(identifier, newBucket);

      return {
        allowed: true,
        remaining: newBucket.tokens,
        resetAt: now + this.config.windowMs,
      };
    }

    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = timePassed * this.refillRate;

    bucket.tokens = Math.min(this.config.maxRequests, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens--;

      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        resetAt: now + this.config.windowMs,
      };
    }

    const timeUntilToken = (1 - bucket.tokens) / this.refillRate;

    return {
      allowed: false,
      remaining: 0,
      resetAt: now + this.config.windowMs,
      retryAfter: Math.ceil(timeUntilToken / 1000),
    };
  }

  reset(identifier: string): void {
    this.buckets.delete(identifier);
  }

  clear(): void {
    this.buckets.clear();
  }
}

function createLimiterByStrategy(config: RateLimitConfig): FixedWindowLimiter | TokenBucketLimiter {
  if (config.strategy === "fixed-window") return new FixedWindowLimiter(config);
  return new TokenBucketLimiter(config);
}

export function createRateLimiter(config: RateLimitConfig): {
  check: (context?: Record<string, unknown>) => RateLimitResult;
  reset: (context?: Record<string, unknown>) => void;
  clear: () => void;
} {
  const limiter = createLimiterByStrategy(config);

  function getIdentifier(context?: Record<string, unknown>): string {
    return config.identify?.(context ?? {}) ?? "default";
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
  const limiter = createRateLimiter(config);

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
          "rateLimit.strategy": config.strategy,
        });

        if (!result.allowed) {
          setActiveSpanAttributes({
            "rateLimit.retryAfter": result.retryAfter ?? 0,
          });

          throw toError(
            createError({
              type: "agent",
              message: config.errorMessage ??
                `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
            }),
          );
        }

        return next();
      },
      {
        "rateLimit.strategy": config.strategy,
        "rateLimit.maxRequests": config.maxRequests,
      },
    );
  };
}
